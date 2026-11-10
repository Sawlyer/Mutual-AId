import asyncio
from types import SimpleNamespace

from agents.tool import ToolOrigin, ToolOriginType
from fastapi.testclient import TestClient

import app.agent as agent_module
import app.main as main
from app.agent import McpActivity, McpActivityTracker
from app.config import Settings
from app.db import Database
from tests.test_api import make_client

SECRET = "PRIVATE_REASONING_AND_TOOL_OUTPUT"


def mcp_call(name, call_id, origin, title=None, arguments=None):
    return SimpleNamespace(
        type="run_item_stream_event",
        name=name,
        item=SimpleNamespace(
            tool_origin=origin,
            tool_name="mcp_mcp_docs__search",
            title=title,
            call_id=call_id,
            raw_item={"arguments": arguments or {"query": SECRET}},
            output=SECRET,
            custom_data={"failed": False, "output": SECRET},
        ),
    )


def test_tracker_publishes_mcp_names_and_drops_private_payloads():
    tracker = McpActivityTracker({"mcp_docs": "Documentation"})
    secret_event = mcp_call(
        "tool_called", "call_1",
        ToolOrigin(type=ToolOriginType.MCP, mcp_server_name="mcp_docs"),
    )
    started = tracker.observe(secret_event)
    assert started == [McpActivity("call_1", "Documentation", "search", "running")]
    assert SECRET not in repr(started)

    mail = mcp_call("tool_called", "call_mail", ToolOrigin(type=ToolOriginType.FUNCTION))
    assert tracker.observe(mail) == []

    failed = mcp_call("tool_output", "call_1", ToolOrigin(type=ToolOriginType.MCP, mcp_server_name="mcp_docs"))
    failed.item.custom_data = {"failed": True, "output": SECRET}
    assert tracker.observe(failed) == [McpActivity("call_1", "Documentation", "search", "failed")]
    assert tracker.finish() == []
    assert SECRET not in repr(tracker.observe(failed))


def test_unknown_server_key_is_not_shown():
    tracker = McpActivityTracker({})
    started = tracker.observe(mcp_call(
        "tool_called", "call_9", ToolOrigin(type=ToolOriginType.MCP, mcp_server_name="mcp_docs"),
    ))
    assert started == [McpActivity("call_9", "Serveur MCP", "search", "running")]
    assert "mcp_docs" not in repr(started)


def test_assistant_stream_reports_mcp_use_without_private_events(tmp_path, monkeypatch):
    database_path = tmp_path / "agent-mcp.sqlite3"
    Database(database_path).initialize()
    settings = Settings(database_path=database_path, openai_api_key="test-key", openai_model="test-model")
    events = [
        SimpleNamespace(type="raw_response_event", data=SimpleNamespace(type="response.reasoning_summary_text.delta", delta=SECRET)),
        mcp_call("tool_called", "call_safe", ToolOrigin(type=ToolOriginType.MCP, mcp_server_name="mcp_docs")),
        mcp_call("tool_called", "call_mail", ToolOrigin(type=ToolOriginType.FUNCTION)),
        SimpleNamespace(type="raw_response_event", data=SimpleNamespace(type="response.output_text.delta", delta="Résultat.")),
        mcp_call("tool_output", "call_safe", ToolOrigin(type=ToolOriginType.MCP, mcp_server_name="mcp_docs")),
    ]

    class FakeResult:
        def cancel(self):
            return None

        async def stream_events(self):
            for event in events:
                yield event

    monkeypatch.setattr(agent_module, "build_assistant", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(agent_module.Runner, "run_streamed", lambda *_args, **_kwargs: FakeResult())

    async def collect():
        return [item async for item in agent_module.stream_assistant(
            "conversation-test", "Cherche", settings,
            mcp_servers=[SimpleNamespace(name="mcp_docs", mcp_server_key="mcp_docs", mcp_label="Documentation")],
        )]

    items = asyncio.run(collect())
    assert items == [
        McpActivity("call_safe", "Documentation", "search", "running"),
        "Résultat.",
        McpActivity("call_safe", "Documentation", "search", "done"),
    ]
    assert SECRET not in repr(items)


def test_stream_persists_mcp_activity_for_the_owner_only(tmp_path, monkeypatch):
    async def fake_stream(*_args, **_kwargs):
        yield McpActivity("call_1", "Documentation", "search", "running")
        yield "Voici "
        yield McpActivity("call_1", "Documentation", "search", "done")
        yield "le résultat."

    monkeypatch.setattr(main, "stream_assistant", fake_stream)
    with make_client(tmp_path, openai_configured=True) as client:
        conversation = client.post("/api/conversations", json={}).json()
        response = client.post(
            f"/api/conversations/{conversation['id']}/messages/stream",
            json={"content": "Bonjour"},
        )
        messages = client.get(f"/api/conversations/{conversation['id']}/messages").json()
        with TestClient(client.app) as other:
            assert other.post("/api/auth/register", json={
                "name": "Autre", "email": "other@example.com", "password": "a sufficiently long test password",
            }).status_code == 201
            hidden = other.get(f"/api/conversations/{conversation['id']}/messages")

    assert response.status_code == 200
    assert 'event: mcp.activity\ndata: {"id":"call_1","server":"Documentation","tool":"search","status":"running"}' in response.text
    assert 'event: mcp.activity\ndata: {"id":"call_1","server":"Documentation","tool":"search","status":"done"}' in response.text
    assert "arguments" not in response.text
    assert SECRET not in response.text
    assert messages[0]["mcp_activity"] == []
    assert messages[1]["mcp_activity"] == [{"id": "call_1", "server": "Documentation", "tool": "search", "status": "done"}]
    assert messages[1]["content"] == "Voici le résultat."
    assert hidden.status_code == 404
