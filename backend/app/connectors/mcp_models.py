from datetime import datetime
from ipaddress import ip_address
import socket
from urllib.parse import urlsplit
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


MAX_MCP_SERVERS_PER_USER = 20
MAX_MCP_TOOLS_PER_SERVER = 100
MAX_MCP_TOOL_SCHEMA_BYTES = 32_000
MAX_MCP_TOOL_OUTPUT_BYTES = 128_000


def validate_public_endpoint(value: str, *, resolve: bool = True) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("MCP endpoint must use an http or https URL with a hostname")
    if parsed.username or parsed.password or parsed.fragment or parsed.query:
        raise ValueError("MCP endpoint cannot include credentials, query parameters, or a fragment")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal", ".test")):
        raise ValueError("MCP endpoint must use a public host")
    try:
        addresses = {ip_address(host)}
    except ValueError:
        if not resolve:
            return value
        try:
            addresses = {ip_address(result[4][0]) for result in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
        except OSError as error:
            raise ValueError("MCP endpoint hostname could not be resolved") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("MCP endpoint must resolve only to public IP addresses")
    return value


class McpServerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=2048)
    auth_token: str | None = Field(default=None, min_length=1, max_length=4096, repr=False)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name cannot be blank")
        return value

    @field_validator("url")
    @classmethod
    def public_url(cls, value: str) -> str:
        return validate_public_endpoint(value.strip(), resolve=False)


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
