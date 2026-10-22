from collections.abc import Iterable

from app.connectors.base import RegisteredTool, ToolAccess, ToolDescriptor
from app.connectors.registry import ConnectorRegistry
from app.db import Database


class ConnectorAuthorizationError(Exception):
    """A requested connector or tool is not authorized for this user."""


class ToolRegistry:
    """Stores SDK tools and resolves only tools authorized for a user."""

    def __init__(self, connectors: ConnectorRegistry) -> None:
        self.connectors = connectors
        self._tools: dict[tuple[str, str], RegisteredTool] = {}

    def register(
        self,
        connector_id: str,
        name: str,
        sdk_tool: object,
        *,
        access: ToolAccess | str,
        required_scopes: Iterable[str] = (),
        requires_human_approval: bool = False,
        description: str = "",
    ) -> None:
        if self.connectors.get(connector_id) is None:
            raise ValueError(f"Unknown connector: {connector_id}")
        descriptor = ToolDescriptor(
            name=name,
            description=description,
            access=ToolAccess(access),
            required_scopes=tuple(required_scopes),
            requires_human_approval=requires_human_approval,
        )
        self._tools[(connector_id, name)] = RegisteredTool(connector_id, descriptor, sdk_tool)

    def descriptors_for_user(
        self,
        user_id: str,
        connector_id: str,
        database: Database,
    ) -> list[ToolDescriptor]:
        connector = self.connectors.get(connector_id)
        if connector is None or connector.availability != "available":
            return []
        connection = database.get_connector_connection(user_id, connector_id)
        if connection is None or connection["status"] != "connected":
            return []
        granted_scopes = set(connection["granted_scopes"])
        return [
            tool.descriptor
            for tool in self._tools.values()
            if tool.connector_id == connector_id
            and set(tool.descriptor.required_scopes).issubset(granted_scopes)
            and not (tool.descriptor.access == ToolAccess.WRITE and not tool.descriptor.required_scopes)
        ]

    def tools_for_user(
        self,
        user_id: str,
        connector_ids: Iterable[str],
        database: Database,
        approved_tool_names: Iterable[str] = (),
    ) -> list[object]:
        selected = tuple(connector_ids)
        approved = set(approved_tool_names)
        if len(set(selected)) != len(selected):
            raise ConnectorAuthorizationError("Duplicate connector selection")

        eligible: list[object] = []
        for connector_id in selected:
            connector = self.connectors.get(connector_id)
            if connector is None or connector.availability != "available":
                raise ConnectorAuthorizationError("Connector is unavailable")
            connection = database.get_connector_connection(user_id, connector_id)
            if connection is None or connection["status"] != "connected":
                raise ConnectorAuthorizationError("Connector is not connected")
            granted_scopes = set(connection["granted_scopes"])
            for tool in self._tools.values():
                if tool.connector_id != connector_id:
                    continue
                if not set(tool.descriptor.required_scopes).issubset(granted_scopes):
                    continue
                # Write tools are surfaced only when the exact write scope was granted.
                if tool.descriptor.access == ToolAccess.WRITE and not tool.descriptor.required_scopes:
                    continue
                if tool.descriptor.requires_human_approval and tool.descriptor.name not in approved:
                    continue
                eligible.append(tool.sdk_tool)
        return eligible
