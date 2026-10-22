import asyncio
from collections.abc import AsyncIterator

from fastapi.testclient import TestClient

import app.main as main
from app.config import Settings


def make_client(tmp_path, openai_configured=False, **overrides):
    settings = Settings(
        database_path=tmp_path / "test.sqlite3",
        openai_api_key="test-key" if openai_configured else "",
        openai_model="test-model" if openai_configured else "",
        allowed_origins=["http://localhost:5173"],
        **overrides,
    )
    app = main.create_app(settings=settings)
    class SimpleRouter:
        async def route(self, *_args):
            from app.planning.schemas import PlanningDecision
            return PlanningDecision(summary="Réponse directe", requires_orchestration=False)
    app.state.request_router = SimpleRouter()
    client = TestClient(app)
    app.state.database.initialize()
    response = client.post("/api/auth/register", json={
        "name": "Test user", "email": "test@example.com", "password": "a sufficiently long test password",
    })
    assert response.status_code == 201
    return client


def test_create_list_and_read_conversation(tmp_path):
    with make_client(tmp_path) as client:
        created = client.post("/api/conversations", json={}).json()

        assert created["id"]
        assert created["title"] == "Nouvelle conversation"
        assert client.get("/api/conversations").json()[0]["id"] == created["id"]
        assert client.get(f"/api/conversations/{created['id']}/messages").json() == []
        renamed = client.patch(f"/api/conversations/{created['id']}", json={"title": "Discussion"})
        assert renamed.json()["title"] == "Discussion"
        assert client.delete(f"/api/conversations/{created['id']}").status_code == 204


def test_unknown_conversation_returns_404(tmp_path):
    with make_client(tmp_path) as client:
        response = client.get("/api/conversations/missing/messages")

    assert response.status_code == 404


def test_health_does_not_require_or_expose_an_api_key(tmp_path):
    with make_client(tmp_path) as client:
        health = client.get("/api/health").json()

    assert health["status"] == "ok"
    assert health["openai_configured"] is False
    assert "api_key" not in health


def test_stream_saves_user_and_assistant_messages(tmp_path, monkeypatch):
    async def fake_stream(*_args, **_kwargs) -> AsyncIterator[str]:
        yield "Bonjour "
        yield "depuis le backend."

    monkeypatch.setattr(main, "stream_assistant", fake_stream)
    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour"},
        )

        messages = client.get(f"/api/conversations/{conversation['id']}/messages").json()

    assert response.status_code == 200
    assert "event: delta" in response.text
    assert "event: done" in response.text
    assert "event: plan.ready" not in response.text
    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert messages[-1]["content"] == "Bonjour depuis le backend."


def test_stream_requires_openai_configuration(tmp_path):
    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour"},
        )
        messages = client.get(f"/api/conversations/{conversation['id']}/messages").json()

    assert response.status_code == 503
    assert "OPENAI_API_KEY" not in response.text
    assert [message["role"] for message in messages] == ["user"]


def test_stream_hides_provider_errors_from_client(tmp_path, monkeypatch):
    async def failing_stream(*_args, **_kwargs) -> AsyncIterator[str]:
        raise RuntimeError("PRIVATE_PROVIDER_DIAGNOSTIC")
        yield "unreachable"

    monkeypatch.setattr(main, "stream_assistant", failing_stream)
    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour"},
        )

    assert response.status_code == 200
    assert "event: error" in response.text
    assert "PRIVATE_PROVIDER_DIAGNOSTIC" not in response.text


def test_write_requests_are_rate_limited(tmp_path):
    with make_client(tmp_path, requests_per_minute=2) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.patch(
            f"/api/conversations/{conversation['id']}",
            json={"title": "Limite"},
        )

    assert response.status_code == 429


def test_cors_rejects_unlisted_origin(tmp_path):
    with make_client(tmp_path) as client:
        response = client.get("/api/health", headers={"Origin": "https://not-allowed.example"})

    assert "access-control-allow-origin" not in response.headers


def test_execution_api_is_owner_scoped_and_replays_events(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask
    database_path = tmp_path / "execution-api.sqlite3"
    from fastapi.testclient import TestClient
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as owner:
        app = owner.app
        owner.post("/api/auth/register", json={"name": "Owner", "email": "owner@example.com", "password": "owner password long enough"})
        conversation = owner.post("/api/conversations", json={}).json()
        execution = ExecutionRepository(app.state.database).create(owner.get("/api/auth/me").json()["id"], conversation["id"], ExecutionPlan(summary="Plan", tasks=[PlannedTask(id="one", title="Une tâche")]))
        assert owner.get(f"/api/executions/{execution.id}").status_code == 200
        events = owner.get(f"/api/executions/{execution.id}/events").json()
        assert events[0]["event_type"] == "execution.created"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as other:
        other.post("/api/auth/register", json={"name": "Other", "email": "other@example.com", "password": "other password long enough"})
        assert other.get(f"/api/executions/{execution.id}").status_code == 404
        assert other.get(f"/api/executions/{execution.id}/events").status_code == 404


def test_complex_message_emits_validated_plan_and_persists_execution(tmp_path):
    from app.planning.schemas import ExecutionPlan, PlannedTask, PlanningDecision
    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()
        client.app.state.request_router = type("ComplexRouter", (), {
            "route": lambda _self, *_args: asyncio.sleep(0, result=PlanningDecision(
                summary="Organiser la demande", requires_orchestration=True,
                tasks=[PlannedTask(id="step", title="Première étape")],
            ))
        })()
        client.app.state.execution_coordinator = type("Coordinator", (), {
            "start": lambda _self, user_id, conversation_id, decision: asyncio.sleep(0, result=client.app.state.execution_repository.create(user_id, conversation_id, ExecutionPlan(summary=decision.summary, tasks=decision.tasks)))
        })()
        response = client.post(f"/api/conversations/{conversation['id']}/messages/stream", json={"content": "Fais plusieurs étapes"})
    assert response.status_code == 200
    assert "event: plan.ready" in response.text
    assert "event: execution.created" in response.text
    assert "event: done" in response.text


def test_invalid_plan_is_never_emitted(tmp_path):
    from app.planning.schemas import PlanValidationError
    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()
        class InvalidRouter:
            async def route(self, *_args):
                raise PlanValidationError("cycle")
        client.app.state.request_router = InvalidRouter()
        response = client.post(f"/api/conversations/{conversation['id']}/messages/stream", json={"content": "Fais plusieurs étapes"})
    assert "event: error" in response.text
    assert "event: plan.ready" not in response.text
    assert "cycle" not in response.text


def test_approval_and_cancellation_api_are_owner_scoped(tmp_path):
    from fastapi.testclient import TestClient
    from app.planning.schemas import ExecutionPlan, PlannedTask
    from app.executions.repository import ExecutionRepository
    database_path = tmp_path / "approval-api.sqlite3"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as owner:
        owner.post("/api/auth/register", json={"name": "Owner", "email": "owner@example.com", "password": "owner password long enough"})
        conversation = owner.post("/api/conversations", json={}).json()
        owner_id = owner.get("/api/auth/me").json()["id"]
        repo = ExecutionRepository(owner.app.state.database)
        execution = repo.create(owner_id, conversation["id"], ExecutionPlan(summary="Écriture", tasks=[PlannedTask(id="write", title="Créer un événement", approval_required=True)]))
        approval_id = execution.tasks[0].approval_id
        response = owner.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"})
        repeated = owner.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"})
        assert response.status_code == repeated.status_code == 200
        assert response.json()["tasks"][0]["status"] == "ready"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as other:
        other.post("/api/auth/register", json={"name": "Other", "email": "other@example.com", "password": "other password long enough"})
        assert other.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"}).status_code == 404
        assert other.post(f"/api/executions/{execution.id}/cancel").status_code == 404


def test_analytics_are_calculated_from_owner_scoped_records(tmp_path):
    from fastapi.testclient import TestClient
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask
    database_path = tmp_path / "analytics.sqlite3"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as first:
        first.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": "account a test password"})
        owner_id = first.get("/api/auth/me").json()["id"]
        conversation = first.post("/api/conversations", json={}).json()
        execution = ExecutionRepository(first.app.state.database).create(owner_id, conversation["id"], ExecutionPlan(summary="Test", tasks=[PlannedTask(id="a", title="One"), PlannedTask(id="b", title="Two")]))
        ExecutionRepository(first.app.state.database).complete_task(owner_id, execution.id, "a", "done")
        metrics = first.get("/api/analytics").json()
        assert metrics["conversations"] == 1
        assert metrics["executions"] == 1
        assert metrics["tasks"] == 2
        assert metrics["completed_tasks"] == 1
        assert metrics["task_completion_percent"] == 50
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as second:
        second.post("/api/auth/register", json={"name": "B", "email": "b@example.com", "password": "account b test password"})
        assert second.get("/api/analytics").json()["executions"] == 0
