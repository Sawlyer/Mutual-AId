import json
from uuid import uuid4
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.config import Settings
from app.connectors.mcp_models import (
    MAX_MCP_SERVERS_PER_USER,
    AgentMcpToolGrant,
    McpServerCreate,
    McpServerRead,
    McpToolRead,
)
from app.connectors.oauth import TokenVault
from app.db import Database


class McpService:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.settings = settings

    def list_servers(self, user_id: str) -> list[McpServerRead]:
        return [self._read(row) for row in self.database.list_mcp_servers(user_id)]

    def create_server(self, user_id: str, payload: McpServerCreate) -> McpServerRead:
        if len(self.database.list_mcp_servers(user_id)) >= MAX_MCP_SERVERS_PER_USER:
            raise HTTPException(status_code=409, detail="La limite de serveurs MCP est atteinte.")
        encrypted_token = None
        if payload.auth_token:
            _require_https_for_credentials(payload.url)
            key = self.settings.connector_token_key
            if not key:
                raise HTTPException(status_code=503, detail="Le chiffrement des identifiants de connecteur n’est pas configuré.")
            encrypted_token = TokenVault(key).encrypt_payload({"auth_token": payload.auth_token})
        server_id = str(uuid4())
        self.database.create_mcp_server(server_id, user_id, payload.name, payload.url, encrypted_token, payload.catalog_id)
        server = self.database.get_mcp_server(user_id, server_id)
        assert server is not None
        return self._read(server)

    def store_auth_token(self, user_id: str, server_id: str, auth_token: str) -> None:
        server = self.get_server(user_id, server_id)
        _require_https_for_credentials(str(server["url"]))
        key = self.settings.connector_token_key
        if not key:
            raise HTTPException(status_code=503, detail="Le chiffrement des identifiants de connecteur n’est pas configuré.")
        encrypted = TokenVault(key).encrypt_payload({"auth_token": auth_token})
        if not self.database.set_mcp_server_auth_token(user_id, server_id, encrypted):
            raise HTTPException(status_code=404, detail="Serveur MCP introuvable.")

    def get_server(self, user_id: str, server_id: str) -> dict[str, object]:
        server = self.database.get_mcp_server(user_id, server_id)
        if server is None:
            raise HTTPException(status_code=404, detail="Serveur MCP introuvable.")
        return server

    def set_allowed_tools(self, user_id: str, server_id: str, names: list[str]) -> McpServerRead:
        server = self.get_server(user_id, server_id)
        tools = json.loads(str(server["discovered_tools_json"]))
        allowed = {item.get("name") for item in tools if isinstance(item, dict) and item.get("access") == "read"}
        if len(set(names)) != len(names) or any(name not in allowed for name in names):
            raise HTTPException(status_code=422, detail="La sélection doit contenir uniquement des outils découverts, sans doublon.")
        self.database.set_mcp_server_approved_tools(user_id, server_id, names)
        updated = self.database.get_mcp_server(user_id, server_id)
        assert updated is not None
        return self._read(updated)

    def set_enabled(self, user_id: str, server_id: str, enabled: bool) -> McpServerRead:
        server = self.get_server(user_id, server_id)
        if enabled:
            tools = json.loads(str(server["discovered_tools_json"]))
            approved = set(json.loads(str(server["approved_tools_json"])))
            readable = {item.get("name") for item in tools if isinstance(item, dict) and item.get("access") == "read"}
            if server["status"] != "ready" or not approved or not approved.issubset(readable):
                raise HTTPException(status_code=409, detail="Approuvez au moins un outil de lecture avant d’activer ce serveur.")
        if not self.database.set_mcp_server_enabled(user_id, server_id, enabled):
            raise HTTPException(status_code=404, detail="Serveur MCP introuvable.")
        updated = self.database.get_mcp_server(user_id, server_id)
        assert updated is not None
        return self._read(updated)

    def replace_agent_tools(self, user_id: str, profile_id: str, tools: list[AgentMcpToolGrant]) -> list[AgentMcpToolGrant]:
        if self.database.get_agent_profile(user_id, profile_id) is None:
            raise HTTPException(status_code=404, detail="Profil d’agent introuvable.")
        cleaned: list[tuple[str, str]] = []
        for grant in tools:
            server = self.database.get_mcp_server(user_id, grant.server_id)
            if server is None:
                raise HTTPException(status_code=422, detail="Un serveur MCP indiqué n’appartient pas à ce compte.")
            discovered = json.loads(str(server["discovered_tools_json"]))
            approved = set(json.loads(str(server["approved_tools_json"])))
            readable = {item.get("name") for item in discovered if isinstance(item, dict) and item.get("access") == "read"}
            if grant.tool_name not in approved or grant.tool_name not in readable:
                raise HTTPException(status_code=422, detail="Seuls les outils de lecture approuvés peuvent être affectés à un agent.")
            cleaned.append((grant.server_id, grant.tool_name))
        self.database.replace_agent_mcp_tools(user_id, profile_id, cleaned)
        return [AgentMcpToolGrant(server_id=server_id, tool_name=tool_name) for server_id, tool_name in sorted(set(cleaned))]

    def delete_server(self, user_id: str, server_id: str) -> None:
        if not self.database.delete_mcp_server(user_id, server_id):
            raise HTTPException(status_code=404, detail="Serveur MCP introuvable.")

    @staticmethod
    def _read(row: dict[str, object]) -> McpServerRead:
        tools = json.loads(str(row["discovered_tools_json"]))
        return McpServerRead(
            id=str(row["id"]), name=str(row["name"]), url=str(row["url"]), status=str(row["status"]),
            enabled=bool(row["enabled"]), catalog_id=row["catalog_id"] if row["catalog_id"] else None,
            tools=[McpToolRead.model_validate(tool) for tool in tools],
            approved_tool_names=json.loads(str(row["approved_tools_json"])),
            last_checked_at=row["last_checked_at"], last_error=row["last_error"],
        )


def _require_https_for_credentials(url: str) -> None:
    if urlsplit(url).scheme.lower() != "https":
        raise HTTPException(status_code=422, detail="Un jeton MCP exige une adresse HTTPS pour rester chiffré en transit.")
