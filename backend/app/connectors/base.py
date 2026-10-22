from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
from typing import Protocol


class ConnectionStatus(str, Enum):
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    ERROR = "error"


class ToolAccess(str, Enum):
    READ = "read"
    WRITE = "write"


class AuthProvider(Protocol):
    async def check_connection(self, user_id: str) -> bool: ...
    async def disconnect(self, user_id: str) -> None: ...


@dataclass(frozen=True)
class ConnectorPermission:
    id: str
    label: str
    description: str
    access: ToolAccess
    oauth_scope: str | None = None


@dataclass(frozen=True)
class ToolDescriptor:
    name: str
    description: str
    access: ToolAccess
    required_scopes: tuple[str, ...] = ()
    requires_human_approval: bool = False


@dataclass(frozen=True)
class Connector:
    id: str
    name: str
    description: str
    icon: str
    capabilities: tuple[str, ...]
    available_tools: tuple[ToolDescriptor, ...]
    required_scopes: tuple[ConnectorPermission, ...]
    availability: str
    auth_provider: AuthProvider

    async def check_connection(self, user_id: str) -> bool:
        return await self.auth_provider.check_connection(user_id)

    async def disconnect(self, user_id: str) -> None:
        await self.auth_provider.disconnect(user_id)


class UnavailableAuthProvider:
    """Explicitly reports that no real authentication flow is installed."""

    async def check_connection(self, _user_id: str) -> bool:
        return False

    async def disconnect(self, _user_id: str) -> None:
        return None


@dataclass(frozen=True)
class RegisteredTool:
    connector_id: str
    descriptor: ToolDescriptor
    sdk_tool: object


ToolFactory = Callable[..., Awaitable[object]]
