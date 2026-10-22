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


def test_router_creates_missing_specialist_and_rejects_unknown_connector(tmp_path):
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

    class BadConnectorPlanner:
        async def plan(self, *_args):
            return PlanningDecision(summary="Lire le calendrier", tasks=[PlannedTask(
                id="calendar", title="Lire le calendrier", connector_ids=["google_calendar"]
            )], requires_orchestration=True)

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

    async def fake_run(_agent, user_input, **_kwargs):
        captured.append(user_input)
        return SimpleNamespace(final_output=PlanningDecision(summary="Simple", tasks=[], requires_orchestration=False))

    monkeypatch.setattr(planning_service.Runner, "run", fake_run)
    planner = planning_service.Planner(Settings(openai_api_key="key", openai_model="test-model"))
    asyncio.run(planner.plan(PlanningRequest(user_id="user", conversation_id="c", message="Hello"), agents.list_profiles("user"), []))

    assert "Source checks" in captured[0]
    assert "Verifies references." in captured[0]
    assert "Disabled skill" not in captured[0]
