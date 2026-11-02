import sqlite3

from fastapi.testclient import TestClient

from app.auth import hash_password
from app.config import Settings
from app.db import Database
from app.main import create_app


def client_for(database_path):
    settings = Settings(_env_file=None, database_path=database_path, openai_api_key="", openai_model="")
    return TestClient(create_app(settings))


def test_register_creates_hashed_account_and_http_only_session(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        response = client.post("/api/auth/register", json={
            "name": "Ada Lovelace", "email": "Ada@Example.com", "password": "correct horse battery staple",
        })

        assert response.status_code == 201
        assert response.json()["email"] == "ada@example.com"
        assert response.json()["name"] == "Ada Lovelace"
        assert "password" not in response.json()
        cookie = response.headers["set-cookie"].lower()
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert client.get("/api/auth/me").json()["id"] == response.json()["id"]

        stored = client.app.state.database.get_user_by_email("ada@example.com")
        assert stored is not None
        assert "correct horse battery staple" not in stored["password_hash"]
        assert stored["password_hash"].startswith("$argon2id$")


def test_login_rejects_bad_password_and_logout_revokes_session(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        client.post("/api/auth/register", json={
            "name": "Ada", "email": "ada@example.com", "password": "correct horse battery staple",
        })
        client.cookies.clear()
        rejected = client.post("/api/auth/login", json={"email": "ada@example.com", "password": "wrong password"})
        assert rejected.status_code == 401
        assert "set-cookie" not in rejected.headers

        accepted = client.post("/api/auth/login", json={"email": "ADA@example.com", "password": "correct horse battery staple"})
        assert accepted.status_code == 200
        assert client.get("/api/auth/me").status_code == 200
        assert client.post("/api/auth/logout").status_code == 204
        assert client.get("/api/auth/me").status_code == 401


def test_delete_account_requires_password_and_removes_owned_data(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        registered = client.post("/api/auth/register", json={
            "name": "Ada", "email": "ada@example.com", "password": "correct horse battery staple",
        })
        user_id = registered.json()["id"]
        database = client.app.state.database
        conversation = database.create_conversation("Private", user_id)
        database.create_message(conversation.id, "user", "private message")
        database.store_connector_credentials(user_id, "github", "encrypted-token")
        database.create_mcp_server("mcp-1", user_id, "Private MCP", "https://example.com/mcp", "encrypted-mcp-token")
        other_user = database.create_user("grace@example.com", "Grace", hash_password("another password with twelve"))
        other_conversation = database.create_conversation("Other account", other_user.id)
        database.create_message(other_conversation.id, "user", "must remain private")

        deleted = client.request("DELETE", "/api/auth/account", json={"password": "correct horse battery staple"})

        assert deleted.status_code == 204
        assert client.get("/api/auth/me").status_code == 401
        assert database.get_conversation(other_conversation.id, other_user.id) is not None
        with database.connection() as connection:
            expected_counts = {"users": 1, "auth_sessions": 0, "conversations": 1, "messages": 1}
            for table, expected_count in expected_counts.items():
                assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == expected_count
            for table in ("connector_credentials", "mcp_servers"):
                assert connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0


def test_delete_account_rejects_wrong_password_and_active_execution(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    with client_for(tmp_path / "auth.sqlite3") as client:
        registered = client.post("/api/auth/register", json={
            "name": "Ada", "email": "ada@example.com", "password": "correct horse battery staple",
        })
        user_id = registered.json()["id"]
        database = client.app.state.database
        conversation = database.create_conversation("Private", user_id)

        wrong_password = client.request("DELETE", "/api/auth/account", json={"password": "incorrect password"})
        assert wrong_password.status_code == 401
        assert client.get("/api/auth/me").status_code == 200

        ExecutionRepository(database).create(user_id, conversation.id, ExecutionPlan(
            summary="Active", tasks=[PlannedTask(id="task", title="Still running")],
        ))
        active_execution = client.request("DELETE", "/api/auth/account", json={"password": "correct horse battery staple"})

        assert active_execution.status_code == 409
        assert client.get("/api/auth/me").status_code == 200


def test_protected_routes_require_a_valid_session(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        assert client.get("/api/conversations").status_code == 401
        assert client.get("/api/connectors").status_code == 401
        assert client.post("/api/conversations", json={}).status_code == 401


def test_first_account_claims_legacy_local_conversations_and_accounts_are_isolated(tmp_path):
    database_path = tmp_path / "auth.sqlite3"
    database = Database(database_path)
    database.initialize()
    legacy = database.create_conversation("Historique local", owner_id="local-user")

    with client_for(database_path) as first:
        first_signup = first.post("/api/auth/register", json={
            "name": "Utilisateur un", "email": "one@example.com", "password": "account one password 123",
        })
        first_conversations = first.get("/api/conversations").json()
        assert first_signup.status_code == 201
        assert [item["id"] for item in first_conversations] == [legacy.id]

    with client_for(database_path) as second:
        second_signup = second.post("/api/auth/register", json={
            "name": "Utilisateur deux", "email": "two@example.com", "password": "account two password 456",
        })
        assert second_signup.status_code == 201
        assert second.get("/api/conversations").json() == []
        assert second.get(f"/api/conversations/{legacy.id}").status_code == 404


def test_registration_rejects_duplicate_email_and_weak_password(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        payload = {"name": "Ada", "email": "ada@example.com", "password": "correct horse battery staple"}
        assert client.post("/api/auth/register", json=payload).status_code == 201
        duplicate = client.post("/api/auth/register", json={**payload, "email": "ADA@example.com"})
        weak = client.post("/api/auth/register", json={**payload, "email": "weak@example.com", "password": "short"})

    assert duplicate.status_code == 409
    assert weak.status_code == 422


def test_cookie_mutations_reject_untrusted_origins(tmp_path):
    with client_for(tmp_path / "auth.sqlite3") as client:
        response = client.post(
            "/api/auth/register",
            headers={"Origin": "https://attacker.example"},
            json={"name": "Ada", "email": "ada@example.com", "password": "correct horse battery staple"},
        )

    assert response.status_code == 403
