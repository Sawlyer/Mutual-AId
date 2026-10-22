from typing import Literal

from pydantic import BaseModel, ConfigDict

ExecutionStatus = Literal["planning", "running", "awaiting_approval", "completed", "partial", "failed", "cancelled", "interrupted"]
TaskStatus = Literal["pending", "ready", "running", "awaiting_approval", "validating", "completed", "failed", "blocked", "paused", "interrupted", "cancelled"]


class TaskRead(BaseModel):
    id: str
    title: str
    description: str
    dependencies: list[str]
    capability_ids: list[str]
    agent_profile_id: str | None
    agent_profile_snapshot: dict[str, object] | None = None
    approval_id: str | None = None
    connector_ids: list[str]
    expected_output: str
    approval_required: bool
    status: TaskStatus
    result: str | None = None
    error: str | None = None

    model_config = ConfigDict(frozen=True)


class ExecutionRead(BaseModel):
    id: str
    conversation_id: str
    status: ExecutionStatus
    summary: str
    tasks: list[TaskRead]
    created_at: str
    updated_at: str

    model_config = ConfigDict(frozen=True)


class ExecutionEventRead(BaseModel):
    id: int
    task_id: str | None
    event_type: str
    message: str
    created_at: str

    model_config = ConfigDict(frozen=True)
