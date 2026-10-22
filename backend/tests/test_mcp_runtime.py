import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from mcp.types import Tool as SdkMcpTool, ToolAnnotations

from app.config import Settings
from app.connectors.mcp_models import McpServerCreate
from app.connectors.mcp_runtime import McpRuntime
from app.connectors.mcp_service import McpService
from app.db import Database


class FakeMcpServer:
    def __init__(self, tools, **kwargs):
        self.tools = tools
        self.kwargs = kwargs
        self.entered = False

    async def __aenter__(self):
        self.entered = True
        return self

    async def __aexit__(self, *args):
        self.entered = False

    async def list_tools(self):
        return self.tools


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
    database, _, created, runtime = make_runtime(tmp_path, tools)

    result = asyncio.run(runtime.refresh_tools("user-a", str(created.id)))

    assert [(tool.name, tool.access, tool.requires_human_approval) for tool in result.tools] == [
        ("search", "read", False), ("delete", "write", True),
    ]
    row = database.get_mcp_server("user-a", str(created.id))
    assert row["status"] == "ready"


def test_mcp_runtime_filters_to_approved_read_tools_and_isolates_users(tmp_path):
    database, settings, created, runtime = make_runtime(tmp_path, [mcp_tool("search"), mcp_tool("delete", False)])
    asyncio.run(runtime.refresh_tools("user-a", str(created.id)))
    McpService(database, settings).set_allowed_tools("user-a", str(created.id), ["search"])

    async def run():
        async with runtime.open_approved_servers("user-a", [f"mcp:{created.id}"]) as servers:
            assert len(servers) == 1
            assert servers[0].kwargs["tool_filter"](None, mcp_tool("search")) is True
            assert servers[0].kwargs["tool_filter"](None, mcp_tool("delete", False)) is False
        with pytest.raises(Exception):
            async with runtime.open_approved_servers("user-b", [f"mcp:{created.id}"]):
                pass
    asyncio.run(run())


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
