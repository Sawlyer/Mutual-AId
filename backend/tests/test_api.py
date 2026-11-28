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


def test_connector_request_schemas_accept_more_than_ten_connectors():
    from app.planning.schemas import PlannedTask, PlanningRequest
    from app.schemas import ConnectorPreferencesUpdate, MessageCreate

    connector_ids = [f"mcp:server-{index}" for index in range(11)]

    assert ConnectorPreferencesUpdate(connector_ids=connector_ids).connector_ids == connector_ids
    assert MessageCreate(content="Lire mes données", connector_ids=connector_ids).connector_ids == connector_ids
    assert PlanningRequest(
        user_id="local-user", conversation_id="conversation", message="Analyser mes données",
        enabled_connector_ids=connector_ids,
    ).enabled_connector_ids == connector_ids
    assert PlannedTask(id="read", title="Lire", connector_ids=connector_ids).connector_ids == connector_ids


def test_agent_merge_suggestions_require_explicit_merge_and_keep_source(tmp_path):
    payload = {
        "domain": "wellness",
        "description": "Aide à organiser des habitudes de santé.",
        "instructions": "Propose des habitudes réalistes.",
        "capability_ids": ["wellness_planning"],
    }
    with make_client(tmp_path) as client:
        source = client.post("/api/agents", json={**payload, "name": "Conseiller santé"}).json()
        target = client.post("/api/agents", json={**payload, "name": "Coach habitudes"}).json()
        suggestions = client.get("/api/agents/merge-suggestions").json()

        assert len(suggestions) == 1
        assert {suggestions[0]["source_profile_id"], suggestions[0]["target_profile_id"]} == {source["id"], target["id"]}
        assert client.get(f"/api/agents/{source['id']}").json()["merged_into_id"] is None

        merged = client.post(f"/api/agents/{target['id']}/merge", json={"source_profile_id": source["id"]})
        assert merged.status_code == 200
        assert merged.json()["source"]["enabled"] is False
        assert merged.json()["source"]["merged_into_id"] == target["id"]
        assert merged.json()["target"]["enabled"] is True
        assert client.get(f"/api/agents/{source['id']}").json()["id"] == source["id"]
        assert client.patch(f"/api/agents/{source['id']}", json={"enabled": True}).status_code == 409


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


def test_stream_explains_openai_authentication_failure_safely(tmp_path):
    from app.planning.service import PlanningAuthenticationError

    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()

        class AuthenticationFailingRouter:
            async def route(self, *_args):
                raise PlanningAuthenticationError("private provider diagnostic")

        client.app.state.request_router = AuthenticationFailingRouter()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Planifie ceci"},
        )

    assert response.status_code == 200
    assert "OPENAI_API_KEY" in response.text
    assert "recréez" in response.text.lower()
    assert "private provider diagnostic" not in response.text


def test_write_requests_are_rate_limited(tmp_path):
    with make_client(tmp_path, requests_per_minute=2) as client:
        conversation = client.post("/api/conversations", json={}).json()
        client.patch(f"/api/conversations/{conversation['id']}", json={"title": "Premier"})
        response = client.patch(
            f"/api/conversations/{conversation['id']}",
            json={"title": "Limite"},
        )

    assert response.status_code == 429


def test_cors_rejects_unlisted_origin(tmp_path):
    with make_client(tmp_path) as client:
        response = client.get("/api/health", headers={"Origin": "https://not-allowed.example"})

    assert "access-control-allow-origin" not in response.headers


def test_execution_api_uses_local_workspace_and_replays_events(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask
    database_path = tmp_path / "execution-api.sqlite3"
    from fastapi.testclient import TestClient
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as owner:
        app = owner.app
        conversation = owner.post("/api/conversations", json={}).json()
        user_id = app.state.database.get_local_workspace_user().id
        execution = ExecutionRepository(app.state.database).create(user_id, conversation["id"], ExecutionPlan(summary="Plan", tasks=[PlannedTask(id="one", title="Une tâche")]))
        assert owner.get(f"/api/executions/{execution.id}").status_code == 200
        events = owner.get(f"/api/executions/{execution.id}/events").json()
        assert events[0]["event_type"] == "execution.created"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as other:
        assert other.get(f"/api/executions/{execution.id}").status_code == 200
        assert other.get(f"/api/executions/{execution.id}/events").status_code == 200


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


def test_approval_and_cancellation_api_use_local_workspace(tmp_path):
    from fastapi.testclient import TestClient
    from app.planning.schemas import ExecutionPlan, PlannedTask
    from app.executions.repository import ExecutionRepository
    database_path = tmp_path / "approval-api.sqlite3"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as owner:
        conversation = owner.post("/api/conversations", json={}).json()
        owner_id = owner.app.state.database.get_local_workspace_user().id
        repo = ExecutionRepository(owner.app.state.database)
        execution = repo.create(owner_id, conversation["id"], ExecutionPlan(summary="Écriture", tasks=[PlannedTask(id="write", title="Créer un événement", approval_required=True)]))
        approval_id = execution.tasks[0].approval_id
        response = owner.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"})
        repeated = owner.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"})
        assert response.status_code == repeated.status_code == 200
        assert response.json()["tasks"][0]["status"] == "ready"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as other:
        assert other.post(f"/api/executions/{execution.id}/approvals/{approval_id}", json={"decision": "approve"}).status_code == 200
        assert other.post(f"/api/executions/{execution.id}/cancel").status_code == 200


def test_resume_interrupted_execution_uses_local_workspace(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    with make_client(tmp_path) as owner:
        conversation = owner.post("/api/conversations", json={}).json()
        owner_id = owner.app.state.database.get_local_workspace_user().id
        repository = ExecutionRepository(owner.app.state.database)
        execution = repository.create(owner_id, conversation["id"], ExecutionPlan(
            summary="Reprise", tasks=[PlannedTask(id="safe", title="Tâche sûre")],
        ))
        repository.transition_task(owner_id, execution.id, "safe", "interrupted", "Arrêt du processus")
        repository.set_execution_status(owner_id, execution.id, "interrupted", "Arrêt du processus")

        async def finish_immediately(*_args):
            return None

        owner.app.state.execution_coordinator.run = finish_immediately
        response = owner.post(f"/api/executions/{execution.id}/resume")
        assert response.status_code == 200
        assert response.json()["status"] == "running"

        assert owner.post(f"/api/executions/{execution.id}/resume").status_code == 200


def test_pause_execution_uses_local_workspace_and_is_idempotent(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    with make_client(tmp_path) as owner:
        conversation = owner.post("/api/conversations", json={}).json()
        owner_id = owner.app.state.database.get_local_workspace_user().id
        repository = ExecutionRepository(owner.app.state.database)
        execution = repository.create(owner_id, conversation["id"], ExecutionPlan(
            summary="Pause", tasks=[PlannedTask(id="task", title="Tâche")],
        ))

        paused = owner.post(f"/api/executions/{execution.id}/pause")
        repeated = owner.post(f"/api/executions/{execution.id}/pause")

        assert paused.status_code == repeated.status_code == 200
        assert paused.json()["status"] == repeated.json()["status"] == "paused"

        assert owner.post(f"/api/executions/{execution.id}/pause").status_code == 200


def test_execution_stream_replays_events_and_artifacts_are_downloadable(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        owner_id = client.app.state.database.get_local_workspace_user().id
        repository = ExecutionRepository(client.app.state.database)
        execution = repository.create(
            owner_id,
            conversation["id"],
            ExecutionPlan(summary="Export", tasks=[PlannedTask(id="write", title="Rédiger")]),
        )
        initial_cursor = repository.list_events(owner_id, execution.id)[-1].id
        repository.complete_task(owner_id, execution.id, "write", "Rapport final")
        repository.set_execution_status(owner_id, execution.id, "completed", "Toutes les tâches sont terminées")

        stream = client.get(
            f"/api/executions/{execution.id}/stream",
            headers={"Last-Event-ID": str(initial_cursor)},
        )
        event_history = client.get(f"/api/executions/{execution.id}/events").json()
        listed = client.get(f"/api/executions/{execution.id}/artifacts")

        assert listed.status_code == 200
        assert len(listed.json()) == 1
        artifact_id = listed.json()[0]["id"]
        artifact = client.get(f"/api/executions/{execution.id}/artifacts/{artifact_id}")
        foreign = client.get(f"/api/executions/{execution.id}/artifacts/not-an-artifact")
        with TestClient(main.create_app(Settings(database_path=tmp_path / "test.sqlite3"))) as other:
            foreign_stream = other.get(f"/api/executions/{execution.id}/stream")
            foreign_artifact = other.get(f"/api/executions/{execution.id}/artifacts/{artifact_id}")

    assert stream.status_code == 200
    assert "id:" in stream.text
    assert "event: execution.event" in stream.text
    assert "artifact.created" in stream.text
    assert "event: execution.terminal" in stream.text
    assert "execution.created" not in stream.text
    assert all("agent_id" in event and "status" in event for event in event_history)
    assert event_history[-1]["status"] == "completed"
    assert artifact.status_code == 200
    assert artifact.json()["content"] == "Rapport final"
    assert foreign.status_code == 404
    assert foreign_stream.status_code == 200
    assert foreign_artifact.status_code == 200


def test_cancelled_execution_reconnects_from_last_event_id_without_replaying_cursor(tmp_path):
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    with make_client(tmp_path) as client:
        conversation = client.post("/api/conversations", json={}).json()
        owner_id = client.app.state.database.get_local_workspace_user().id
        repository = ExecutionRepository(client.app.state.database)
        execution = repository.create(
            owner_id,
            conversation["id"],
            ExecutionPlan(summary="Annulation et reprise SSE", tasks=[
                PlannedTask(id="work", title="Traiter la demande"),
            ]),
        )
        initial_cursor = repository.list_events(owner_id, execution.id)[-1].id
        repository.set_execution_status(owner_id, execution.id, "running", "Exécution démarrée")
        repository.transition_task(owner_id, execution.id, "work", "running", "Agent au travail")
        reconnect_cursor = repository.list_events(owner_id, execution.id)[-1].id

        cancelled = client.post(f"/api/executions/{execution.id}/cancel")
        stream = client.get(
            f"/api/executions/{execution.id}/stream?after_id={initial_cursor}",
            headers={"Last-Event-ID": str(reconnect_cursor)},
        )

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert stream.status_code == 200
    assert f"id: {reconnect_cursor}\n" not in stream.text
    assert "event: execution.event" in stream.text
    assert "execution.cancelled" in stream.text
    assert '"status":"cancelled"' in stream.text
    assert "event: execution.terminal" in stream.text


def test_analytics_are_calculated_from_local_workspace_records(tmp_path):
    from fastapi.testclient import TestClient
    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask
    database_path = tmp_path / "analytics.sqlite3"
    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as first:
        owner_id = first.app.state.database.get_local_workspace_user().id
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
        assert second.get("/api/analytics").json()["executions"] == 1


def test_analytics_execution_activity_is_daily_bounded_for_local_workspace(tmp_path):
    from datetime import datetime, timedelta, timezone

    from app.executions.repository import ExecutionRepository
    from app.planning.schemas import ExecutionPlan, PlannedTask

    database_path = tmp_path / "analytics-activity.sqlite3"
    today = datetime.now(timezone.utc).date()
    start_date = today - timedelta(days=13)

    with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as first:
        owner_id = first.app.state.database.get_local_workspace_user().id
        database = first.app.state.database
        repository = ExecutionRepository(database)
        conversation = first.post("/api/conversations", json={}).json()
        recent = repository.create(owner_id, conversation["id"], ExecutionPlan(summary="Recent", tasks=[PlannedTask(id="a", title="A")]))
        old = repository.create(owner_id, conversation["id"], ExecutionPlan(summary="Old", tasks=[PlannedTask(id="b", title="B")]))
        with database.connection() as connection:
            connection.execute("UPDATE executions SET created_at = ? WHERE id = ?", ((today - timedelta(days=1)).isoformat() + "T12:00:00+00:00", recent.id))
            connection.execute("UPDATE executions SET created_at = ? WHERE id = ?", ((today - timedelta(days=20)).isoformat() + "T12:00:00+00:00", old.id))

        with TestClient(main.create_app(Settings(database_path=database_path, openai_api_key="", openai_model=""))) as second:
            other_id = second.app.state.database.get_local_workspace_user().id
            other_conversation = second.post("/api/conversations", json={}).json()
            other_execution = ExecutionRepository(second.app.state.database).create(
                other_id, other_conversation["id"], ExecutionPlan(summary="Other", tasks=[PlannedTask(id="c", title="C")]),
            )
            with second.app.state.database.connection() as connection:
                connection.execute("UPDATE executions SET created_at = ? WHERE id = ?", ((today - timedelta(days=2)).isoformat() + "T12:00:00+00:00", other_execution.id))

        metrics = first.get("/api/analytics").json()

    activity = metrics["execution_activity"]
    assert len(activity) == 14
    assert activity[0]["date"] == start_date.isoformat()
    assert activity[-1]["date"] == today.isoformat()
    assert sum(point["count"] for point in activity) == 2
    assert activity[-2]["count"] == 1
    assert activity[-3]["count"] == 1
