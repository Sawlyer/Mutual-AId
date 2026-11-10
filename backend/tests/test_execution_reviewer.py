import asyncio
import json
import sqlite3
from types import SimpleNamespace

from app.db import Database
from app.executions.models import ExecutionRead, TaskRead
from app.executions.repository import ExecutionRepository
from app.executions.reviewer import ExecutionResultReview, ExecutionResultReviewer
from app.planning.schemas import ExecutionPlan, PlannedTask


def _execution():
    return ExecutionRead(
        id="execution-1",
        conversation_id="conversation-1",
        status="validating",
        summary="Prepare a concise report",
        tasks=[],
        created_at="now",
        updated_at="now",
    )


def test_reviewer_uses_structured_output_without_tools_and_returns_only_verdict(monkeypatch):
    from app.executions import reviewer as reviewer_module

    calls = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            calls["agent"] = kwargs

    class FakeRunner:
        @staticmethod
        async def run(agent, prompt, *, max_turns, run_config):
            calls["prompt"] = prompt
            calls["max_turns"] = max_turns
            return SimpleNamespace(final_output=ExecutionResultReview(
                verdict="verified", feedback="Les sorties répondent aux livrables demandés.",
            ))

    monkeypatch.setattr(reviewer_module, "Agent", FakeAgent)
    monkeypatch.setattr(reviewer_module, "Runner", FakeRunner)
    settings = SimpleNamespace(openai_configured=True, openai_model="gpt-test")

    review = asyncio.run(ExecutionResultReviewer(settings).review(_execution()))

    assert review.verdict == "verified"
    assert calls["agent"]["output_type"] is ExecutionResultReview
    assert calls["agent"]["tools"] == []
    assert calls["agent"]["model"] == "gpt-test"
    assert calls["max_turns"] == 1
    assert "step-by-step reasoning" in calls["agent"]["instructions"]


def test_reviewer_marks_truncated_result_inputs_for_review(monkeypatch):
    from app.executions import reviewer as reviewer_module

    calls = {}

    class FakeAgent:
        def __init__(self, **_kwargs):
            pass

    class FakeRunner:
        @staticmethod
        async def run(_agent, prompt, **_kwargs):
            calls["payload"] = json.loads(prompt)
            return SimpleNamespace(final_output={
                "verdict": "needs_review",
                "feedback": "Le résultat dépasse la portion examinée.",
            })

    monkeypatch.setattr(reviewer_module, "Agent", FakeAgent)
    monkeypatch.setattr(reviewer_module, "Runner", FakeRunner)
    execution = _execution().model_copy(update={
        "tasks": [TaskRead(
            id="task-1", title="Écrire", description="", dependencies=[],
            capability_ids=[], agent_profile_id=None, connector_ids=[],
            expected_output="Rapport", approval_required=False, status="completed",
            attempts=1, result="R" * 5000,
        )],
    })

    review = asyncio.run(ExecutionResultReviewer(
        SimpleNamespace(openai_configured=True, openai_model="gpt-test"),
    ).review(execution))

    assert calls["payload"]["input_truncated"] is True
    assert calls["payload"]["tasks"][0]["result_truncated"] is True
    assert review.verdict == "needs_review"


def test_repository_persists_result_review_and_records_an_event(tmp_path):
    database = Database(tmp_path / "review-persistence.sqlite3")
    database.initialize()
    conversation = database.create_conversation("Test", "owner-id")
    repository = ExecutionRepository(database)
    execution = repository.create("owner-id", conversation.id, ExecutionPlan(
        summary="Review", tasks=[PlannedTask(id="report", title="Write report")],
    ))

    repository.set_result_review("owner-id", execution.id, "needs_review", "Check the source for the total.")

    reviewed = repository.get("owner-id", execution.id)
    event = repository.list_events("owner-id", execution.id)[-1]
    assert reviewed.result_review_status == "needs_review"
    assert reviewed.result_review_feedback == "Check the source for the total."
    assert event.event_type == "execution.review_needs_attention"
    assert event.message == reviewed.result_review_feedback


def test_existing_terminal_executions_migrate_as_not_reviewed(tmp_path):
    path = tmp_path / "legacy-executions.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """CREATE TABLE executions (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
                status TEXT NOT NULL, summary TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            "INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("old-execution", "owner-id", "conversation-id", "completed", "Old result", "now", "now"),
        )

    database = Database(path)
    database.initialize()
    execution = ExecutionRepository(database).get("owner-id", "old-execution")

    assert execution.result_review_status == "skipped"
    assert execution.result_review_feedback == "Cette exécution précède la revue IA."


def test_restart_during_result_review_can_resume_without_rerunning_completed_tasks(tmp_path):
    database = Database(tmp_path / "execution-review-recovery.sqlite3")
    database.initialize()
    conversation = database.create_conversation("Test", "owner-id")
    repository = ExecutionRepository(database)
    execution = repository.create("owner-id", conversation.id, ExecutionPlan(
        summary="Review after restart", tasks=[PlannedTask(id="report", title="Write report")],
    ))
    repository.complete_task("owner-id", execution.id, "report", "Result saved")
    repository.set_execution_status("owner-id", execution.id, "validating", "Independent review started")

    assert repository.recover_interrupted() == 1
    interrupted = repository.get("owner-id", execution.id)
    resumed = repository.resume_interrupted("owner-id", execution.id)

    assert interrupted.status == "interrupted"
    assert resumed.status == "running"
    assert resumed.tasks[0].status == "completed"
    assert resumed.result_review_status == "pending"


def test_coordinator_finishes_after_an_independent_review_and_keeps_review_feedback(tmp_path, monkeypatch):
    from app.executions import coordinator as coordinator_module
    from app.executions.coordinator import ExecutionCoordinator

    database = Database(tmp_path / "review-coordinator.sqlite3")
    database.initialize()
    conversation = database.create_conversation("Test", "owner-id")
    repository = ExecutionRepository(database)
    execution = repository.create("owner-id", conversation.id, ExecutionPlan(
        summary="Prepare a report", tasks=[PlannedTask(id="report", title="Write report")],
    ))

    class FakeTaskExecutor:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __call__(self, _task):
            return "Report with the requested findings."

    class FakeReviewer:
        async def review(self, reviewed_execution):
            assert reviewed_execution.status == "validating"
            assert reviewed_execution.tasks[0].status == "completed"
            return ExecutionResultReview(
                verdict="verified", feedback="The outputs match the requested deliverables.",
            )

    monkeypatch.setattr(coordinator_module, "AgentTaskExecutor", FakeTaskExecutor)
    coordinator = ExecutionCoordinator(
        repository, None, SimpleNamespace(max_parallel_tasks=2), database, None, None,
        result_reviewer=FakeReviewer(),
    )

    asyncio.run(coordinator.run("owner-id", execution.id))

    result = repository.get("owner-id", execution.id)
    assert result.status == "completed"
    assert result.result_review_status == "verified"
    assert result.result_review_feedback == "The outputs match the requested deliverables."
    with database.connection() as connection:
        final_message = connection.execute(
            "SELECT content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1",
            (conversation.id,),
        ).fetchone()["content"]
    assert "Revue IA" in final_message
    assert result.result_review_feedback in final_message


def test_review_failure_does_not_discard_completed_execution(tmp_path, monkeypatch):
    from app.executions import coordinator as coordinator_module
    from app.executions.coordinator import ExecutionCoordinator

    database = Database(tmp_path / "review-unavailable.sqlite3")
    database.initialize()
    conversation = database.create_conversation("Test", "owner-id")
    repository = ExecutionRepository(database)
    execution = repository.create("owner-id", conversation.id, ExecutionPlan(
        summary="Prepare a report", tasks=[PlannedTask(id="report", title="Write report")],
    ))

    class FakeTaskExecutor:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __call__(self, _task):
            return "Report with the requested findings."

    class UnavailableReviewer:
        async def review(self, _execution):
            raise TimeoutError("private provider detail")

    monkeypatch.setattr(coordinator_module, "AgentTaskExecutor", FakeTaskExecutor)
    coordinator = ExecutionCoordinator(
        repository, None, SimpleNamespace(max_parallel_tasks=2), database, None, None,
        result_reviewer=UnavailableReviewer(),
    )

    asyncio.run(coordinator.run("owner-id", execution.id))

    result = repository.get("owner-id", execution.id)
    assert result.status == "completed"
    assert result.result_review_status == "unavailable"
    assert "private provider detail" not in result.result_review_feedback


def test_cancelling_during_review_leaves_execution_cancelled_and_review_skipped(tmp_path, monkeypatch):
    from app.executions import coordinator as coordinator_module
    from app.executions.coordinator import ExecutionCoordinator

    database = Database(tmp_path / "review-cancel.sqlite3")
    database.initialize()
    conversation = database.create_conversation("Test", "owner-id")
    repository = ExecutionRepository(database)
    review_started = asyncio.Event()

    class FakeTaskExecutor:
        def __init__(self, *_args, **_kwargs):
            pass

        async def __call__(self, _task):
            return "Report with the requested findings."

    class BlockingReviewer:
        async def review(self, _execution):
            review_started.set()
            await asyncio.Event().wait()

    monkeypatch.setattr(coordinator_module, "AgentTaskExecutor", FakeTaskExecutor)
    coordinator = ExecutionCoordinator(
        repository, None, SimpleNamespace(max_parallel_tasks=2), database, None, None,
        result_reviewer=BlockingReviewer(),
    )

    async def cancel_during_review():
        execution = await coordinator.start("owner-id", conversation.id, ExecutionPlan(
            summary="Prepare a report", tasks=[PlannedTask(id="report", title="Write report")],
        ))
        await asyncio.wait_for(review_started.wait(), timeout=2)
        return await coordinator.cancel("owner-id", execution.id)

    cancelled = asyncio.run(cancel_during_review())

    assert cancelled.status == "cancelled"
    assert cancelled.result_review_status == "skipped"
