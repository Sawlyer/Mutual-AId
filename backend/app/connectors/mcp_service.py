import json
from uuid import uuid4

from fastapi import HTTPException

from app.config import Settings
from app.connectors.mcp_models import MAX_MCP_SERVERS_PER_USER, McpServerCreate, McpServerRead, McpToolRead
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
            key = self.settings.connector_token_key
            if not key:
                raise HTTPException(status_code=503, detail="Le chiffrement des identifiants de connecteur n’est pas configuré.")
            encrypted_token = TokenVault(key).encrypt_payload({"auth_token": payload.auth_token})
        server_id = str(uuid4())
        self.database.create_mcp_server(server_id, user_id, payload.name, payload.url, encrypted_token)
        server = self.database.get_mcp_server(user_id, server_id)
        assert server is not None
        return self._read(server)

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

    def delete_server(self, user_id: str, server_id: str) -> None:
        if not self.database.delete_mcp_server(user_id, server_id):
            raise HTTPException(status_code=404, detail="Serveur MCP introuvable.")

    @staticmethod
    def _read(row: dict[str, object]) -> McpServerRead:
        tools = json.loads(str(row["discovered_tools_json"]))
        return McpServerRead(
            id=str(row["id"]), name=str(row["name"]), url=str(row["url"]), status=str(row["status"]),
            tools=[McpToolRead.model_validate(tool) for tool in tools],
            approved_tool_names=json.loads(str(row["approved_tools_json"])),
            last_checked_at=row["last_checked_at"], last_error=row["last_error"],
        )
