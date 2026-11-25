import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from app.config import Settings
from app.executions.coordinator import AgentTaskExecutor
from app.executions.models import ExecutionRead, TaskRead


def test_agent_task_executor_passes_empty_mcp_config_when_no_servers(monkeypatch):
    from app.executions import coordinator as coordinator_module

    captured = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            if kwargs.get("mcp_config") is None:
                raise TypeError("Agent mcp_config must be a dict, got NoneType")
            captured["agent"] = kwargs

    class FakeRunner:
        @staticmethod
        async def run(*_args, **_kwargs):
            return SimpleNamespace(final_output="Task result")

    class EmptyMcpRuntime:
        @asynccontextmanager
        async def open_approved_servers(self, *_args, **_kwargs):
            yield []

    class Repository:
        @staticmethod
        def get(*_args):
            return ExecutionRead(
                id="execution-1", conversation_id="conversation-1", status="running",
                summary="Complete task", tasks=[], created_at="now", updated_at="now",
            )

    class ToolRegistry:
        @staticmethod
        def tools_for_user(*_args):
            return []

    monkeypatch.setattr(coordinator_module, "Agent", FakeAgent)
    monkeypatch.setattr(coordinator_module, "Runner", FakeRunner)
    task = TaskRead(
        id="task-1", title="Write summary", description="Summarize the request", dependencies=[],
        capability_ids=[], agent_profile_id=None, connector_ids=[], expected_output="A short summary",
        approval_required=False, status="running", attempts=1,
    )
    executor = AgentTaskExecutor(
        Settings(_env_file=None, openai_api_key="test-key", openai_model="test-model"),
        Repository(), "user-1", "execution-1", None, ToolRegistry(), None,
        mcp_runtime=EmptyMcpRuntime(),
    )

    result = asyncio.run(executor(task))

    assert result == "Task result"
    assert captured["agent"]["mcp_servers"] == []
    assert captured["agent"]["mcp_config"] == {}
