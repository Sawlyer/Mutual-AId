import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Any

import httpx2
from agents import ToolGuardrailFunctionOutput
from agents.decorators import tool_output_guardrail
from agents.mcp import MCPServerStreamableHttp
from fastapi import HTTPException
from pydantic import ValidationError

from app.config import Settings
from app.connectors.mcp_models import (
    MAX_MCP_TOOL_OUTPUT_BYTES,
    MAX_MCP_TOOL_SCHEMA_BYTES,
    MAX_MCP_TOOLS_PER_SERVER,
    McpServerCreate,
    McpServerRead,
    McpToolRead,
    validate_public_endpoint,
)
from app.connectors.mcp_service import McpService
from app.connectors.oauth import TokenVault
from app.db import Database

logger = logging.getLogger("mutual_aid.mcp")
_TOOL_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_BEARER = re.compile(r"(?i)\bBearer\s+\S+")
_AUTHORIZATION = re.compile(r"(?i)(authorization\s*[:=]\s*)\S+")
_AUTH_TOKEN = re.compile(r"(?i)(auth_token[\"']?\s*[:=]\s*[\"']?)[^\"'\s,}]+")
MCP_CONNECTOR_PREFIX = "mcp:"
MAX_CONVERSATION_CONNECTORS = 5


class SecretRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        rendered = _redact(record.getMessage())
        record.msg = rendered
        record.args = ()
        record.message = rendered
        if record.exc_text:
            record.exc_text = _redact(record.exc_text)
        if record.exc_info and record.exc_info[1] is not None:
            redacted = _redact(str(record.exc_info[1]))
            if redacted != str(record.exc_info[1]):
                record.exc_info = (record.exc_info[0], RuntimeError(redacted), None)
        return True


def install_secret_log_filter() -> None:
    redactor = SecretRedactionFilter()
    for name in ("", "httpx", "httpcore", "mcp", "mutual_aid", "mutual_aid.mcp"):
        target = logging.getLogger(name)
        if not any(isinstance(item, SecretRedactionFilter) for item in target.filters):
            target.addFilter(redactor)


_SIGN_IN_REQUIRED = "Ce serveur MCP demande une connexion au compte de l’éditeur."
_TOKEN_REQUIRED = "Ce serveur MCP demande un jeton utilisateur."
_RESOURCE_METADATA = re.compile(r'resource_metadata=(?:"([^"]+)"|\'([^\']+)\'|([^\s,]+))')
_INITIALIZE_BODY = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "mutual-aid", "version": "0"},
    },
}


def refusal_detail(
    message: str, *, connect_url: str | None = None, needs_token: bool = False,
) -> str | dict[str, object]:
    if connect_url:
        return {"message": message, "connect_url": connect_url}
    if needs_token:
        return {"message": message, "needs_token": True}
    return message


def _header(headers: object, name: str) -> str:
    items = getattr(headers, "items", None)
    if not callable(items):
        return ""
    for key, value in items():
        if str(key).lower() == name and isinstance(value, str):
            return value
    return ""


def _public_https_link(value: object, *, allow_loopback: bool) -> str | None:
    if not isinstance(value, str) or len(value) > 300 or not value.startswith("https://"):
        return None
    try:
        return validate_public_endpoint(value, resolve=True, allow_loopback=allow_loopback)
    except ValueError:
        return None


def link_from_resource_metadata(payload: object, *, allow_loopback: bool) -> str | None:
    if not isinstance(payload, dict):
        return None
    documentation = _public_https_link(payload.get("resource_documentation"), allow_loopback=allow_loopback)
    if documentation:
        return documentation
    servers = payload.get("authorization_servers")
    if isinstance(servers, list):
        for item in servers:
            link = _public_https_link(item, allow_loopback=allow_loopback)
            if link:
                return link
    return None


def _response_text(response: object) -> str:
    text = getattr(response, "text", "")
    return text[:4000] if isinstance(text, str) else ""


async def fetch_publisher_access(
    endpoint: str, *, allow_loopback: bool, client_factory: Callable[[], Any] | None = None,
) -> tuple[str | None, bool]:
    if _public_https_link(endpoint, allow_loopback=allow_loopback) is None:
        return None, False
    factory = client_factory or (lambda: httpx2.AsyncClient(timeout=4.0, follow_redirects=False))
    try:
        async with factory() as client:
            response = await client.post(
                endpoint,
                json=_INITIALIZE_BODY,
                headers={"Accept": "application/json, text/event-stream", "Content-Type": "application/json"},
            )
            status = getattr(response, "status_code", None)
            if status != 401:
                return None, False
            authenticate = _header(response.headers, "www-authenticate")
            match = _RESOURCE_METADATA.search(authenticate)
            raw_metadata = match.group(1) or match.group(2) or match.group(3) if match else None
            metadata_url = _public_https_link(raw_metadata, allow_loopback=allow_loopback)
            if metadata_url:
                meta = await client.get(metadata_url, headers={"Accept": "application/json"})
                if getattr(meta, "status_code", None) == 200:
                    try:
                        payload = json.loads(_response_text(meta))
                    except json.JSONDecodeError:
                        payload = None
                    link = link_from_resource_metadata(payload, allow_loopback=allow_loopback)
                    if link:
                        return link, False
            folded = _response_text(response).casefold()
            if "missing authorization" in folded or "bearer" in folded:
                return None, True
    except Exception as error:
        logger.warning("MCP publisher access probe failed (%s)", type(error).__name__)
        return None, False
    return None, False


def _iter_exceptions(error: BaseException):
    pending = [error]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        if isinstance(current, BaseExceptionGroup):
            pending.extend(current.exceptions)
        if current.__cause__ is not None:
            pending.append(current.__cause__)
        if current.__context__ is not None:
            pending.append(current.__context__)


def _requires_publisher_sign_in(error: BaseException) -> bool:
    for item in _iter_exceptions(error):
        if "missing authorization" in str(item).casefold():
            return True
        status = getattr(item, "status_code", None)
        response = getattr(item, "response", None)
        if status == 401 or getattr(response, "status_code", None) == 401:
            return True
    return False


def _redact(value: str) -> str:
    value = _BEARER.sub("Bearer [redacted]", value)
    value = _AUTHORIZATION.sub(r"\1[redacted]", value)
    return _AUTH_TOKEN.sub(r"\1[redacted]", value)


def safe_mcp_http_client(*, allow_loopback: bool) -> Callable[..., httpx2.AsyncClient]:
    async def guard_request(request: httpx2.Request) -> None:
        if request.url.scheme != "https" and request.headers.get("authorization"):
            raise ValueError("MCP credentials require HTTPS")
        validate_public_endpoint(str(request.url), resolve=True, allow_loopback=allow_loopback)

    async def reject_redirect(response: httpx2.Response) -> None:
        if response.is_redirect:
            await response.aclose()
            raise httpx2.RequestError("MCP redirect was refused")

    def factory(
        headers: dict[str, str] | None = None, timeout: Any = None, auth: Any = None,
    ) -> httpx2.AsyncClient:
        kwargs: dict[str, Any] = {
            "follow_redirects": False,
            "event_hooks": {"request": [guard_request], "response": [reject_redirect]},
        }
        if timeout is not None:
            kwargs["timeout"] = timeout
        if headers is not None:
            kwargs["headers"] = headers
        if auth is not None:
            kwargs["auth"] = auth
        return httpx2.AsyncClient(**kwargs)

    return factory


def _mcp_call_status(context: object) -> dict[str, bool]:
    """Record only whether the MCP call failed. Arguments and output stay on the server."""
    return {"failed": getattr(context, "is_error", None) is True}


class _AuthorizedMcpServer:
    """Re-checks the database immediately before a remote tool call."""

    def __init__(self, inner: object, authorize: Callable[[str], None], display_name: str) -> None:
        self._inner = inner
        self._authorize = authorize
        inner_name = getattr(inner, "name", None)
        self.mcp_server_key = inner_name if isinstance(inner_name, str) else ""
        self.mcp_label = display_name

    def __getattr__(self, name: str) -> object:
        return getattr(self._inner, name)

    async def __aenter__(self) -> "_AuthorizedMcpServer":
        await self._inner.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> object:
        return await self._inner.__aexit__(exc_type, exc, traceback)

    async def call_tool(self, tool_name: str, arguments: dict[str, Any] | None = None, meta: dict[str, Any] | None = None) -> object:
        self._authorize(tool_name)
        caller = self._inner.call_tool
        if meta is None:
            return await caller(tool_name, arguments)
        return await caller(tool_name, arguments, meta)


class McpAuthorizationError(Exception):
    pass


class ConversationMcpError(Exception):
    def __init__(
        self, status_code: int, detail: str, *, connect_url: str | None = None, needs_token: bool = False,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.connect_url = connect_url
        self.needs_token = needs_token


def _annotation(annotations: object, name: str) -> object:
    if isinstance(annotations, dict):
        snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
        return annotations.get(name, annotations.get(snake))
    if annotations is None:
        return None
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    return getattr(annotations, name, getattr(annotations, snake, None))


def _read_only(tool: object) -> bool:
    annotations = getattr(tool, "annotations", None)
    return _annotation(annotations, "readOnlyHint") is True and _annotation(annotations, "destructiveHint") is not True


def _tool_descriptor(tool: object) -> McpToolRead:
    name = getattr(tool, "name", None)
    description = getattr(tool, "description", "") or ""
    schema = getattr(tool, "inputSchema", getattr(tool, "input_schema", {})) or {}
    if not isinstance(name, str) or not _TOOL_NAME.fullmatch(name):
        raise ValueError("MCP server returned an invalid tool name")
    if not isinstance(description, str) or not isinstance(schema, dict):
        raise ValueError("MCP server returned an invalid tool descriptor")
    if len(json.dumps(schema, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) > MAX_MCP_TOOL_SCHEMA_BYTES:
        raise ValueError("MCP tool schema exceeds the size limit")
    read_only = _read_only(tool)
    return McpToolRead(
        name=name,
        description=description[:2000],
        input_schema=schema,
        access="read" if read_only else "write",
        requires_human_approval=not read_only,
    )


def _conversation_descriptor(tool: object) -> McpToolRead:
    """Tools stay callable after an explicit conversation activation, except destructive ones."""
    descriptor = _tool_descriptor(tool)
    destructive = _annotation(getattr(tool, "annotations", None), "destructiveHint") is True
    if destructive:
        return descriptor.model_copy(update={"access": "write", "requires_human_approval": True})
    return descriptor.model_copy(update={"access": "read", "requires_human_approval": False})


@tool_output_guardrail
def _limit_tool_output(data: Any) -> ToolGuardrailFunctionOutput:
    try:
        encoded = json.dumps(data.output, ensure_ascii=False, default=str).encode("utf-8")
    except (TypeError, ValueError):
        return ToolGuardrailFunctionOutput.reject_content("The MCP tool returned an unsupported result.")
    if len(encoded) > MAX_MCP_TOOL_OUTPUT_BYTES:
        return ToolGuardrailFunctionOutput.reject_content("The MCP tool result exceeded the configured size limit.")
    return ToolGuardrailFunctionOutput.allow()


class McpRuntime:
    """Owns bounded remote MCP discovery and per-user approved MCP sessions."""

    def __init__(
        self,
        database: Database,
        settings: Settings,
        server_factory: Callable[..., object] = MCPServerStreamableHttp,
        operation_timeout_seconds: float = 10,
        access_probe: Callable[..., Any] | None = None,
    ) -> None:
        self.database = database
        self.settings = settings
        self.service = McpService(database, settings)
        self.server_factory = server_factory
        self.operation_timeout_seconds = operation_timeout_seconds
        self.access_probe = access_probe or fetch_publisher_access
        install_secret_log_filter()

    async def refresh_tools(self, user_id: str, server_id: str) -> McpServerRead:
        row = self.service.get_server(user_id, server_id)
        try:
            try:
                remote_tools = await asyncio.wait_for(
                    self._discover_tools(row), timeout=self.operation_timeout_seconds,
                )
            except asyncio.TimeoutError as error:
                raise TimeoutError("MCP discovery timed out") from error
            if len(remote_tools) > MAX_MCP_TOOLS_PER_SERVER:
                raise ValueError("MCP server returned too many tools")
            classify = _conversation_descriptor if row["enabled"] else _tool_descriptor
            tools = [classify(tool).model_dump(mode="json") for tool in remote_tools]
            self.database.update_mcp_server_tools(user_id, server_id, tools)
        except Exception as error:
            if _requires_publisher_sign_in(error):
                message, connect_url, needs_token = await self._describe_refusal(str(row["url"]))
                self.database.update_mcp_server_tools(
                    user_id, server_id, [], status="error", error=message,
                )
                raise HTTPException(
                    status_code=422,
                    detail=refusal_detail(message, connect_url=connect_url, needs_token=needs_token),
                ) from error
            self.database.update_mcp_server_tools(
                user_id, server_id, [], status="error", error="Impossible de joindre ou d’inspecter ce serveur MCP.",
            )
            logger.warning("MCP discovery failed for server %s (%s)", server_id, type(error).__name__)
            raise
        updated = self.database.get_mcp_server(user_id, server_id)
        assert updated is not None
        return self.service._read(updated)

    async def activate_catalog_for_conversation(
        self,
        user_id: str,
        conversation_id: str,
        *,
        catalog_id: str,
        name: str,
        endpoint: str,
        requires_token: bool,
        auth_token: str | None,
    ) -> tuple[McpServerRead, list[str]]:
        existing = next(
            (row for row in reversed(self.database.list_mcp_servers(user_id)) if row.get("catalog_id") == catalog_id),
            None,
        )
        if existing is None:
            if requires_token and not auth_token:
                raise ConversationMcpError(422, "Ce serveur MCP demande un jeton utilisateur.")
            try:
                await asyncio.to_thread(
                    validate_public_endpoint, endpoint, resolve=True,
                    allow_loopback=self.settings.mcp_allow_loopback,
                )
                created = self.service.create_server(user_id, McpServerCreate(
                    name=name[:80], url=endpoint, catalog_id=catalog_id,
                    auth_token=auth_token if requires_token else None,
                ))
            except (ValidationError, ValueError) as error:
                raise ConversationMcpError(422, "L’adresse publiée de ce serveur MCP n’est pas utilisable.") from error
            server_id = str(created.id)
        else:
            server_id = str(existing["id"])
            asked_for_token = existing.get("last_error") == _TOKEN_REQUIRED
            if auth_token and (requires_token or asked_for_token):
                self.service.store_auth_token(user_id, server_id, auth_token)
            elif requires_token and not existing.get("encrypted_auth_token"):
                raise ConversationMcpError(422, _TOKEN_REQUIRED)
        server = await self._refresh_conversation_tools(user_id, server_id)
        connector_id = f"{MCP_CONNECTOR_PREFIX}{server_id}"
        current = self.database.get_conversation_connector_ids(user_id, conversation_id)
        if connector_id not in current and len(current) >= MAX_CONVERSATION_CONNECTORS:
            raise ConversationMcpError(409, "Cette conversation a déjà le nombre maximal de connecteurs.")
        if connector_id not in current:
            current = [*current, connector_id]
            self.database.set_conversation_connector_ids(user_id, conversation_id, current)
        return server, current

    async def _refresh_conversation_tools(self, user_id: str, server_id: str) -> McpServerRead:
        row = self.service.get_server(user_id, server_id)
        try:
            try:
                remote_tools = await asyncio.wait_for(
                    self._discover_tools(row), timeout=self.operation_timeout_seconds,
                )
            except asyncio.TimeoutError as error:
                raise TimeoutError("MCP discovery timed out") from error
            if len(remote_tools) > MAX_MCP_TOOLS_PER_SERVER:
                raise ValueError("MCP server returned too many tools")
            tools: list[dict[str, object]] = []
            for tool in remote_tools:
                try:
                    tools.append(_conversation_descriptor(tool).model_dump(mode="json"))
                except ValueError:
                    continue
            readable = [str(tool["name"]) for tool in tools if tool.get("access") == "read"]
            self.database.update_mcp_server_tools(user_id, server_id, tools)
            if not readable:
                self.database.set_mcp_server_enabled(user_id, server_id, False)
                raise ConversationMcpError(422, "Ce serveur ne publie aucun outil utilisable dans la conversation.")
            self.database.set_mcp_server_approved_tools(user_id, server_id, readable)
            return self.service.set_enabled(user_id, server_id, True)
        except (ConversationMcpError, HTTPException):
            raise
        except Exception as error:
            if _requires_publisher_sign_in(error):
                message, connect_url, needs_token = await self._describe_refusal(str(row["url"]))
                self.database.update_mcp_server_tools(
                    user_id, server_id, [], status="error", error=message,
                )
                raise ConversationMcpError(
                    422, message, connect_url=connect_url, needs_token=needs_token,
                ) from error
            self.database.update_mcp_server_tools(
                user_id, server_id, [], status="error", error="Impossible de joindre ou d’inspecter ce serveur MCP.",
            )
            logger.warning("MCP discovery failed for server %s (%s)", server_id, type(error).__name__)
            raise

    async def _describe_refusal(self, endpoint: str) -> tuple[str, str | None, bool]:
        try:
            connect_url, needs_token = await self.access_probe(
                endpoint, allow_loopback=self.settings.mcp_allow_loopback,
            )
        except Exception as error:
            logger.warning("MCP publisher access probe failed (%s)", type(error).__name__)
            connect_url, needs_token = None, False
        connect_url = _public_https_link(connect_url, allow_loopback=self.settings.mcp_allow_loopback)
        if connect_url:
            return _SIGN_IN_REQUIRED, connect_url, False
        if needs_token:
            return _TOKEN_REQUIRED, None, True
        return _SIGN_IN_REQUIRED, None, False

    async def _discover_tools(self, row: dict[str, object]) -> list[object]:
        await asyncio.to_thread(
            validate_public_endpoint, str(row["url"]), resolve=True, allow_loopback=self.settings.mcp_allow_loopback,
        )
        server = self._make_server(row, approved_names=None, granted_names=None)
        async with server as connected:
            return await connected.list_tools()

    def validate_selection(self, user_id: str, connector_ids: list[str]) -> None:
        dynamic = [connector_id for connector_id in connector_ids if connector_id.startswith(MCP_CONNECTOR_PREFIX)]
        if len(dynamic) != len(connector_ids):
            raise McpAuthorizationError("A non-MCP connector was passed to the MCP runtime")
        if len(set(dynamic)) != len(dynamic):
            raise McpAuthorizationError("Duplicate MCP server selection")
        for connector_id in dynamic:
            server_id = connector_id.removeprefix(MCP_CONNECTOR_PREFIX)
            row = self.database.get_mcp_server(user_id, server_id)
            if row is None or row["status"] != "ready" or not row["enabled"]:
                raise McpAuthorizationError("MCP server is unavailable")
            tools = json.loads(str(row["discovered_tools_json"]))
            approved = set(json.loads(str(row["approved_tools_json"])))
            readable = {tool["name"] for tool in tools if tool.get("access") == "read"}
            if not approved or not approved.issubset(readable):
                raise McpAuthorizationError("MCP tools are not approved")

    def authorize_tool_call(
        self, user_id: str, server_id: str, tool_name: str, conversation_id: str, agent_profile_id: str | None,
    ) -> None:
        row = self.database.get_mcp_server(user_id, server_id)
        if row is None or row["status"] != "ready" or not row["enabled"]:
            raise McpAuthorizationError("MCP server is unavailable")
        selected = set(self.database.get_conversation_connector_ids(user_id, conversation_id))
        if f"{MCP_CONNECTOR_PREFIX}{server_id}" not in selected:
            raise McpAuthorizationError("MCP server is not assigned")
        tools = json.loads(str(row["discovered_tools_json"]))
        known = {tool.get("name"): tool for tool in tools if isinstance(tool, dict)}
        tool = known.get(tool_name)
        if tool is None:
            raise McpAuthorizationError("MCP tool is unknown")
        if tool.get("access") != "read":
            raise McpAuthorizationError("MCP tool is not authorized")
        approved = set(json.loads(str(row["approved_tools_json"])))
        if tool_name not in approved:
            raise McpAuthorizationError("MCP tool is not approved")
        if agent_profile_id and not self.database.agent_has_mcp_tool(user_id, agent_profile_id, server_id, tool_name):
            raise McpAuthorizationError("MCP tool is not assigned")

    @asynccontextmanager
    async def open_approved_servers(
        self, user_id: str, server_ids: list[str], *, conversation_id: str, agent_profile_id: str | None = None,
    ) -> AsyncIterator[list[object]]:
        if len(set(server_ids)) != len(server_ids):
            raise McpAuthorizationError("Duplicate MCP server selection")
        async with AsyncExitStack() as stack:
            servers: list[object] = []
            for connector_id in server_ids:
                if not connector_id.startswith(MCP_CONNECTOR_PREFIX):
                    raise McpAuthorizationError("Invalid MCP connector id")
                server_id = connector_id.removeprefix(MCP_CONNECTOR_PREFIX)
                row = self.database.get_mcp_server(user_id, server_id)
                if row is None or row["status"] != "ready" or not row["enabled"]:
                    raise McpAuthorizationError("MCP server is unavailable")
                selected = set(self.database.get_conversation_connector_ids(user_id, conversation_id))
                if connector_id not in selected:
                    raise McpAuthorizationError("MCP server is not assigned")
                tools = json.loads(str(row["discovered_tools_json"]))
                approved = set(json.loads(str(row["approved_tools_json"])))
                readable = {tool["name"] for tool in tools if tool.get("access") == "read"}
                if not approved or not approved.issubset(readable):
                    raise McpAuthorizationError("MCP tools are not approved")
                granted = None
                if agent_profile_id is not None:
                    granted = {
                        item["tool_name"] for item in self.database.list_agent_mcp_tools(user_id, agent_profile_id)
                        if item["server_id"] == server_id and item["tool_name"] in approved
                    }
                    if not granted:
                        raise McpAuthorizationError("MCP tool is not assigned")
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(
                            validate_public_endpoint, str(row["url"]), resolve=True,
                            allow_loopback=self.settings.mcp_allow_loopback,
                        ),
                        timeout=self.operation_timeout_seconds,
                    )
                    server = self._make_server(row, approved_names=approved, granted_names=granted)
                    await asyncio.wait_for(stack.enter_async_context(server), timeout=self.operation_timeout_seconds)
                except Exception as error:
                    logger.warning("MCP connection failed for server %s (%s)", server_id, type(error).__name__)
                    raise McpAuthorizationError("MCP server could not be connected") from error
                servers.append(_AuthorizedMcpServer(
                    server,
                    lambda tool_name, server_id=server_id: self.authorize_tool_call(
                        user_id, server_id, tool_name, conversation_id, agent_profile_id,
                    ),
                    str(row["name"]),
                ))
            yield servers

    def _make_server(self, row: dict[str, object], approved_names: set[str] | None, granted_names: set[str] | None = None) -> object:
        params: dict[str, object] = {
            "url": str(row["url"]), "timeout": self.operation_timeout_seconds,
            "sse_read_timeout": self.operation_timeout_seconds,
            "httpx_client_factory": safe_mcp_http_client(allow_loopback=self.settings.mcp_allow_loopback),
        }
        encrypted_token = row.get("encrypted_auth_token")
        if encrypted_token:
            key = self.settings.connector_token_key
            if not key:
                raise ValueError("MCP credential encryption is not configured")
            token = TokenVault(key).decrypt_payload(str(encrypted_token)).get("auth_token")
            if not isinstance(token, str) or not token:
                raise ValueError("MCP server credential is invalid")
            params["headers"] = {"Authorization": f"Bearer {token}"}

        def approved_tool_filter(_context: object, tool: object) -> bool:
            name = getattr(tool, "name", None)
            destructive = _annotation(getattr(tool, "annotations", None), "destructiveHint") is True
            allowed = approved_names is not None and name in approved_names and not destructive
            if granted_names is not None:
                allowed = allowed and name in granted_names
            return allowed

        tool_filter = approved_tool_filter if approved_names is not None else None

        name = f"mcp_{str(row['id']).replace('-', '')[:12]}"
        return self.server_factory(
            name=name,
            params=params,
            cache_tools_list=False,
            max_retry_attempts=0,
            max_list_pages=4,
            tool_filter=tool_filter,
            require_approval="never",
            failure_error_function=None,
            tool_output_guardrails=[_limit_tool_output],
            custom_data_extractor=_mcp_call_status,
        )
