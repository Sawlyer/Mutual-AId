import asyncio
import pytest

from app.planning.schemas import ExecutionPlan, PlannedTask, PlanValidationError, validate_dag


def task(task_id: str, dependencies: list[str] | None = None) -> PlannedTask:
    return PlannedTask(id=task_id, title=task_id, description="", dependencies=dependencies or [])


def test_plan_accepts_independent_and_dependent_tasks():
    tasks = [task("research"), task("draft"), task("review", ["research", "draft"])]
    validate_dag(tasks)
    plan = ExecutionPlan(summary="Préparer le livrable", tasks=tasks)
    assert plan.tasks[2].dependencies == ["research", "draft"]


def test_plan_rejects_cycle():
    with pytest.raises(PlanValidationError, match="cycle"):
        validate_dag([task("a", ["b"]), task("b", ["a"])])


def test_plan_rejects_unknown_dependency():
    with pytest.raises(PlanValidationError, match="unknown dependency"):
        validate_dag([task("a", ["missing"])])


def test_plan_rejects_duplicate_task_id():
    with pytest.raises(PlanValidationError, match="duplicate"):
        validate_dag([task("a"), task("a")])


def test_router_keeps_simple_message_on_assistant_path(tmp_path):
    from app.agents.service import AgentService
    from app.db import Database
    from app.planning.router import RequestRouter
    from app.planning.schemas import PlanningDecision, PlanningRequest

    class FakePlanner:
        async def plan(self, *_args):
            return PlanningDecision(summary="Réponse simple", tasks=[], requires_orchestration=False)

    database = Database(tmp_path / "planning.sqlite3")
    database.initialize()
    router = RequestRouter(FakePlanner(), AgentService(database))
    result = asyncio.run(router.route(PlanningRequest(user_id="u", conversation_id="c", message="Salut"), [], []))
    assert result.requires_orchestration is False


def test_router_keeps_capability_template_fallback(tmp_path):
    from app.agents.service import AgentService
    from app.db import Database
    from app.planning.router import RequestRouter
    from app.planning.schemas import PlanningDecision, PlanningRequest

    class FakePlanner:
        async def plan(self, *_args):
            return PlanningDecision(summary="Organiser les habitudes", tasks=[PlannedTask(
                id="routine", title="Créer une routine", capability_ids=["wellness_planning"]
            )], requires_orchestration=True)

    database = Database(tmp_path / "planning.sqlite3")
    database.initialize()
    router = RequestRouter(FakePlanner(), AgentService(database))
    request = PlanningRequest(user_id="u", conversation_id="c", message="Organise un programme bien-être")
    result = asyncio.run(router.route(request, [], []))
    assert result.tasks[0].agent_profile_id
    assert result.tasks[0].agent_profile_id == database.list_agent_profiles("u")[0]["id"]
    assert "créé automatiquement" in result.tasks[0].agent_assignment_reason.lower()
    reused = asyncio.run(router.route(request, AgentService(database).list_profiles("u"), []))
    assert reused.tasks[0].agent_profile_id == result.tasks[0].agent_profile_id
    assert "réutilisé" in reused.tasks[0].agent_assignment_reason.lower()


def test_router_rejects_unknown_connector(tmp_path):
    from app.agents.service import AgentService
    from app.db import Database
    from app.planning.router import RequestRouter
    from app.planning.schemas import PlanningDecision, PlanningRequest

    database = Database(tmp_path / "planning-connector.sqlite3")
    database.initialize()

    class BadConnectorPlanner:
        async def plan(self, *_args):
            return PlanningDecision(summary="Lire le calendrier", tasks=[PlannedTask(
                id="calendar", title="Lire le calendrier", connector_ids=["google_calendar"]
            )], requires_orchestration=True)

    request = PlanningRequest(user_id="u", conversation_id="c", message="Read calendar")
    with pytest.raises(PlanValidationError, match="connector"):
        asyncio.run(RequestRouter(BadConnectorPlanner(), AgentService(database)).route(request, [], []))


def test_planner_instruction_never_supplies_tools_or_scopes():
    from app.planning.service import PLANNER_INSTRUCTIONS
    assert "no tools" in PLANNER_INSTRUCTIONS.lower()
    assert "oauth" in PLANNER_INSTRUCTIONS.lower()


def test_planner_receives_enabled_agent_skill_summaries(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from app.agents.models import AgentProfileCreate, AgentProfileUpdate, AgentSkillCreate
    from app.agents.service import AgentService
    from app.config import Settings
    from app.db import Database
    from app.planning import service as planning_service
    from app.planning.schemas import PlanningDecision, PlanningRequest

    database = Database(tmp_path / "planning-skills.sqlite3")
    database.initialize()
    agents = AgentService(database)
    profile = agents.create_profile("user", AgentProfileCreate(
        name="Researcher", domain="research", description="Research", instructions="Base.",
    ))
    enabled = agents.create_skill("user", AgentSkillCreate(name="Source checks", description="Verifies references.", instructions="Check sources."))
    disabled = agents.create_skill("user", AgentSkillCreate(name="Disabled skill", instructions="Do not show." , enabled=False))
    agents.update_profile("user", profile.id, AgentProfileUpdate(skill_ids=[enabled.id, disabled.id]))
    captured = []
    captured_reasoning_efforts = []

    async def fake_run(agent, user_input, **_kwargs):
        captured.append(user_input)
        captured_reasoning_efforts.append(agent.model_settings.reasoning.effort)
        return SimpleNamespace(final_output=PlanningDecision(summary="Simple", tasks=[], requires_orchestration=False))

    monkeypatch.setattr(planning_service.Runner, "run", fake_run)
    planner = planning_service.Planner(Settings(
        openai_api_key="key", openai_model="test-model", openai_reasoning_effort="high",
    ))
    asyncio.run(planner.plan(PlanningRequest(user_id="user", conversation_id="c", message="Hello"), agents.list_profiles("user"), []))

    assert "Source checks" in captured[0]
    assert "Verifies references." in captured[0]
    assert "Disabled skill" not in captured[0]
    assert captured_reasoning_efforts == ["high"]


def test_planner_receives_enabled_agent_descriptions_and_skill_summaries(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from app.agents.models import AgentProfileCreate, AgentProfileUpdate, AgentSkillCreate
    from app.agents.service import AgentService
    from app.config import Settings
    from app.db import Database
    from app.planning import service as planning_service
    from app.planning.schemas import PlanningDecision, PlanningRequest

    database = Database(tmp_path / "planning-agent-descriptions.sqlite3")
    database.initialize()
    agents = AgentService(database)
    enabled_profile = agents.create_profile("user", AgentProfileCreate(
        name="Conseiller santé", domain="health", description="Aide à créer des habitudes de sommeil réalistes.", instructions="Private instruction.",
    ))
    disabled_profile = agents.create_profile("user", AgentProfileCreate(
        name="Disabled profile", domain="disabled", description="Must not be sent.", instructions="Private.", enabled=False,
    ))
    enabled_skill = agents.create_skill("user", AgentSkillCreate(
        name="Routine de sommeil", description="Propose des routines de repos régulières.", instructions="Detailed private instructions.",
    ))
    disabled_skill = agents.create_skill("user", AgentSkillCreate(
        name="Hidden skill", description="Must not be sent.", instructions="Private.", enabled=False,
    ))
    agents.update_profile("user", enabled_profile.id, AgentProfileUpdate(skill_ids=[enabled_skill.id, disabled_skill.id]))
    captured = []

    async def fake_run(_agent, user_input, **_kwargs):
        captured.append(user_input)
        return SimpleNamespace(final_output=PlanningDecision(summary="Simple", tasks=[], requires_orchestration=False))

    monkeypatch.setattr(planning_service.Runner, "run", fake_run)
    planner = planning_service.Planner(Settings(openai_api_key="key", openai_model="test-model"))
    asyncio.run(planner.plan(
        PlanningRequest(user_id="user", conversation_id="c", message="Hello"),
        agents.list_profiles("user"),
        [],
    ))

    assert enabled_profile.id in captured[0]
    assert "Aide à créer des habitudes de sommeil réalistes." in captured[0]
    assert "Routine de sommeil" in captured[0]
    assert "Propose des routines de repos régulières." in captured[0]
    assert "Disabled profile" not in captured[0]
    assert "Hidden skill" not in captured[0]
    assert "Private instruction" not in captured[0]
    assert "Detailed private instructions" not in captured[0]


def test_router_accepts_explicit_profile_without_capability_intersection(tmp_path):
    from app.agents.models import AgentProfileCreate
    from app.agents.service import AgentService
    from app.db import Database
    from app.planning.router import RequestRouter
    from app.planning.schemas import PlanningDecision, PlanningRequest

    database = Database(tmp_path / "explicit-agent.sqlite3")
    database.initialize()
    agents = AgentService(database)
    profile = agents.create_profile("u", AgentProfileCreate(
        name="Specialist", domain="specialist", description="A specialist with no categories.", instructions="Help.",
    ))

    class FakePlanner:
        async def plan(self, *_args):
            return PlanningDecision(summary="Do work", tasks=[PlannedTask(
                id="task", title="Do work", capability_ids=["wellness_planning"], agent_profile_id=profile.id,
            )], requires_orchestration=True)

    request = PlanningRequest(user_id="u", conversation_id="c", message="Please do work")
    result = asyncio.run(RequestRouter(FakePlanner(), agents).route(request, agents.list_profiles("u"), []))
    assert result.tasks[0].agent_profile_id == profile.id
    assert "réutilisé" in result.tasks[0].agent_assignment_reason.lower()


def test_router_rejects_unknown_or_disabled_explicit_profile(tmp_path):
    from app.agents.models import AgentProfileCreate, AgentProfileUpdate
    from app.agents.service import AgentService
    from app.db import Database
    from app.planning.router import RequestRouter
    from app.planning.schemas import PlanningDecision, PlanningRequest

    database = Database(tmp_path / "invalid-explicit-agent.sqlite3")
    database.initialize()
    agents = AgentService(database)
    profile = agents.create_profile("u", AgentProfileCreate(
        name="Disabled", domain="disabled", description="Disabled.", instructions="Do not use.", enabled=False,
    ))

    class FakePlanner:
        def __init__(self, profile_id):
            self.profile_id = profile_id

        async def plan(self, *_args):
            return PlanningDecision(summary="Do work", tasks=[PlannedTask(
                id="task", title="Do work", agent_profile_id=self.profile_id,
            )], requires_orchestration=True)

    request = PlanningRequest(user_id="u", conversation_id="c", message="Please do work")
    with pytest.raises(PlanValidationError, match="unknown or disabled"):
        asyncio.run(RequestRouter(FakePlanner(profile.id), agents).route(request, agents.list_profiles("u"), []))
    with pytest.raises(PlanValidationError, match="unknown or disabled"):
        asyncio.run(RequestRouter(FakePlanner("foreign-or-unknown"), agents).route(request, agents.list_profiles("u"), []))


def test_an_unusable_plan_becomes_a_direct_answer(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from app.config import Settings
    from app.planning import service as planning_service
    from app.planning.schemas import PlannedTask, PlanningDecision, PlanningRequest

    async def fake_run(_agent, _user_input, **_kwargs):
        return SimpleNamespace(final_output=PlanningDecision(
            summary="Créer le diaporama",
            tasks=[PlannedTask(id="slides", title="Créer les diapositives", capability_ids=["design"])],
            requires_orchestration=True,
        ))

    monkeypatch.setattr(planning_service.Runner, "run", fake_run)
    planner = planning_service.Planner(Settings(openai_api_key="key", openai_model="test-model"))
    decision = asyncio.run(planner.plan(
        PlanningRequest(user_id="user", conversation_id="c", message="Je veux créer un magnifique diapo sur Gamma"),
        [],
        [],
    ))

    assert decision.requires_orchestration is False
    assert decision.tasks == []


def test_planner_preserves_provider_authentication_failure(tmp_path, monkeypatch):
    import httpx
    from openai import AuthenticationError

    from app.config import Settings
    from app.planning import service as planning_service
    from app.planning.schemas import PlanningRequest

    auth_error = AuthenticationError(
        "Incorrect API key provided", response=httpx.Response(
            401, request=httpx.Request("POST", "https://api.openai.com/v1/responses"),
        ), body=None,
    )

    async def failed_run(*_args, **_kwargs):
        raise auth_error

    monkeypatch.setattr(planning_service.Runner, "run", failed_run)
    planner = planning_service.Planner(Settings(openai_api_key="invalid", openai_model="test-model"))

    with pytest.raises(planning_service.PlanningAuthenticationError):
        asyncio.run(planner.plan(
            PlanningRequest(user_id="user", conversation_id="c", message="Planifie ceci"), [], [],
        ))
