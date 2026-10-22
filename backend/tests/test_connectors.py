from app.connectors.registry import ConnectorRegistry
from app.connectors.tools import ConnectorAuthorizationError, ToolRegistry
from app.main import create_app
from app.config import Settings
from app.db import Database
from fastapi.testclient import TestClient
from cryptography.fernet import Fernet
from pydantic import ValidationError
import pytest

from app.connectors.mcp_models import McpServerCreate
from app.connectors.oauth import TokenVault


def make_client(tmp_path):
    app = create_app(Settings(database_path=tmp_path / "connectors.sqlite3", openai_api_key="", openai_model=""))
    client = TestClient(app)
    app.state.database.initialize()
    response = client.post("/api/auth/register", json={
        "name": "Test user", "email": "test@example.com", "password": "a sufficiently long test password",
    })
    assert response.status_code == 201
    return client


def test_catalog_lists_only_disconnected_connectors_without_tools(tmp_path):
    with make_client(tmp_path) as client:
        response = client.get("/api/connectors")

    assert response.status_code == 200
    connectors = {connector["id"]: connector for connector in response.json()}
    assert set(connectors) == {
        "gmail", "google_drive", "google_calendar", "github", "custom_mcp"
    }
    assert all(connector["status"] == "disconnected" for connector in connectors.values())
    assert connectors["google_calendar"]["availability"] == "setup_required"
    assert all(connectors[connector_id]["availability"] == "setup_required" for connector_id in ("gmail", "google_drive", "google_calendar"))
    assert connectors["github"]["availability"] == "setup_required"
    assert connectors["custom_mcp"]["availability"] == "coming_soon"
    assert all(connector["available_tools"] == [] for connector in connectors.values())


def test_mcp_server_create_rejects_local_and_credential_embedded_urls():
    with pytest.raises(ValidationError):
        McpServerCreate(name="Local", url="http://127.0.0.1:8080/mcp")
    with pytest.raises(ValidationError):
        McpServerCreate(name="Secret URL", url="https://user:pass@example.org/mcp")


def test_mcp_servers_are_user_scoped_and_credentials_are_encrypted(tmp_path):
    db_path = tmp_path / "mcp.sqlite3"
    key = Fernet.generate_key().decode()
    settings = Settings(database_path=db_path, openai_api_key="", openai_model="", connector_token_encryption_key=key)
    with TestClient(create_app(settings)) as owner:
        owner.post("/api/auth/register", json={"name": "Owner", "email": "owner@example.com", "password": "owner test password long"})
        created = owner.post("/api/connectors/mcp", json={
            "name": "Research MCP", "url": "https://example.com/mcp", "auth_token": "sensitive-token-value",
        })
        server = created.json()
        rows = owner.app.state.database.list_mcp_servers(owner.app.state.database.get_user_by_email("owner@example.com")["id"])
        listing = owner.get("/api/connectors/mcp").json()

    assert created.status_code == 201
    assert "auth_token" not in server and "encrypted_auth_token" not in server
    assert rows[0]["encrypted_auth_token"] != "sensitive-token-value"
    assert TokenVault(key).decrypt_payload(rows[0]["encrypted_auth_token"]) == {"auth_token": "sensitive-token-value"}
    assert listing[0]["id"] == server["id"]
    assert "sensitive-token-value" not in created.text

    with TestClient(create_app(settings)) as other:
        other.post("/api/auth/register", json={"name": "Other", "email": "other@example.com", "password": "other test password long"})
        assert other.get("/api/connectors/mcp").json() == []
        assert other.delete(f"/api/connectors/mcp/{server['id']}").status_code == 404


def test_mcp_tool_approval_only_accepts_discovered_tools(tmp_path):
    key = Fernet.generate_key().decode()
    settings = Settings(database_path=tmp_path / "mcp-tools.sqlite3", openai_api_key="", openai_model="", connector_token_encryption_key=key)
    with TestClient(create_app(settings)) as client:
        client.post("/api/auth/register", json={"name": "Tools", "email": "tools@example.com", "password": "tools test password long"})
        server = client.post("/api/connectors/mcp", json={"name": "Docs", "url": "https://example.com/mcp"}).json()
        user_id = client.app.state.database.get_user_by_email("tools@example.com")["id"]
        client.app.state.database.update_mcp_server_tools(user_id, server["id"], [{"name": "search_docs", "description": "Search documentation", "access": "read"}])
        selected = client.put(f"/api/connectors/mcp/{server['id']}/tools", json={"tool_names": ["search_docs"]})
        rejected = client.put(f"/api/connectors/mcp/{server['id']}/tools", json={"tool_names": ["delete_all"]})

    assert selected.status_code == 200
    assert selected.json()["approved_tool_names"] == ["search_docs"]
    assert rejected.status_code == 422


def test_mcp_connectors_are_user_scoped_in_catalog_and_conversation_preferences(tmp_path):
    db_path = tmp_path / "mcp-preferences.sqlite3"
    settings = Settings(database_path=db_path, openai_api_key="", openai_model="")
    with TestClient(create_app(settings)) as owner:
        owner.post("/api/auth/register", json={"name": "Owner", "email": "mcp-owner@example.com", "password": "owner password long enough"})
        created = owner.post("/api/connectors/mcp", json={"name": "Docs MCP", "url": "https://8.8.8.8/mcp"}).json()
        user_id = owner.app.state.database.get_user_by_email("mcp-owner@example.com")["id"]
        owner.app.state.database.update_mcp_server_tools(user_id, created["id"], [
            {"name": "search_docs", "description": "Search docs", "access": "read"},
        ])
        owner.app.state.database.set_mcp_server_approved_tools(user_id, created["id"], ["search_docs"])
        conversation = owner.post("/api/conversations", json={}).json()
        selected = owner.put(f"/api/conversations/{conversation['id']}/connectors", json={"connector_ids": [f"mcp:{created['id']}"]})
        catalog = owner.get("/api/connectors").json()
        prefs = owner.get(f"/api/conversations/{conversation['id']}/connectors").json()
        owner.delete(f"/api/connectors/mcp/{created['id']}")
        cleaned = owner.get(f"/api/conversations/{conversation['id']}/connectors").json()

    assert selected.status_code == 200
    assert selected.json()["connectors"][0]["available_tools"][0]["name"] == "search_docs"
    assert any(item["id"] == f"mcp:{created['id']}" for item in catalog)
    assert prefs["connector_ids"] == [f"mcp:{created['id']}"]
    assert cleaned["connectors"] == []

    with TestClient(create_app(settings)) as other:
        other.post("/api/auth/register", json={"name": "Other", "email": "mcp-other@example.com", "password": "other password long enough"})
        conversation = other.post("/api/conversations", json={}).json()
        assert other.put(f"/api/conversations/{conversation['id']}/connectors", json={"connector_ids": [f"mcp:{created['id']}"]}).status_code == 409


def test_connector_preferences_are_scoped_to_conversation_and_survive_reads(tmp_path):
    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.put(
            f"/api/conversations/{conversation['id']}/connectors",
            json={"connector_ids": []},
        )
        persisted = client.get(f"/api/conversations/{conversation['id']}/connectors")

    assert response.status_code == 200
    assert persisted.json()["connector_ids"] == []


def test_disconnected_connector_cannot_be_enabled_for_a_conversation(tmp_path):
    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.put(
            f"/api/conversations/{conversation['id']}/connectors",
            json={"connector_ids": ["gmail"]},
        )

    assert response.status_code == 409
    assert client.get(f"/api/conversations/{conversation['id']}/connectors").json()["connector_ids"] == []


def test_tool_registry_refuses_disconnected_and_unselected_connectors(tmp_path):
    registry = ConnectorRegistry()
    tools = ToolRegistry(registry)
    tools.register("gmail", "gmail_read", object(), access="read", required_scopes=("gmail.read",))

    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        database = client.app.state.database
        database.initialize()
        try:
            tools.tools_for_user(client.app.state.database.get_user_by_email("test@example.com")["id"], ("gmail",), database)
        except ConnectorAuthorizationError:
            pass
        else:
            raise AssertionError("Disconnected connector must not provide an agent tool")

        assert tools.tools_for_user(client.app.state.database.get_user_by_email("test@example.com")["id"], (), database) == []


def test_connector_selections_are_checked_again_when_streaming(tmp_path):
    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Lis mes derniers e-mails", "connector_ids": ["gmail"]},
        )

    assert response.status_code == 409
    assert "messages" not in response.text


def test_registered_tools_require_connection_scopes_and_human_approval(tmp_path):
    registry = ConnectorRegistry(available_connector_ids={"gmail"})
    tools = ToolRegistry(registry)
    read_tool = object()
    write_tool = object()
    tools.register("gmail", "gmail_read", read_tool, access="read", required_scopes=("gmail.read",))
    tools.register("gmail", "gmail_send", write_tool, access="write", required_scopes=("gmail.write",), requires_human_approval=True)
    database = Database(tmp_path / "tools.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "gmail", "connected", ["gmail.read", "gmail.write"])

    assert tools.tools_for_user("user-a", ("gmail",), database) == [read_tool]
    assert tools.tools_for_user("user-a", ("gmail",), database, approved_tool_names=("gmail_send",)) == [read_tool, write_tool]
    assert tools.tools_for_user("user-b", (), database) == []
    try:
        tools.tools_for_user("user-b", ("gmail",), database)
    except ConnectorAuthorizationError:
        pass
    else:
        raise AssertionError("Credentials must be isolated between users")


def test_conversation_access_is_scoped_to_backend_principal(tmp_path):
    database_path = tmp_path / "shared.sqlite3"
    with TestClient(create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as account_a:
        account_a.post("/api/auth/register", json={"name":"A", "email":"a@example.com", "password":"account a test password"})
        conversation = account_a.post("/api/conversations", json={}).json()
    with TestClient(create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as account_b:
        account_b.post("/api/auth/register", json={"name":"B", "email":"b@example.com", "password":"account b test password"})
        response = account_b.get(f"/api/conversations/{conversation['id']}")
        conversations = account_b.get("/api/conversations").json()

    assert response.status_code == 404
    assert conversations == []
import sqlite3



def test_database_migration_preserves_existing_conversations(tmp_path):
    database_path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(database_path)
    connection.executescript(
        """
        CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO conversations VALUES ('legacy-conversation', 'Historique conservé', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00');
        """
    )
    connection.close()
    database = Database(database_path)
    database.initialize()

    conversation = database.get_conversation("legacy-conversation")

    assert conversation is not None
    assert conversation.title == "Historique conservé"


def test_token_vault_round_trips_and_rejects_invalid_ciphertext():
    from cryptography.fernet import Fernet, InvalidToken
    from app.connectors.oauth import TokenVault
    vault = TokenVault(Fernet.generate_key().decode())
    encrypted = vault.encrypt("refresh-secret")
    assert "refresh-secret" not in encrypted
    assert vault.decrypt(encrypted) == "refresh-secret"
    try:
        vault.decrypt("not-a-fernet-token")
    except (InvalidToken, ValueError):
        pass
    else:
        raise AssertionError("Invalid encrypted credentials must be rejected")


def test_oauth_state_is_single_use_and_bound_to_user(tmp_path):
    from app.connectors.oauth import OAuthStateStore
    database = Database(tmp_path / "oauth-state.sqlite3")
    database.initialize()
    store = OAuthStateStore(database)
    state = store.create("owner", ["https://www.googleapis.com/auth/calendar.readonly"], "/connectors")
    assert store.consume("other", state.value) is None
    assert store.consume("owner", state.value) is not None
    assert store.consume("owner", state.value) is None


def test_oauth_state_is_bound_to_connector(tmp_path):
    from app.connectors.oauth import OAuthStateStore
    database = Database(tmp_path / "oauth-connector-state.sqlite3")
    database.initialize()
    store = OAuthStateStore(database)
    state = store.create(
        "owner", ["https://www.googleapis.com/auth/gmail.readonly"], "/connectors",
        connector_id="gmail",
    )
    assert store.consume("owner", state.value, connector_id="google_drive") is None
    consumed = store.consume("owner", state.value, connector_id="gmail")
    assert consumed is not None
    assert consumed["connector_id"] == "gmail"


def test_google_oauth_uses_connector_scopes_and_stores_credentials_per_connector(tmp_path):
    import asyncio
    from urllib.parse import parse_qs, urlparse
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.google_oauth import (
        CALENDAR_READ_SCOPE, DRIVE_METADATA_READ_SCOPE, GMAIL_READ_SCOPE, GoogleOAuthClient,
    )
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "google-connectors.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "google-connectors.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    scope_by_code = {"gmail-code": GMAIL_READ_SCOPE, "drive-code": DRIVE_METADATA_READ_SCOPE, "calendar-code": CALENDAR_READ_SCOPE}
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "access_token": "access-secret", "refresh_token": f"refresh-{request.content.decode().split('code=')[1].split('&')[0]}",
        "expires_in": 3600, "scope": scope_by_code[request.content.decode().split("code=")[1].split("&")[0]],
    }))
    expected = {
        "gmail": (GMAIL_READ_SCOPE, "gmail-code"),
        "google_drive": (DRIVE_METADATA_READ_SCOPE, "drive-code"),
        "google_calendar": (CALENDAR_READ_SCOPE, "calendar-code"),
    }

    async def exchange_all():
        async with httpx.AsyncClient(transport=transport) as client:
            oauth = GoogleOAuthClient(settings, database, TokenVault(settings.connector_token_key), OAuthStateStore(database), client)
            for connector_id, (scope, code) in expected.items():
                url = oauth.authorization_url("user-a", [scope], connector_id=connector_id)
                query = parse_qs(urlparse(url).query)
                assert query["scope"] == [scope]
                state = query["state"][0]
                await oauth.exchange_code("user-a", code, state, connector_id=connector_id)

    asyncio.run(exchange_all())
    for connector_id in expected:
        encrypted = database.get_connector_credentials("user-a", connector_id)
        assert encrypted is not None
        assert "access-secret" not in encrypted
        assert database.get_connector_connection("user-a", connector_id)["status"] == "connected"


def test_google_disconnect_revokes_provider_grant_only_after_last_google_connector(tmp_path):
    import asyncio
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.google_oauth import GoogleOAuthClient
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "google-disconnect.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "google-disconnect.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    vault = TokenVault(settings.connector_token_key)
    for connector_id, scope in (("gmail", "gmail.read"), ("google_calendar", "calendar.read")):
        database.set_connector_connection("user-a", connector_id, "connected", [scope])
        database.store_connector_credentials("user-a", connector_id, vault.encrypt_payload({"access_token": "token", "refresh_token": "refresh"}))
    revoke_calls = []

    async def revoke():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: (revoke_calls.append(request), httpx.Response(200))[1])) as client:
            oauth = GoogleOAuthClient(settings, database, vault, OAuthStateStore(database), client)
            await oauth.revoke("user-a", "gmail")
            assert revoke_calls == []
            await oauth.revoke("user-a", "google_calendar")

    asyncio.run(revoke())
    assert len(revoke_calls) == 1
    assert database.get_connector_connection("user-a", "gmail")["status"] == "disconnected"
    assert database.get_connector_credentials("user-a", "google_calendar") is None


def test_gmail_search_returns_limited_message_metadata_for_connected_user(tmp_path):
    import asyncio
    import httpx
    from app.connectors.google_gmail import fetch_gmail_messages
    from app.connectors.google_oauth import GMAIL_READ_SCOPE
    database = Database(tmp_path / "gmail-read.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "gmail", "connected", [GMAIL_READ_SCOPE])

    class FakeOAuth:
        async def access_token(self, user_id, connector_id):
            assert (user_id, connector_id) == ("user-a", "gmail")
            return "gmail-token"

    def respond(request):
        if request.url.path.endswith("/messages"):
            return httpx.Response(200, json={"messages": [{"id": "m-1", "threadId": "t-1"}]})
        return httpx.Response(200, json={
            "id": "m-1", "threadId": "t-1", "snippet": "Résumé du message", "payload": {"headers": [
                {"name": "From", "value": "contact@example.test"}, {"name": "Subject", "value": "Bonjour"},
            ]}, "internalDate": "1792670400000", "body": "must not leak",
        })

    async def search():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await fetch_gmail_messages("user-a", database, FakeOAuth(), "from:contact@example.test", client)

    result = asyncio.run(search())
    assert result["messages"] == [{
        "id": "m-1", "thread_id": "t-1", "from": "contact@example.test", "subject": "Bonjour",
        "snippet": "Résumé du message", "date": "1792670400000",
    }]
    assert "must not leak" not in str(result)


def test_drive_search_refuses_metadata_access_without_matching_scope(tmp_path):
    import asyncio
    import httpx
    from app.connectors.google_drive import fetch_drive_files
    database = Database(tmp_path / "drive-read.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "google_drive", "connected", [])

    class FakeOAuth:
        async def access_token(self, *_args):
            raise AssertionError("Missing Drive scope must be rejected before token access")

    async def search():
        async with httpx.AsyncClient() as client:
            return await fetch_drive_files("user-a", database, FakeOAuth(), "report", client)

    try:
        asyncio.run(search())
    except PermissionError:
        pass
    else:
        raise AssertionError("Drive metadata must require the granted read-only scope")


def test_drive_search_returns_only_metadata(tmp_path):
    import asyncio
    import httpx
    from app.connectors.google_drive import fetch_drive_files
    from app.connectors.google_oauth import DRIVE_METADATA_READ_SCOPE
    database = Database(tmp_path / "drive-metadata.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "google_drive", "connected", [DRIVE_METADATA_READ_SCOPE])

    class FakeOAuth:
        async def access_token(self, user_id, connector_id):
            assert (user_id, connector_id) == ("user-a", "google_drive")
            return "drive-token"

    def respond(request):
        assert request.headers["Authorization"] == "Bearer drive-token"
        assert "name contains 'report'" in request.url.params["q"]
        return httpx.Response(200, json={"files": [{
            "id": "f-1", "name": "report.csv", "mimeType": "text/csv", "modifiedTime": "2026-10-20T09:00:00Z",
            "webViewLink": "https://drive.google.com/file/d/f-1", "content": "must not be returned",
        }]})

    async def search():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await fetch_drive_files("user-a", database, FakeOAuth(), "report", client)

    result = asyncio.run(search())
    assert result["files"][0]["name"] == "report.csv"
    assert "content" not in str(result)


def test_github_issues_are_read_only_and_user_scoped(tmp_path):
    import asyncio
    import httpx
    from app.connectors.github_api import GitHubApiError, fetch_github_issues
    from app.connectors.github_oauth import GITHUB_READ_PERMISSIONS
    database = Database(tmp_path / "github-api.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "github", "connected", list(GITHUB_READ_PERMISSIONS))

    class FakeOAuth:
        async def access_token(self, user_id):
            assert user_id == "user-a"
            return "github-token"

    def respond(request):
        assert request.method == "GET"
        assert request.url.path == "/repos/acme/platform/issues"
        assert request.headers["Authorization"] == "Bearer github-token"
        return httpx.Response(200, json=[
            {"number": 3, "title": "Bug", "state": "open", "body": "Details", "html_url": "https://github.com/acme/platform/issues/3"},
            {"number": 2, "title": "Pull request", "pull_request": {"url": "ignored"}},
        ])

    async def read():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await fetch_github_issues("user-a", database, FakeOAuth(), "acme", "platform", client)

    result = asyncio.run(read())
    assert len(result["issues"]) == 1
    assert result["issues"][0]["title"] == "Bug"
    try:
        asyncio.run(fetch_github_issues("user-b", database, FakeOAuth(), "acme", "platform"))
    except GitHubApiError as error:
        assert "permission" in str(error).lower()
    else:
        raise AssertionError("A different account must not read the connected user's GitHub issues")


def test_github_app_oauth_uses_one_time_state_and_stores_token_encrypted(tmp_path):
    import asyncio
    from urllib.parse import parse_qs, urlparse
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.github_oauth import GITHUB_READ_PERMISSIONS, GitHubAppOAuthClient
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "github-oauth.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "github-oauth.sqlite3", openai_api_key="", openai_model="",
        github_app_client_id="github-client", github_app_client_secret="github-secret",
        github_app_redirect_uri="http://localhost:8000/api/connectors/github/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "access_token": "github-access-secret", "expires_in": 28800,
        "refresh_token": "github-refresh-secret", "refresh_token_expires_in": 15897600,
    }))

    async def exchange():
        async with httpx.AsyncClient(transport=transport) as client:
            oauth = GitHubAppOAuthClient(settings, database, TokenVault(settings.connector_token_key), OAuthStateStore(database), client)
            url = oauth.authorization_url("user-a")
            state = parse_qs(urlparse(url).query)["state"][0]
            return await oauth.exchange_code("user-a", "github-code", state)

    result = asyncio.run(exchange())
    encrypted = database.get_connector_credentials("user-a", "github")
    assert result["status"] == "connected"
    assert encrypted is not None
    assert "github-access-secret" not in encrypted and "github-refresh-secret" not in encrypted
    assert database.get_connector_connection("user-a", "github")["granted_scopes"] == list(GITHUB_READ_PERMISSIONS)


def test_github_connect_endpoint_requires_session_and_returns_authorization_url(tmp_path):
    from cryptography.fernet import Fernet
    settings = Settings(
        database_path=tmp_path / "github-connect.sqlite3", openai_api_key="", openai_model="",
        github_app_client_id="github-client", github_app_client_secret="github-secret",
        github_app_redirect_uri="http://localhost:8000/api/connectors/github/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/connectors/github/connect").status_code == 401
        client.post("/api/auth/register", json={
            "name": "GitHub user", "email": "github@example.com", "password": "github integration test password",
        })
        connectors = {item["id"]: item for item in client.get("/api/connectors").json()}
        response = client.post("/api/connectors/github/connect")
    assert response.status_code == 200
    assert connectors["github"]["availability"] == "available"
    assert response.json()["authorization_url"].startswith("https://github.com/login/oauth/authorize?")


def test_github_app_rotates_expired_user_access_tokens(tmp_path):
    import asyncio
    from urllib.parse import parse_qs, urlparse
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.github_oauth import GitHubAppOAuthClient
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "github-refresh.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "github-refresh.sqlite3", openai_api_key="", openai_model="",
        github_app_client_id="github-client", github_app_client_secret="github-secret",
        github_app_redirect_uri="http://localhost:8000/api/connectors/github/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )

    def respond(request):
        if request.url.path.endswith("/login/oauth/access_token") and request.content.decode().find("grant_type=refresh_token") >= 0:
            return httpx.Response(200, json={"access_token": "rotated-access", "refresh_token": "rotated-refresh", "expires_in": 28800, "refresh_token_expires_in": 15897600})
        return httpx.Response(200, json={"access_token": "expired-access", "refresh_token": "initial-refresh", "expires_in": 1, "refresh_token_expires_in": 3600})

    async def rotate():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            oauth = GitHubAppOAuthClient(settings, database, TokenVault(settings.connector_token_key), OAuthStateStore(database), client)
            state = parse_qs(urlparse(oauth.authorization_url("user-a")).query)["state"][0]
            await oauth.exchange_code("user-a", "code", state)
            return await oauth.access_token("user-a")

    assert asyncio.run(rotate()) == "rotated-access"


def test_calendar_oauth_requires_client_and_encryption_configuration(tmp_path):
    settings = Settings(database_path=tmp_path / "calendar.sqlite3", openai_api_key="", openai_model="")
    assert settings.google_calendar_configured is False


def test_google_oauth_code_exchange_stores_only_encrypted_tokens(tmp_path):
    import asyncio
    from urllib.parse import parse_qs, urlparse
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.google_oauth import CALENDAR_READ_SCOPE, GoogleOAuthClient
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "google-oauth.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "google-oauth.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google_calendar/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    vault = TokenVault(settings.connector_token_key)
    store = OAuthStateStore(database)
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={
        "access_token": "access-secret", "refresh_token": "refresh-secret", "expires_in": 3600,
        "scope": CALENDAR_READ_SCOPE,
    }))

    async def exchange():
        async with httpx.AsyncClient(transport=transport) as client:
            oauth = GoogleOAuthClient(settings, database, vault, store, client)
            authorization_url = oauth.authorization_url("user-a", [CALENDAR_READ_SCOPE])
            state = parse_qs(urlparse(authorization_url).query)["state"][0]
            return await oauth.exchange_code("user-a", "auth-code", state)

    result = asyncio.run(exchange())
    encrypted = database.get_connector_credentials("user-a", "google_calendar")
    assert result["status"] == "connected"
    assert encrypted is not None
    assert "access-secret" not in encrypted and "refresh-secret" not in encrypted
    assert vault.decrypt_payload(encrypted)["refresh_token"] == "refresh-secret"
    assert database.get_connector_connection("user-a", "google_calendar")["status"] == "connected"


def test_google_oauth_callback_rejects_invalid_state(tmp_path):
    import asyncio
    from cryptography.fernet import Fernet
    from app.connectors.google_oauth import CALENDAR_READ_SCOPE, GoogleOAuthClient, InvalidOAuthState
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "google-oauth.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "google-oauth.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google_calendar/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    oauth = GoogleOAuthClient(settings, database, TokenVault(settings.connector_token_key), OAuthStateStore(database))
    try:
        asyncio.run(oauth.exchange_code("user-a", "auth-code", "invalid-state"))
    except InvalidOAuthState:
        pass
    else:
        raise AssertionError("Invalid OAuth state must be rejected")
    assert database.get_connector_credentials("user-a", "google_calendar") is None


def test_google_oauth_does_not_mark_connection_without_refresh_credential(tmp_path):
    import asyncio
    from urllib.parse import parse_qs, urlparse
    import httpx
    from cryptography.fernet import Fernet
    from app.connectors.google_oauth import CALENDAR_READ_SCOPE, GoogleOAuthClient, GoogleOAuthError
    from app.connectors.oauth import OAuthStateStore, TokenVault
    database = Database(tmp_path / "google-oauth-refresh.sqlite3")
    database.initialize()
    settings = Settings(
        database_path=tmp_path / "google-oauth-refresh.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google_calendar/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    transport = httpx.MockTransport(lambda _request: httpx.Response(200, json={
        "access_token": "short-lived-only", "expires_in": 3600, "scope": CALENDAR_READ_SCOPE,
    }))

    async def exchange():
        async with httpx.AsyncClient(transport=transport) as client:
            oauth = GoogleOAuthClient(settings, database, TokenVault(settings.connector_token_key), OAuthStateStore(database), client)
            url = oauth.authorization_url("user-a", [CALENDAR_READ_SCOPE])
            state = parse_qs(urlparse(url).query)["state"][0]
            assert parse_qs(urlparse(url).query)["prompt"] == ["consent"]
            return await oauth.exchange_code("user-a", "auth-code", state)

    try:
        asyncio.run(exchange())
    except GoogleOAuthError:
        pass
    else:
        raise AssertionError("A short-lived credential must not be represented as a durable connection")
    assert database.get_connector_connection("user-a", "google_calendar") is None
    assert database.get_connector_credentials("user-a", "google_calendar") is None


def test_calendar_read_returns_minimized_fields_and_checks_user_connection(tmp_path):
    import asyncio
    import httpx
    from app.connectors.google_calendar import GoogleCalendarError, fetch_calendar_events
    from app.connectors.google_oauth import CALENDAR_READ_SCOPE
    database = Database(tmp_path / "calendar-read.sqlite3")
    database.initialize()
    database.set_connector_connection("user-a", "google_calendar", "connected", [CALENDAR_READ_SCOPE])

    class FakeOAuth:
        async def access_token(self, user_id):
            assert user_id == "user-a"
            return "secret-access-token"

    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={
        "items": [{"id": "event-1", "summary": "Marche", "start": {"dateTime": "2026-10-22T09:00:00Z"}, "end": {"dateTime": "2026-10-22T10:00:00Z"}, "description": "private details", "attendees": [{"email": "private@example.test"}]}]
    }))

    async def read():
        async with httpx.AsyncClient(transport=transport) as client:
            return await fetch_calendar_events("user-a", database, FakeOAuth(), "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z", client)

    result = asyncio.run(read())
    assert result["items"][0] == {
        "id": "event-1", "summary": "Marche", "start": {"dateTime": "2026-10-22T09:00:00Z"},
        "end": {"dateTime": "2026-10-22T10:00:00Z"}, "status": "confirmed",
    }
    assert "description" not in str(result) and "attendees" not in str(result)
    try:
        asyncio.run(fetch_calendar_events("user-b", database, FakeOAuth(), "2026-10-22T00:00:00Z", "2026-10-23T00:00:00Z"))
    except GoogleCalendarError:
        pass
    else:
        raise AssertionError("Calendar data must not be accessible to a different user")


def test_calendar_oauth_is_exposed_only_when_server_configuration_is_complete(tmp_path):
    from cryptography.fernet import Fernet
    settings = Settings(
        database_path=tmp_path / "calendar-api.sqlite3", openai_api_key="", openai_model="",
        google_oauth_client_id="client-id", google_oauth_client_secret="client-secret",
        google_oauth_redirect_uri="http://localhost:8000/api/connectors/google_calendar/callback",
        connector_token_encryption_key=Fernet.generate_key().decode(),
    )
    app = create_app(settings)
    with TestClient(app) as client:
        response = client.post("/api/auth/register", json={
            "name": "Calendar user", "email": "calendar@example.com", "password": "calendar test password long",
        })
        assert response.status_code == 201
        connectors = {item["id"]: item for item in client.get("/api/connectors").json()}
        result = client.post("/api/connectors/google_calendar/connect")
        gmail_result = client.post("/api/connectors/gmail/connect")

    assert connectors["google_calendar"]["availability"] == "available"
    assert connectors["google_calendar"]["capabilities"] == ["Consulter les événements", "Vérifier les disponibilités"]
    assert [item["name"] for item in connectors["google_calendar"]["available_tools"]] == []
    assert result.status_code == 200
    assert result.json()["authorization_url"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert connectors["gmail"]["availability"] == "available"
    assert connectors["google_drive"]["availability"] == "available"
    assert gmail_result.status_code == 200
    from urllib.parse import parse_qs, urlparse
    assert parse_qs(urlparse(gmail_result.json()["authorization_url"]).query)["scope"] == ["https://www.googleapis.com/auth/gmail.readonly"]


def test_registry_marks_calendar_setup_required_until_oauth_is_configured():
    registry = ConnectorRegistry(setup_required_connector_ids={"google_calendar"})
    assert registry.get("google_calendar").availability == "setup_required"
    assert registry.get("gmail").availability == "coming_soon"


def test_calendar_oauth_connect_and_disconnect_require_a_session(tmp_path):
    settings = Settings(database_path=tmp_path / "calendar-auth.sqlite3", openai_api_key="", openai_model="")
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/connectors/google_calendar/connect").status_code == 401
        assert client.post("/api/connectors/google_calendar/disconnect").status_code == 401
