import asyncio

from app.db import Database
from app.planning.schemas import ExecutionPlan, PlannedTask
from app.executions.repository import ExecutionRepository


def sample_plan():
    return ExecutionPlan(summary="Rapport", tasks=[
        PlannedTask(id="collect", title="Collecter", expected_output="Notes"),
        PlannedTask(id="write", title="Rédiger", dependencies=["collect"], expected_output="Rapport"),
    ])


def test_execution_and_tasks_persist_and_are_owner_scoped(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    db.create_user("owner@example.com", "Owner", "hash")
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    created = repo.create("owner-id", conversation.id, sample_plan())

    assert created.status == "running"
    assert [task.status for task in created.tasks] == ["ready", "pending"]
    assert created.tasks[1].dependencies == ["collect"]
    assert repo.get("foreign", created.id) is None


def test_task_transition_persists_event_and_cursor(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())

    task = repo.transition_task("owner-id", execution.id, "collect", "running", "Démarrage")
    repo.transition_task("owner-id", execution.id, "collect", "completed", "Collecte terminée")
    events = repo.list_events("owner-id", execution.id)

    assert task.status == "running"
    assert [event.event_type for event in events] == ["execution.created", "task.started", "task.completed"]
    assert repo.list_events("owner-id", execution.id, after_id=events[1].id)[0].id == events[2].id
    assert repo.list_events("foreign", execution.id) == []


def test_scheduler_runs_parallel_tasks_and_waits_for_dependencies(tmp_path):
    from app.executions.scheduler import DagScheduler
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="DAG", tasks=[
        PlannedTask(id="a", title="A"), PlannedTask(id="b", title="B"),
        PlannedTask(id="c", title="C", dependencies=["a", "b"]),
    ])
    execution = repo.create("owner-id", conversation.id, plan)
    order = []

    async def execute(task):
        order.append((task.id, "start"))
        await asyncio.sleep(0.01)
        order.append((task.id, "end"))
        return task.id

    asyncio.run(DagScheduler(repo, execute, "owner-id", execution.id, max_concurrency=2).run())
    assert order.index(("a", "end")) < order.index(("c", "start"))
    assert order.index(("b", "end")) < order.index(("c", "start"))
    assert repo.get("owner-id", execution.id).status == "completed"


def test_partial_failure_preserves_completed_result(tmp_path):
    from app.executions.scheduler import DagScheduler
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Partiel", tasks=[
        PlannedTask(id="good", title="Réussi"), PlannedTask(id="bad", title="Échec"),
        PlannedTask(id="later", title="Dépendant", dependencies=["bad"]),
    ])
    execution = repo.create("owner-id", conversation.id, plan)

    async def execute(task):
        if task.id == "bad":
            raise RuntimeError("private failure")
        return "résultat conservé"

    asyncio.run(DagScheduler(repo, execute, "owner-id", execution.id).run())
    updated = repo.get("owner-id", execution.id)
    assert updated.status == "partial"
    assert next(task for task in updated.tasks if task.id == "good").result == "résultat conservé"
    assert next(task for task in updated.tasks if task.id == "later").status == "blocked"
    assert "private failure" not in str(updated.model_dump())


def test_approval_is_owner_scoped_and_idempotent(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, ExecutionPlan(summary="Write", tasks=[
        PlannedTask(id="write", title="Créer événement", approval_required=True),
    ]))
    approval_id = execution.tasks[0].approval_id
    assert approval_id
    assert repo.decide_approval("foreign", execution.id, approval_id, "approve") is None
    assert repo.decide_approval("owner-id", execution.id, approval_id, "approve") == "approve"
    assert repo.decide_approval("owner-id", execution.id, approval_id, "approve") == "approve"
    assert repo.decide_approval("owner-id", execution.id, approval_id, "reject") == "conflict"
    assert repo.get("owner-id", execution.id).tasks[0].status == "ready"


def test_restart_marks_active_execution_interrupted_and_records_event(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())
    repo.transition_task("owner-id", execution.id, "collect", "running", "En cours")

    assert repo.recover_interrupted() == 1
    updated = repo.get("owner-id", execution.id)
    assert updated.status == "interrupted"
    assert next(task for task in updated.tasks if task.id == "collect").status == "interrupted"
    assert repo.list_events("owner-id", execution.id)[-1].event_type == "execution.interrupted"


def test_final_execution_message_is_persisted_once(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())

    first = repo.create_final_message_once("owner-id", execution.id, "Résultat final")
    again = repo.create_final_message_once("owner-id", execution.id, "Un autre résultat")

    assert first is not None
    assert first.content == "Résultat final"
    assert again is None
    messages = db.list_messages(conversation.id)
    assert len(messages) == 1
    assert messages[0].content == "Résultat final"


def test_agent_task_executor_resolves_current_enabled_profile_skills(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from app.agents.models import AgentProfileCreate, AgentProfileUpdate, AgentSkillCreate, AgentSkillUpdate
    from app.agents.service import AgentService
    from app.config import Settings
    from app.connectors.registry import ConnectorRegistry
    from app.connectors.tools import ToolRegistry
    from app.executions import coordinator
    from app.executions.coordinator import AgentTaskExecutor
    from app.executions.models import TaskRead

    database = Database(tmp_path / "execution-skills.sqlite3")
    database.initialize()
    service = AgentService(database)
    profile = service.create_profile("owner", AgentProfileCreate(
        name="Researcher", domain="research", description="Research", instructions="Base instructions.",
    ))
    skill = service.create_skill("owner", AgentSkillCreate(name="Citations", instructions="Cite every source."))
    service.update_profile("owner", profile.id, AgentProfileUpdate(skill_ids=[skill.id]))
    repo = ExecutionRepository(database)
    settings = Settings(database_path=database.path, openai_api_key="test-key", openai_model="test-model")
    captured_instructions = []

    async def fake_run(agent, *_args, **_kwargs):
        captured_instructions.append(agent.instructions)
        return SimpleNamespace(final_output="done")

    monkeypatch.setattr(coordinator.Runner, "run", fake_run)
    executor = AgentTaskExecutor(
        settings, repo, "owner", "execution-not-created", database, ToolRegistry(ConnectorRegistry()),
        None, agent_service=service,
    )
    task = TaskRead(
        id="research", title="Research", description="", dependencies=[], capability_ids=[],
        agent_profile_id=profile.id, agent_profile_snapshot={"name": profile.name, "instructions": profile.instructions},
        connector_ids=[], expected_output="Notes", approval_required=False, status="ready",
    )

    asyncio.run(executor(task))
    service.update_skill("owner", None, skill.id, AgentSkillUpdate(enabled=False))
    asyncio.run(executor(task))

    assert "Cite every source." in captured_instructions[0]
    assert "Cite every source." not in captured_instructions[1]
