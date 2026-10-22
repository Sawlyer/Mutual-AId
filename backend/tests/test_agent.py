import asyncio

from agents import Agent
from agents.extensions.memory import AsyncSQLiteSession
from agents.testing import ScriptedModel, assistant_message

import app.agent as agent_module
from app.config import Settings
from app.db import Database


def test_assistant_stream_uses_runner_and_persists_sdk_session(tmp_path, monkeypatch):
    database_path = tmp_path / "agent.sqlite3"
    Database(database_path).initialize()
    settings = Settings(database_path=database_path, openai_api_key="test-key", openai_model="test-model")
    model = ScriptedModel([[assistant_message("Réponse en flux réel du SDK.")]])
    monkeypatch.setattr(
        agent_module,
        "build_assistant",
        lambda _settings: Agent(name="Assistant", model=model, instructions="Réponds clairement."),
    )

    async def run_stream():
        return [chunk async for chunk in agent_module.stream_assistant("conversation-test", "Bonjour", settings)]

    chunks = asyncio.run(run_stream())
    session = AsyncSQLiteSession("conversation-test", db_path=str(database_path))
    items = asyncio.run(session.get_items())
    asyncio.run(session.close())

    assert "".join(chunks) == "Réponse en flux réel du SDK."
    assert [item["role"] for item in items if item["role"] in {"user", "assistant"}] == ["user", "assistant"]
    model.assert_complete()
