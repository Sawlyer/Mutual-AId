from app.db import Database


def profile_data(profile_id: str, user_id: str = "user-a") -> dict[str, object]:
    return {
        "id": profile_id,
        "user_id": user_id,
        "name": "Coach santé",
        "domain": "wellness",
        "description": "Aide à organiser des habitudes de santé.",
        "instructions": "Aide à planifier des habitudes réalistes.",
        "capability_ids": ["wellness_planning"],
        "enabled": True,
        "origin": "user_created",
        "template_version": 1,
    }


def test_agent_profile_crud_is_owner_scoped(tmp_path):
    database = Database(tmp_path / "agents.sqlite3")
    database.initialize()
    created = database.create_agent_profile("user-a", profile_data("profile-a"))

    assert created["id"] == "profile-a"
    assert created["user_id"] == "user-a"
    assert created["capability_ids"] == ["wellness_planning"]
    assert [item["id"] for item in database.list_agent_profiles("user-a")] == ["profile-a"]
    assert database.list_agent_profiles("user-b") == []
    assert database.get_agent_profile("user-b", "profile-a") is None

    updated = database.update_agent_profile("user-a", "profile-a", {"name": "Coach bien-être", "enabled": False})
    assert updated is not None
    assert updated["name"] == "Coach bien-être"
    assert updated["enabled"] is False
    assert database.update_agent_profile("user-b", "profile-a", {"name": "Vol"}) is None
    assert database.delete_agent_profile("user-b", "profile-a") is False
    assert database.delete_agent_profile("user-a", "profile-a") is True
    assert database.get_agent_profile("user-a", "profile-a") is None


def test_auto_agent_capability_mapping_is_unique_per_user(tmp_path):
    database = Database(tmp_path / "agents.sqlite3")
    database.initialize()
    database.create_agent_profile("user-a", {**profile_data("auto-a"), "origin": "auto_created"})
    database.create_agent_profile("user-b", {**profile_data("auto-b", "user-b"), "origin": "auto_created"})
    database.link_auto_agent_capability("user-a", "wellness_planning", "auto-a")
    database.link_auto_agent_capability("user-b", "wellness_planning", "auto-b")

    assert database.get_auto_agent_profile("user-a", "wellness_planning")["id"] == "auto-a"
    assert database.get_auto_agent_profile("user-b", "wellness_planning")["id"] == "auto-b"


def test_ensure_for_capability_creates_and_reuses_reviewed_profile(tmp_path):
    from app.agents.service import AgentService

    database = Database(tmp_path / "agents.sqlite3")
    database.initialize()
    service = AgentService(database)

    first = service.ensure_for_capability("user-a", "wellness_planning")
    again = service.ensure_for_capability("user-a", "wellness_planning")

    assert first is not None
    assert first.id == again.id
    assert first.origin == "auto_created"
    assert "diagnostic" in first.instructions.lower()
    assert first.capability_ids == ["wellness_planning"]
    assert service.ensure_for_capability("user-a", "unknown_capability") is None


def test_disabled_profile_is_not_selected_or_recreated(tmp_path):
    from app.agents.service import AgentService

    database = Database(tmp_path / "agents.sqlite3")
    database.initialize()
    service = AgentService(database)
    profile = service.ensure_for_capability("user-a", "schedule_planning")
    assert profile is not None
    database.update_agent_profile("user-a", profile.id, {"enabled": False})

    assert service.ensure_for_capability("user-a", "schedule_planning") is None
    assert len(database.list_agent_profiles("user-a")) == 1


def test_profile_update_rejects_permission_fields(tmp_path):
    from app.agents.models import AgentProfileUpdate
    from pydantic import ValidationError

    try:
        AgentProfileUpdate.model_validate({"name": "Agent", "tools": ["gmail.send"], "scopes": ["calendar.write"]})
    except ValidationError:
        pass
    else:
        raise AssertionError("Profile edits must not add executable tools or OAuth scopes")


def test_auto_create_is_idempotent_under_concurrent_requests(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from app.agents.service import AgentService

    database_path = tmp_path / "agents.sqlite3"
    database = Database(database_path)
    database.initialize()

    def ensure():
        return AgentService(Database(database_path)).ensure_for_capability("user-a", "wellness_planning").id

    with ThreadPoolExecutor(max_workers=8) as pool:
        profile_ids = list(pool.map(lambda _: ensure(), range(16)))
    assert len(set(profile_ids)) == 1
    assert len(database.list_agent_profiles("user-a")) == 1


def test_agent_api_crud_requires_owner_and_hides_foreign_profiles(tmp_path):
    from app.config import Settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app(Settings(database_path=tmp_path / "api.sqlite3", openai_api_key="", openai_model=""))) as client:
        assert client.get("/api/agents").status_code == 401
        first = client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "account a test password"})
        created = client.post("/api/agents", json={
            "name": "Coach", "domain": "wellness", "description": "Habitudes", "instructions": "Planifie avec prudence.",
            "capability_ids": ["wellness_planning"],
        })
        assert first.status_code == 201
        assert created.status_code == 201
        profile_id = created.json()["id"]
        assert client.get("/api/agents").json()["profiles"][0]["id"] == profile_id
        assert client.patch(f"/api/agents/{profile_id}", json={"tools": ["gmail.send"]}).status_code == 422
        assert client.post("/api/agents", json={
            "name": "Arbitrary", "domain": "anything", "description": "x", "instructions": "x",
            "capability_ids": ["unknown"],
        }).status_code == 422

    with TestClient(create_app(Settings(database_path=tmp_path / "api.sqlite3", openai_api_key="", openai_model=""))) as client:
        client.post("/api/auth/register", json={"name": "B", "email": "b@example.com", "password": "account b test password"})
        assert client.get(f"/api/agents/{profile_id}").status_code == 404
        assert client.patch(f"/api/agents/{profile_id}", json={"name": "Stolen"}).status_code == 404
        assert client.delete(f"/api/agents/{profile_id}").status_code == 404
