from datetime import datetime
from ipaddress import ip_address
import socket
from urllib.parse import urlsplit
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


MAX_MCP_SERVERS_PER_USER = 50
MAX_MCP_TOOLS_PER_SERVER = 100
MAX_MCP_TOOL_SCHEMA_BYTES = 32_000
MAX_MCP_TOOL_OUTPUT_BYTES = 128_000
_LOOPBACK = ip_address("127.0.0.1")


def normalize_mcp_endpoint(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("MCP endpoint must use an http or https URL with a hostname")
    if parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise ValueError("MCP endpoint cannot include credentials, query parameters, or a fragment")
    return value


def validate_public_endpoint(value: str, *, resolve: bool = True, allow_loopback: bool = False) -> str:
    value = normalize_mcp_endpoint(value)
    parsed = urlsplit(value)
    host = parsed.hostname.rstrip(".").lower()
    literal_loopback = _is_literal_loopback(host)
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal", ".test")):
        raise ValueError("MCP endpoint must use a public host")
    if literal_loopback and not allow_loopback:
        raise ValueError("MCP endpoint must resolve only to public IP addresses")
    try:
        addresses = {ip_address(host)}
    except ValueError:
        if not resolve:
            return value
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            addresses = {ip_address(result[4][0]) for result in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)}
        except OSError as error:
            raise ValueError("MCP endpoint hostname could not be resolved") from error
    if allow_loopback and addresses == {_LOOPBACK}:
        return value
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("MCP endpoint must resolve only to public IP addresses")
    return value


def _is_literal_loopback(host: str) -> bool:
    try:
        return ip_address(host) == _LOOPBACK
    except ValueError:
        return False


class McpServerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=2048)
    auth_token: str | None = Field(default=None, min_length=1, max_length=4096, repr=False)
    catalog_id: str | None = Field(default=None, min_length=1, max_length=180)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name cannot be blank")
        return value

    @field_validator("url")
    @classmethod
    def endpoint_shape(cls, value: str) -> str:
        return normalize_mcp_endpoint(value.strip())

    @field_validator("catalog_id")
    @classmethod
    def clean_catalog_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class McpToolRead(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)
    input_schema: dict[str, object] = Field(default_factory=dict)
    access: Literal["read", "write"] = "write"
    requires_human_approval: bool = False


class McpServerRead(BaseModel):
    id: UUID
    name: str
    url: str
    status: Literal["not_checked", "ready", "error"]
    enabled: bool = False
    catalog_id: str | None = None
    tools: list[McpToolRead]
    approved_tool_names: list[str]
    last_checked_at: datetime | None = None
    last_error: str | None = None


class McpServerUpdateTools(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_names: list[str] = Field(max_length=MAX_MCP_TOOLS_PER_SERVER)

    @field_validator("tool_names")
    @classmethod
    def unique_tool_names(cls, value: list[str]) -> list[str]:
        if any(not name or len(name) > 128 for name in value) or len(set(value)) != len(value):
            raise ValueError("tool_names must be unique non-empty names of at most 128 characters")
        return value


class McpCredentialUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auth_token: str = Field(min_length=1, max_length=4096, repr=False)


class McpServerEnabledUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


class McpCatalogEntry(BaseModel):
    id: str
    name: str
    description: str
    category: str
    source_url: str
    badges: list[str]
    endpoint: str
    requires_token: bool = False


class McpCatalogRefresh(BaseModel):
    added: int
    directory_available: bool
    message: str


class McpCatalogPage(BaseModel):
    items: list[McpCatalogEntry]
    page: int
    page_size: int
    total: int
    categories: list[str]


class McpSuggestion(BaseModel):
    id: str
    name: str
    category: str


class McpSuggestions(BaseModel):
    suggestions: list[McpSuggestion]


class McpSuggestionQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=12_000)


class McpConversationActivation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    catalog_id: str = Field(min_length=1, max_length=180)
    auth_token: str | None = Field(default=None, min_length=1, max_length=4096)


class McpConversationActivationRead(BaseModel):
    server: McpServerRead
    connector_ids: list[str]


class AgentMcpToolGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")

    server_id: str = Field(min_length=1, max_length=80)
    tool_name: str = Field(min_length=1, max_length=128)


class AgentMcpToolsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tools: list[AgentMcpToolGrant] = Field(max_length=200)


class AgentMcpToolsRead(BaseModel):
    tools: list[AgentMcpToolGrant]
