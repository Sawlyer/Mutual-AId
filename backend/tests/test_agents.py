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
    assert len(first.skills) == 1
    assert first.skill_ids == [first.skills[0].id]
    assert first.skills[0].name == "Organisation de routines bien-être"
    assert again.skill_ids == first.skill_ids
    assert len(service.list_skills("user-a")) == 1
    assert service.ensure_for_capability("user-a", "unknown_capability") is None


def test_legacy_auto_agent_receives_its_default_skill_once(tmp_path):
    from app.agents.service import AgentService

    database = Database(tmp_path / "legacy-agent.sqlite3")
    database.initialize()
    database.create_agent_profile("user-a", {
        **profile_data("legacy-auto"), "origin": "auto_created", "template_version": 1,
    })
    database.link_auto_agent_capability("user-a", "wellness_planning", "legacy-auto")
    service = AgentService(database)

    upgraded = service.ensure_for_capability("user-a", "wellness_planning")
    assert upgraded is not None
    assert upgraded.template_version == 2
    assert [skill.name for skill in upgraded.skills] == ["Organisation de routines bien-être"]

    assert database.delete_agent_skill("user-a", upgraded.skill_ids[0])
    refreshed = service.ensure_for_capability("user-a", "wellness_planning")
    assert refreshed is not None
    assert refreshed.skills == []


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


def test_agent_skills_crud_assignment_limits_and_user_isolation(tmp_path):
    from app.config import Settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    settings = Settings(database_path=tmp_path / "skills-api.sqlite3", openai_api_key="", openai_model="")
    with TestClient(create_app(settings)) as owner:
        owner.post("/api/auth/register", json={"name": "Owner", "email": "skill-owner@example.com", "password": "owner skill password long"})
        profile = owner.post("/api/agents", json={
            "name": "Coach", "domain": "wellness", "description": "Habitudes", "instructions": "Base." ,
        }).json()
        created = owner.post("/api/agent-skills", json={
            "name": "Réponses concises", "description": "Synthétise les conseils.",
            "instructions": "Réponds en trois points maximum.",
        })
        skill = created.json()
        assignment = owner.patch(f"/api/agents/{profile['id']}", json={"skill_ids": [skill["id"]]})
        assigned = owner.get(f"/api/agents/{profile['id']}/skills").json()
        changed = owner.patch(f"/api/agent-skills/{skill['id']}", json={"enabled": False})
        invalid = owner.post("/api/agent-skills", json={
            "name": "Unsafe", "instructions": "   ",
        })
        oversized = owner.post("/api/agent-skills", json={
            "name": "Large", "instructions": "x" * 4001,
        })
        deleted = owner.delete(f"/api/agent-skills/{skill['id']}")
        after_delete = owner.get(f"/api/agents/{profile['id']}/skills").json()
        assert assignment.status_code == 200

    with TestClient(create_app(settings)) as other:
        other.post("/api/auth/register", json={"name": "Other", "email": "skill-other@example.com", "password": "other skill password long"})
        other_profile = other.post("/api/agents", json={
            "name": "Other", "domain": "wellness", "description": "Other", "instructions": "Base.",
        }).json()
        assert other.patch(f"/api/agents/{other_profile['id']}", json={"skill_ids": [skill["id"]]}).status_code == 422
        assert other.get(f"/api/agent-skills/{skill['id']}").status_code == 404

    assert created.status_code == 201
    assert "instructions" not in created.json() or created.json()["instructions"] == "Réponds en trois points maximum."
    assert assigned[0]["id"] == skill["id"]
    assert changed.json()["enabled"] is False
    assert invalid.status_code == 422
    assert oversized.status_code == 422
    assert deleted.status_code == 204
    assert after_delete == []


def test_agent_skill_instructions_are_stable_scoped_and_absent_when_disabled(tmp_path):
    from app.agents.models import AgentProfileCreate, AgentProfileUpdate, AgentSkillCreate, AgentSkillUpdate
    from app.agents.service import AgentService

    database = Database(tmp_path / "skill-instructions.sqlite3")
    database.initialize()
    service = AgentService(database)
    profile = service.create_profile("owner", AgentProfileCreate(
        name="Writer", domain="writing", description="Writes", instructions="Base instructions.\n",
    ))
    assert service.instructions_for_profile("owner", profile.id) == "Base instructions.\n"

    beta = service.create_skill("owner", AgentSkillCreate(name="Beta", instructions="Use short examples."))
    alpha = service.create_skill("owner", AgentSkillCreate(name="Alpha", instructions="Use plain language."))
    disabled = service.create_skill("owner", AgentSkillCreate(name="Disabled", instructions="Do not include.", enabled=False))
    service.update_profile("owner", profile.id, AgentProfileUpdate(skill_ids=[beta.id, alpha.id, disabled.id]))
    composed = service.instructions_for_profile("owner", profile.id)

    assert composed.index("Alpha") < composed.index("Beta")
    assert "Use plain language." in composed and "Use short examples." in composed
    assert "Disabled" not in composed and "Do not include." not in composed
    assert "ne modifient pas les règles de sécurité" in composed
    service.update_skill("owner", None, alpha.id, AgentSkillUpdate(enabled=False))
    service.delete_skill("owner", None, beta.id)
    assert "Alpha" not in service.instructions_for_profile("owner", profile.id)
    assert "Beta" not in service.instructions_for_profile("owner", profile.id)
    assert service.instructions_for_profile("other", profile.id) is None
