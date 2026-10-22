import asyncio
from contextlib import AsyncExitStack, asynccontextmanager
import json
import logging
import re
from collections.abc import AsyncIterator, Callable
from typing import Any

from agents import ToolGuardrailFunctionOutput
from agents.decorators import tool_output_guardrail
from agents.mcp import MCPServerStreamableHttp

from app.config import Settings
from app.connectors.mcp_models import (
    MAX_MCP_TOOL_OUTPUT_BYTES,
    MAX_MCP_TOOL_SCHEMA_BYTES,
    MAX_MCP_TOOLS_PER_SERVER,
    McpServerRead,
    McpToolRead,
    validate_public_endpoint,
)
from app.connectors.mcp_service import McpService
from app.connectors.oauth import TokenVault
from app.db import Database


logger = logging.getLogger("mutual_aid.mcp")
_TOOL_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
MCP_CONNECTOR_PREFIX = "mcp:"


class McpAuthorizationError(Exception):
    pass


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
    ) -> None:
        self.database = database
        self.settings = settings
        self.service = McpService(database, settings)
        self.server_factory = server_factory
        self.operation_timeout_seconds = operation_timeout_seconds

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
            tools = [_tool_descriptor(tool).model_dump(mode="json") for tool in remote_tools]
            self.database.update_mcp_server_tools(user_id, server_id, tools)
        except Exception as error:
            self.database.update_mcp_server_tools(
                user_id, server_id, [], status="error", error="Impossible de joindre ou d’inspecter ce serveur MCP.",
            )
            logger.warning("MCP discovery failed for server %s (%s)", server_id, type(error).__name__)
            raise
        updated = self.database.get_mcp_server(user_id, server_id)
        assert updated is not None
        return self.service._read(updated)

    async def _discover_tools(self, row: dict[str, object]) -> list[object]:
        await asyncio.to_thread(validate_public_endpoint, str(row["url"]))
        server = self._make_server(row, approved_names=None)
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
            if row is None or row["status"] != "ready":
                raise McpAuthorizationError("MCP server is unavailable")
            tools = json.loads(str(row["discovered_tools_json"]))
            approved = set(json.loads(str(row["approved_tools_json"])))
            readable = {tool["name"] for tool in tools if tool.get("access") == "read"}
            if not approved or not approved.issubset(readable):
                raise McpAuthorizationError("MCP tools are not approved")

    @asynccontextmanager
    async def open_approved_servers(self, user_id: str, server_ids: list[str]) -> AsyncIterator[list[object]]:
        if len(set(server_ids)) != len(server_ids):
            raise McpAuthorizationError("Duplicate MCP server selection")
        async with AsyncExitStack() as stack:
            servers: list[object] = []
            for connector_id in server_ids:
                if not connector_id.startswith(MCP_CONNECTOR_PREFIX):
                    raise McpAuthorizationError("Invalid MCP connector id")
                server_id = connector_id.removeprefix(MCP_CONNECTOR_PREFIX)
                row = self.database.get_mcp_server(user_id, server_id)
                if row is None or row["status"] != "ready":
                    raise McpAuthorizationError("MCP server is unavailable")
                tools = json.loads(str(row["discovered_tools_json"]))
                approved = set(json.loads(str(row["approved_tools_json"])))
                readable = {tool["name"] for tool in tools if tool.get("access") == "read"}
                if not approved or not approved.issubset(readable):
                    raise McpAuthorizationError("MCP tools are not approved")
                try:
                    await asyncio.wait_for(
                        asyncio.to_thread(validate_public_endpoint, str(row["url"])),
                        timeout=self.operation_timeout_seconds,
                    )
                    server = self._make_server(row, approved_names=approved)
                    await asyncio.wait_for(
                        stack.enter_async_context(server),
                        timeout=self.operation_timeout_seconds,
                    )
                except Exception as error:
                    logger.warning("MCP connection failed for server %s (%s)", server_id, type(error).__name__)
                    raise McpAuthorizationError("MCP server could not be connected") from error
                servers.append(server)
            yield servers

    def _make_server(self, row: dict[str, object], approved_names: set[str] | None) -> object:
        params: dict[str, object] = {
            "url": str(row["url"]), "timeout": self.operation_timeout_seconds,
            "sse_read_timeout": self.operation_timeout_seconds,
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

        def tool_filter(_context: object, tool: object) -> bool:
            return approved_names is None or (getattr(tool, "name", None) in approved_names and _read_only(tool))

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
        )
