from app.connectors.registry import ConnectorRegistry
from app.connectors.tools import ConnectorAuthorizationError, ToolRegistry
from app.main import create_app
from app.config import Settings
from app.db import Database
from fastapi.testclient import TestClient


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
    assert connectors["github"]["availability"] == "coming_soon"
    assert connectors["custom_mcp"]["availability"] == "coming_soon"
    assert all(connector["available_tools"] == [] for connector in connectors.values())


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
