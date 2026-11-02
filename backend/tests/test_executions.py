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


def test_resume_requeues_safe_work_without_replaying_completed_or_external_tasks(tmp_path):
    db = Database(tmp_path / "resume.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Resume", tasks=[
        PlannedTask(id="done", title="Déjà terminée"),
        PlannedTask(id="safe", title="Sans effet externe"),
        PlannedTask(id="external", title="Action externe", connector_ids=["gmail"]),
        PlannedTask(id="child", title="Après la tâche sûre", dependencies=["safe"]),
    ])
    execution = repo.create("owner-id", conversation.id, plan)
    repo.complete_task("owner-id", execution.id, "done", "résultat durable")
    repo.transition_task("owner-id", execution.id, "safe", "interrupted", "Processus arrêté")
    repo.transition_task("owner-id", execution.id, "external", "interrupted", "Processus arrêté")
    repo.set_execution_status("owner-id", execution.id, "interrupted", "Processus arrêté")

    resumed = repo.resume_interrupted("owner-id", execution.id)

    assert resumed.status == "running"
    states = {task.id: task.status for task in resumed.tasks}
    assert states == {"done": "completed", "safe": "ready", "external": "blocked", "child": "pending"}
    assert next(task for task in resumed.tasks if task.id == "external").error
    assert repo.list_events("owner-id", execution.id)[-1].event_type == "execution.running"


def test_final_execution_message_is_updated_when_a_run_resumes(tmp_path):
    db = Database(tmp_path / "final-message.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())

    first = repo.create_final_message_once("owner-id", execution.id, "Exécution interrompue")
    repo.set_execution_status("owner-id", execution.id, "interrupted", "Arrêt du processus")
    repo.resume_interrupted("owner-id", execution.id)
    updated = repo.create_final_message_once("owner-id", execution.id, "Exécution terminée")

    assert first is not None
    assert updated is not None
    assert updated.id != first.id
    assert updated.content == "Exécution terminée"
    messages = db.list_messages(conversation.id)
    assert [message.content for message in messages] == ["Exécution interrompue", "Exécution terminée"]


def test_task_transition_persists_event_and_cursor(tmp_path):
    db = Database(tmp_path / "execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Rapport", tasks=[
        PlannedTask(id="collect", title="Collecter", expected_output="Notes", agent_profile_id="agent-alpha"),
        PlannedTask(id="write", title="Rédiger", dependencies=["collect"], expected_output="Rapport"),
    ])
    execution = repo.create("owner-id", conversation.id, plan)

    task = repo.transition_task("owner-id", execution.id, "collect", "running", "Démarrage")
    repo.transition_task("owner-id", execution.id, "collect", "completed", "Collecte terminée")
    events = repo.list_events("owner-id", execution.id)

    assert task.status == "running"
    assert [event.event_type for event in events] == ["execution.created", "task.started", "task.completed"]
    assert [(event.agent_id, event.status) for event in events] == [
        (None, "running"),
        ("agent-alpha", "running"),
        ("agent-alpha", "completed"),
    ]
    assert repo.list_events("owner-id", execution.id, after_id=events[1].id)[0].id == events[2].id
    assert repo.list_events("foreign", execution.id) == []


def test_database_migrates_legacy_execution_events(tmp_path):
    import sqlite3

    path = tmp_path / "legacy-events.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TABLE execution_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            execution_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            task_id TEXT,
            event_type TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )""")
        connection.execute(
            "INSERT INTO execution_events (execution_id, user_id, task_id, event_type, message, created_at) "
            "VALUES ('exec-1', 'owner-id', 'task-1', 'task.completed', 'done', '2026-10-26T12:00:00Z')"
        )

    Database(path).initialize()

    with sqlite3.connect(path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(execution_events)")}
        event = connection.execute("SELECT agent_id, status FROM execution_events WHERE id = 1").fetchone()
    assert {"agent_id", "status"}.issubset(columns)
    assert event == (None, "unknown")


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


def test_scheduler_pauses_at_task_boundary_without_starting_dependents(tmp_path):
    from app.executions.scheduler import DagScheduler

    db = Database(tmp_path / "execution-pause-boundary.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Pause", tasks=[
        PlannedTask(id="first", title="Première tâche", expected_output="Terminé"),
        PlannedTask(id="next", title="Tâche suivante", dependencies=["first"], expected_output="Terminé"),
    ])
    execution = repo.create("owner-id", conversation.id, plan)
    task_started = asyncio.Event()
    finish_task = asyncio.Event()
    pause_requested = asyncio.Event()

    async def handler(task):
        if task.id == "first":
            task_started.set()
            await finish_task.wait()
        return "Terminé"

    async def run_scheduler():
        scheduler = DagScheduler(repo, handler, "owner-id", execution.id, pause_event=pause_requested)
        await scheduler.run()

    async def exercise_pause():
        scheduled = asyncio.create_task(run_scheduler())
        await asyncio.wait_for(task_started.wait(), timeout=1)
        pause_requested.set()
        finish_task.set()
        await scheduled

    asyncio.run(exercise_pause())

    paused = repo.get("owner-id", execution.id)
    assert paused is not None
    assert paused.status == "paused"
    assert [task.status for task in paused.tasks] == ["completed", "ready"]


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


def test_failed_branch_does_not_block_independent_branch(tmp_path):
    from app.executions.scheduler import DagScheduler

    db = Database(tmp_path / "execution-branches.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Branches", tasks=[
        PlannedTask(id="bad-root", title="Branche en échec"),
        PlannedTask(id="good-root", title="Branche indépendante"),
        PlannedTask(id="good-child", title="Suite indépendante", dependencies=["good-root"]),
        PlannedTask(id="bad-child", title="Suite impossible", dependencies=["bad-root"]),
    ])
    execution = repo.create("owner-id", conversation.id, plan)
    completed = []

    async def execute(task):
        if task.id == "bad-root":
            raise RuntimeError("provider error")
        completed.append(task.id)
        return f"result-{task.id}"

    asyncio.run(DagScheduler(repo, execute, "owner-id", execution.id).run())

    updated = repo.get("owner-id", execution.id)
    statuses = {task.id: task.status for task in updated.tasks}
    assert completed == ["good-root", "good-child"]
    assert statuses == {
        "bad-root": "failed",
        "good-root": "completed",
        "good-child": "completed",
        "bad-child": "blocked",
    }
    assert updated.status == "partial"


def test_scheduler_retries_only_tasks_without_external_connectors(tmp_path):
    from app.executions.scheduler import DagScheduler

    db = Database(tmp_path / "execution-retries.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    plan = ExecutionPlan(summary="Retries", tasks=[
        PlannedTask(id="safe", title="Génération interne"),
        PlannedTask(id="external", title="Action externe", connector_ids=["gmail"]),
    ])
    execution = repo.create("owner-id", conversation.id, plan)
    calls = {"safe": 0, "external": 0}

    async def execute(task):
        calls[task.id] += 1
        raise RuntimeError("temporary provider failure")

    asyncio.run(DagScheduler(repo, execute, "owner-id", execution.id, max_attempts=2).run())

    assert calls == {"safe": 2, "external": 1}
    with db.connection() as connection:
        attempts = connection.execute(
            "SELECT task_id, COUNT(*) AS count FROM execution_attempts WHERE execution_id = ? GROUP BY task_id",
            (execution.id,),
        ).fetchall()
    assert {row["task_id"]: row["count"] for row in attempts} == {"safe": 2, "external": 1}
    updated = repo.get("owner-id", execution.id)
    assert {task.id: task.attempts for task in updated.tasks} == {"safe": 2, "external": 1}
    assert sum(event.event_type == "task.retrying" for event in repo.list_events("owner-id", execution.id)) == 1


def test_scheduler_times_out_a_task_and_exposes_only_generic_failure(tmp_path):
    from app.executions.scheduler import DagScheduler

    db = Database(tmp_path / "execution-timeout.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, ExecutionPlan(summary="Timeout", tasks=[
        PlannedTask(id="slow", title="Tâche lente"),
    ]))
    calls = 0

    async def execute(_task):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return "trop tard"

    asyncio.run(DagScheduler(
        repo,
        execute,
        "owner-id",
        execution.id,
        max_attempts=2,
        task_timeout_seconds=0.01,
    ).run())

    updated = repo.get("owner-id", execution.id)
    assert calls == 2
    assert updated.status == "partial"
    assert updated.tasks[0].attempts == 2
    assert updated.tasks[0].error == "La tâche n’a pas pu être terminée."


def test_artifacts_are_scoped_to_the_execution_owner(tmp_path):
    db = Database(tmp_path / "execution-artifacts.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())
    repo.complete_task("owner-id", execution.id, "collect", "Source data")

    artifacts = repo.list_artifacts("owner-id", execution.id)

    assert len(artifacts) == 1
    assert artifacts[0].task_id == "collect"
    assert artifacts[0].name == "Collecter"
    assert repo.get_artifact("owner-id", execution.id, artifacts[0].id).content == "Source data"
    assert repo.list_artifacts("other-user", execution.id) == []
    assert repo.get_artifact("other-user", execution.id, artifacts[0].id) is None


def test_oversized_task_result_is_rejected_before_persistence(tmp_path):
    from app.executions.repository import MAX_ARTIFACT_BYTES

    db = Database(tmp_path / "execution-large-artifact.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())

    try:
        repo.complete_task("owner-id", execution.id, "collect", "x" * (MAX_ARTIFACT_BYTES + 1))
    except ValueError as error:
        assert "storage limit" in str(error)
    else:
        raise AssertionError("oversized output must be rejected")

    assert repo.list_artifacts("owner-id", execution.id) == []
    assert next(task for task in repo.get("owner-id", execution.id).tasks if task.id == "collect").status == "ready"


def test_cancelling_terminal_execution_is_idempotent(tmp_path):
    from app.executions.coordinator import ExecutionCoordinator

    db = Database(tmp_path / "execution-terminal-cancel.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())
    repo.set_execution_status("owner-id", execution.id, "completed", "Terminée")
    coordinator = ExecutionCoordinator(repo, None, None, None, None, None)
    event_count = len(repo.list_events("owner-id", execution.id))

    cancelled = asyncio.run(coordinator.cancel("owner-id", execution.id))

    assert cancelled.status == "completed"
    assert len(repo.list_events("owner-id", execution.id)) == event_count


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


def test_paused_execution_does_not_persist_a_final_message(tmp_path):
    from app.executions.coordinator import ExecutionCoordinator

    db = Database(tmp_path / "paused-execution.sqlite3")
    db.initialize()
    conversation = db.create_conversation("Test", "owner-id")
    repo = ExecutionRepository(db)
    execution = repo.create("owner-id", conversation.id, sample_plan())
    repo.set_execution_status("owner-id", execution.id, "paused", "En pause")
    coordinator = ExecutionCoordinator(repo, None, None, None, None, None)

    coordinator._persist_final_answer("owner-id", execution.id)

    assert db.list_messages(conversation.id) == []


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
