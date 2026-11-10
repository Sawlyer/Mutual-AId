import asyncio
import logging
from types import SimpleNamespace

import httpx2
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from mcp.types import Tool as SdkMcpTool
from mcp.types import ToolAnnotations

from app.config import Settings
from app.connectors.mcp_models import (
    MAX_MCP_TOOL_OUTPUT_BYTES,
    McpServerCreate,
    validate_public_endpoint,
)
from app.connectors.mcp_runtime import (
    ConversationMcpError,
    McpAuthorizationError,
    McpRuntime,
    _limit_tool_output,
    fetch_publisher_access,
    install_secret_log_filter,
    safe_mcp_http_client,
)
from app.connectors.oauth import TokenVault
from app.connectors.mcp_service import McpService
from app.db import Database


class FakeMcpServer:
    def __init__(self, tools, **kwargs):
        self.tools = tools
        self.kwargs = kwargs
        self.name = kwargs.get("name", "")
        self.entered = False

    async def __aenter__(self):
        self.entered = True
        return self

    async def __aexit__(self, *args):
        self.entered = False

    async def list_tools(self):
        return self.tools

    async def call_tool(self, tool_name, arguments=None, meta=None):
        self.called = tool_name
        return {"ok": True, "arguments": arguments, "meta": meta}


def mcp_tool(name, read_only=True, schema=None):
    return SimpleNamespace(
        name=name,
        description=f"{name} description",
        inputSchema=schema or {"type": "object", "properties": {}},
        annotations=SimpleNamespace(readOnlyHint=read_only, destructiveHint=not read_only),
    )


def make_runtime(tmp_path, tools):
    database = Database(tmp_path / "mcp-runtime.sqlite3")
    database.initialize()
    settings = Settings(database_path=database.path, connector_token_encryption_key=Fernet.generate_key().decode())
    created = McpService(database, settings).create_server(
        "user-a", McpServerCreate(name="Docs", url="https://8.8.8.8/mcp"),
    )
    return database, settings, created, McpRuntime(database, settings, server_factory=lambda **kwargs: FakeMcpServer(tools, **kwargs))


def test_mcp_discovery_marks_unknown_and_write_tools_unsafe_and_bounds_schemas(tmp_path):
    tools = [
        SdkMcpTool(name="search", description="Search", inputSchema={"type": "object"}, annotations=ToolAnnotations(readOnlyHint=True)),
        SdkMcpTool(name="delete", description="Delete", inputSchema={"type": "object"}),
    ]
    created_servers: list[FakeMcpServer] = []
    database, settings, created, _ = make_runtime(tmp_path, tools)

    def capture_server(**kwargs):
        server = FakeMcpServer(tools, **kwargs)
        created_servers.append(server)
        return server

    runtime = McpRuntime(database, settings, server_factory=capture_server)
    result = asyncio.run(runtime.refresh_tools("user-a", str(created.id)))

    assert created_servers[0].kwargs["tool_filter"] is None
    assert [(tool.name, tool.access, tool.requires_human_approval) for tool in result.tools] == [
        ("search", "read", False), ("delete", "write", True),
    ]
    row = database.get_mcp_server("user-a", str(created.id))
    assert row["status"] == "ready"


def assign_server(database, server_id):
    database.set_mcp_server_enabled("user-a", str(server_id), True)
    conversation = database.create_conversation("MCP", owner_id="user-a")
    database.set_conversation_connector_ids("user-a", conversation.id, [f"mcp:{server_id}"])
    return conversation.id


def test_conversation_activation_reports_a_publisher_sign_in(tmp_path):
    class DeniedServer(FakeMcpServer):
        async def __aenter__(self):
            raise ExceptionGroup("unhandled errors in a TaskGroup", [RuntimeError("Missing Authorization")])

    database = Database(tmp_path / "sign-in.sqlite3")
    database.initialize()
    settings = Settings(database_path=database.path, connector_token_encryption_key=Fernet.generate_key().decode())
    async def offline(endpoint, *, allow_loopback):
        return None, False

    runtime = McpRuntime(
        database, settings, server_factory=lambda **kwargs: DeniedServer([], **kwargs), access_probe=offline,
    )
    conversation_id = database.create_conversation("Chat", owner_id="user-a").id

    with pytest.raises(ConversationMcpError) as error:
        asyncio.run(runtime.activate_catalog_for_conversation(
            "user-a", conversation_id, catalog_id="0xarchive-io", name="0xArchive Market Data",
            endpoint="https://1.1.1.1/mcp", requires_token=False, auth_token=None,
        ))

    assert error.value.status_code == 422
    assert error.value.detail == "Ce serveur MCP demande une connexion au compte de l’éditeur."
    assert error.value.connect_url is None
    assert error.value.needs_token is False


def test_publisher_refusal_sends_a_public_link_or_asks_for_a_token(tmp_path):
    class DeniedServer(FakeMcpServer):
        async def __aenter__(self):
            raise ExceptionGroup("unhandled errors in a TaskGroup", [RuntimeError("Missing Authorization")])

    database = Database(tmp_path / "publisher-access.sqlite3")
    database.initialize()
    key = Fernet.generate_key().decode()
    settings = Settings(database_path=database.path, connector_token_encryption_key=key)
    conversation_id = database.create_conversation("Chat", owner_id="user-a").id
    answer = {"value": ("https://8.8.8.8/mcp-server", False)}

    async def probe(endpoint, *, allow_loopback):
        return answer["value"]

    runtime = McpRuntime(database, settings, server_factory=lambda **kwargs: DeniedServer([], **kwargs), access_probe=probe)

    async def activate(auth_token=None):
        return await runtime.activate_catalog_for_conversation(
            "user-a", conversation_id, catalog_id="0xarchive-io", name="0xArchive Market Data",
            endpoint="https://1.1.1.1/mcp", requires_token=False, auth_token=auth_token,
        )

    with pytest.raises(ConversationMcpError) as linked:
        asyncio.run(activate())
    assert linked.value.connect_url == "https://8.8.8.8/mcp-server"
    assert linked.value.needs_token is False

    with pytest.raises(ConversationMcpError):
        asyncio.run(activate("user-secret"))
    stored = database.list_mcp_servers("user-a")[-1]
    assert stored["encrypted_auth_token"] is None

    answer["value"] = ("http://127.0.0.1/private", True)
    with pytest.raises(ConversationMcpError) as token_needed:
        asyncio.run(activate())
    assert token_needed.value.connect_url is None
    assert token_needed.value.needs_token is True
    assert token_needed.value.detail == "Ce serveur MCP demande un jeton utilisateur."

    with pytest.raises(ConversationMcpError):
        asyncio.run(activate("user-secret"))
    saved = database.get_mcp_server("user-a", stored["id"])
    assert TokenVault(key).decrypt_payload(saved["encrypted_auth_token"]) == {"auth_token": "user-secret"}


class _ProbeResponse:
    def __init__(self, status_code, headers=None, text=""):
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text


class _ProbeClient:
    def __init__(self, post, get):
        self._post = post
        self._get = get
        self.fetched = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, **kwargs):
        return self._post

    async def get(self, url, **kwargs):
        self.fetched.append(url)
        return self._get


def test_publisher_access_reads_the_documentation_link_and_ignores_private_targets():
    metadata = (
        '{"resource_documentation":"https://8.8.8.8/mcp-server",'
        '"authorization_servers":["http://127.0.0.1/oauth"]}'
    )
    client = _ProbeClient(
        _ProbeResponse(401, {"WWW-Authenticate": 'Bearer realm="Archive", resource_metadata="https://1.1.1.1/meta"'}, "Missing Authorization"),
        _ProbeResponse(200, {}, metadata),
    )
    link, needs_token = asyncio.run(fetch_publisher_access(
        "https://1.1.1.1/mcp", allow_loopback=False, client_factory=lambda: client,
    ))
    assert link == "https://8.8.8.8/mcp-server"
    assert needs_token is False
    assert client.fetched == ["https://1.1.1.1/meta"]

    private = _ProbeClient(
        _ProbeResponse(401, {"WWW-Authenticate": 'Bearer realm="x", resource_metadata="http://127.0.0.1/meta"'}, "Missing Authorization. Send Bearer token"),
        _ProbeResponse(200, {}, "{}"),
    )
    link, needs_token = asyncio.run(fetch_publisher_access(
        "https://1.1.1.1/mcp", allow_loopback=False, client_factory=lambda: private,
    ))
    assert link is None
    assert needs_token is True
    assert private.fetched == []


def test_conversation_activation_approves_non_destructive_tools(tmp_path):
    tools = [
        SimpleNamespace(name="snapshot", description="Read chain data", input_schema={"type": "object"}, annotations=None),
        SimpleNamespace(name="wipe", description="Erase", input_schema={"type": "object"}, annotations=SimpleNamespace(destructiveHint=True)),
    ]
    database, settings, _, runtime = make_runtime(tmp_path, tools)
    conversation_id = database.create_conversation("Chat", owner_id="user-a").id

    server, connector_ids = asyncio.run(runtime.activate_catalog_for_conversation(
        "user-a", conversation_id, catalog_id="solana", name="Solana", endpoint="https://1.1.1.1/mcp",
        requires_token=False, auth_token=None,
    ))

    assert server.enabled is True
    assert server.approved_tool_names == ["snapshot"]
    assert [tool.access for tool in server.tools if tool.name == "wipe"] == ["write"]
    assert connector_ids == [f"mcp:{server.id}"]

    async def check_filter():
        async with runtime.open_approved_servers("user-a", connector_ids, conversation_id=conversation_id) as servers:
            assert servers[0].kwargs["tool_filter"](None, tools[0]) is True
            assert servers[0].kwargs["tool_filter"](None, tools[1]) is False
            assert servers[0].mcp_label == "Solana"
            assert servers[0].mcp_server_key == f"mcp_{str(server.id).replace('-', '')[:12]}"
            extractor = servers[0].kwargs["custom_data_extractor"]
            leaked = SimpleNamespace(is_error=True, arguments={"auth_token": "secret-token"}, tool_output="secret-output")
            assert extractor(leaked) == {"failed": True}
            assert "secret-token" not in str(extractor(leaked))
            assert extractor(SimpleNamespace(is_error=False)) == {"failed": False}
    asyncio.run(check_filter())

    again, same_ids = asyncio.run(runtime.activate_catalog_for_conversation(
        "user-a", conversation_id, catalog_id="solana", name="Solana", endpoint="https://1.1.1.1/mcp",
        requires_token=False, auth_token=None,
    ))
    assert again.id == server.id
    assert same_ids == connector_ids

    with pytest.raises(ConversationMcpError) as error:
        asyncio.run(runtime.activate_catalog_for_conversation(
            "user-a", conversation_id, catalog_id="paid", name="Paid", endpoint="https://8.8.4.4/mcp",
            requires_token=True, auth_token=None,
        ))
    assert error.value.status_code == 422
    assert len(database.list_mcp_servers("user-a")) == 2


def test_mcp_runtime_filters_to_approved_read_tools_and_isolates_users(tmp_path):
    database, settings, created, runtime = make_runtime(tmp_path, [mcp_tool("search"), mcp_tool("delete", False)])
    asyncio.run(runtime.refresh_tools("user-a", str(created.id)))
    McpService(database, settings).set_allowed_tools("user-a", str(created.id), ["search"])
    conversation_id = assign_server(database, created.id)

    async def run():
        async with runtime.open_approved_servers("user-a", [f"mcp:{created.id}"], conversation_id=conversation_id) as servers:
            assert len(servers) == 1
            assert servers[0].kwargs["tool_filter"](None, mcp_tool("search")) is True
            assert servers[0].kwargs["tool_filter"](None, mcp_tool("delete", False)) is False
            await servers[0].call_tool("search", {})
            database.set_mcp_server_enabled("user-a", str(created.id), False)
            with pytest.raises(McpAuthorizationError):
                await servers[0].call_tool("search", {})
        with pytest.raises(McpAuthorizationError):
            async with runtime.open_approved_servers("user-b", [f"mcp:{created.id}"], conversation_id=conversation_id):
                pass
    asyncio.run(run())


def test_hidden_http_401_is_reported_as_publisher_sign_in(tmp_path):
    class MCPError(Exception):
        pass

    class DeniedServer(FakeMcpServer):
        async def __aenter__(self):
            raise ExceptionGroup(
                "unhandled errors in a TaskGroup",
                [MCPError("Server returned an error response")],
            )

    database = Database(tmp_path / "opaque-auth.sqlite3")
    database.initialize()
    settings = Settings(database_path=database.path, connector_token_encryption_key=Fernet.generate_key().decode())
    created = McpService(database, settings).create_server(
        "user-a", McpServerCreate(name="Drive", url="https://1.1.1.1/mcp"),
    )

    async def probe(endpoint, *, allow_loopback):
        return "https://8.8.8.8/login", False

    runtime = McpRuntime(
        database, settings, server_factory=lambda **kwargs: DeniedServer([], **kwargs), access_probe=probe,
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(runtime.refresh_tools("user-a", str(created.id)))

    assert error.value.status_code == 422
    assert error.value.detail["connect_url"] == "https://8.8.8.8/login"
    row = database.get_mcp_server("user-a", str(created.id))
    assert row["last_error"] == "Ce serveur MCP demande une connexion au compte de l’éditeur."
    assert "Impossible de joindre" not in row["last_error"]


def test_mcp_discovery_timeout_is_bounded_and_status_error_is_sanitized(tmp_path):
    class SlowServer(FakeMcpServer):
        async def list_tools(self):
            await asyncio.sleep(1)
            return self.tools

    database, settings, created, _ = make_runtime(tmp_path, [])
    runtime = McpRuntime(database, settings, server_factory=lambda **kwargs: SlowServer([], **kwargs), operation_timeout_seconds=0.01)

    with pytest.raises(TimeoutError):
        asyncio.run(runtime.refresh_tools("user-a", str(created.id)))

    row = database.get_mcp_server("user-a", str(created.id))
    assert row["status"] == "error"
    assert row["last_error"] == "Impossible de joindre ou d’inspecter ce serveur MCP."


def test_public_endpoint_rejects_loopback_link_local_private_and_redirects():
    with pytest.raises(ValueError):
        validate_public_endpoint("http://127.0.0.1:8765/mcp")
    with pytest.raises(ValueError):
        validate_public_endpoint("http://169.254.169.254/latest/meta-data")
    with pytest.raises(ValueError):
        validate_public_endpoint("http://10.1.2.3/mcp")
    with pytest.raises(ValueError):
        validate_public_endpoint("http://localhost:8765/mcp", allow_loopback=True)
    assert validate_public_endpoint("http://127.0.0.1:8765/mcp", allow_loopback=True).startswith("http://127.0.0.1")

    async def exercise_client():
        factory = safe_mcp_http_client(allow_loopback=False)
        client = factory()
        assert isinstance(client, httpx2.AsyncClient)
        assert client.follow_redirects is False
        with pytest.raises(ValueError):
            await client.get("http://10.1.2.3/mcp")
        client = factory()
        client._transport = httpx2.MockTransport(
            lambda request: httpx2.Response(302, headers={"Location": "http://169.254.169.254/"}),
        )
        with pytest.raises(httpx2.RequestError, match="redirect"):
            await client.get("https://8.8.8.8/mcp")

        client = factory(headers={"Authorization": "Bearer secret-value"})
        client._transport = httpx2.MockTransport(lambda request: httpx2.Response(200))
        with pytest.raises(ValueError, match="HTTPS"):
            await client.get("http://8.8.8.8/mcp")

    asyncio.run(exercise_client())


def test_mcp_credentials_require_https_at_storage_time(tmp_path):
    database = Database(tmp_path / "mcp-credential-transport.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "mcp-credential-transport.sqlite3",
        openai_api_key="",
        openai_model="",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    service = McpService(database, settings)

    with pytest.raises(HTTPException, match="HTTPS"):
        service.create_server("user-1", McpServerCreate(
            name="Insecure", url="http://8.8.8.8/mcp", auth_token="secret-value",
        ))

    server = service.create_server("user-1", McpServerCreate(
        name="No token", url="http://8.8.8.8/mcp",
    ))
    with pytest.raises(HTTPException, match="HTTPS"):
        service.store_auth_token("user-1", str(server.id), "secret-value")


def test_call_refuses_write_unknown_unassigned_and_unavailable_tools(tmp_path):
    database, settings, created, runtime = make_runtime(tmp_path, [mcp_tool("search"), mcp_tool("delete", False)])
    asyncio.run(runtime.refresh_tools("user-a", str(created.id)))
    McpService(database, settings).set_allowed_tools("user-a", str(created.id), ["search"])
    conversation_id = assign_server(database, created.id)
    server_id = str(created.id)
    database.set_mcp_server_approved_tools("user-a", server_id, ["search", "delete"])

    with pytest.raises(McpAuthorizationError, match="not authorized"):
        runtime.authorize_tool_call("user-a", server_id, "delete", conversation_id, None)
    with pytest.raises(McpAuthorizationError, match="unknown"):
        runtime.authorize_tool_call("user-a", server_id, "missing", conversation_id, None)
    other = database.create_conversation("Other", owner_id="user-a")
    with pytest.raises(McpAuthorizationError, match="not assigned"):
        runtime.authorize_tool_call("user-a", server_id, "search", other.id, None)
    with pytest.raises(McpAuthorizationError, match="not assigned"):
        runtime.authorize_tool_call("user-a", server_id, "search", conversation_id, "profile-1")
    database.replace_agent_mcp_tools("user-a", "profile-1", [(server_id, "search")])
    runtime.authorize_tool_call("user-a", server_id, "search", conversation_id, "profile-1")

    database.update_mcp_server_tools("user-a", server_id, [], status="error", error="down")
    with pytest.raises(McpAuthorizationError, match="unavailable"):
        runtime.authorize_tool_call("user-a", server_id, "search", conversation_id, None)


def test_connection_failure_and_logs_hide_credentials(tmp_path, caplog):
    class FailingServer(FakeMcpServer):
        async def __aenter__(self):
            raise RuntimeError("Authorization: Bearer sensitive-token-value")

    database, settings, created, runtime = make_runtime(tmp_path, [mcp_tool("search")])
    asyncio.run(runtime.refresh_tools("user-a", str(created.id)))
    McpService(database, settings).set_allowed_tools("user-a", str(created.id), ["search"])
    conversation_id = assign_server(database, created.id)
    failing = McpRuntime(database, settings, server_factory=lambda **kwargs: FailingServer([], **kwargs))

    async def connect():
        async with failing.open_approved_servers("user-a", [f"mcp:{created.id}"], conversation_id=conversation_id):
            pass

    with caplog.at_level(logging.WARNING, logger="mutual_aid.mcp"), pytest.raises(
        McpAuthorizationError, match="could not be connected",
    ) as caught:
        asyncio.run(connect())
    assert "sensitive-token-value" not in str(caught.value)
    assert "sensitive-token-value" not in caplog.text

    install_secret_log_filter()
    with caplog.at_level(logging.WARNING, logger="mutual_aid.mcp"):
        logging.getLogger("mutual_aid.mcp").warning("Authorization: Bearer sensitive-token-value")
    assert "sensitive-token-value" not in caplog.text


def test_oversized_tool_output_is_rejected():
    rejected = _limit_tool_output.guardrail_function(SimpleNamespace(output="x" * (MAX_MCP_TOOL_OUTPUT_BYTES + 1)))
    assert rejected.behavior["type"] == "reject_content"
