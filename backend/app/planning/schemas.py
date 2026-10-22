from collections import deque

from pydantic import BaseModel, ConfigDict, Field, field_validator


class PlanValidationError(ValueError):
    pass


class PlanningRequest(BaseModel):
    user_id: str
    conversation_id: str
    message: str = Field(min_length=1, max_length=12_000)
    enabled_connector_ids: list[str] = Field(default_factory=list, max_length=5)

    model_config = ConfigDict(frozen=True, extra="forbid")


class PlannedTask(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    dependencies: list[str] = Field(default_factory=list, max_length=30)
    capability_ids: list[str] = Field(default_factory=list, max_length=10)
    agent_profile_id: str | None = None
    connector_ids: list[str] = Field(default_factory=list, max_length=5)
    expected_output: str = Field(default="", max_length=500)
    approval_required: bool = False

    model_config = ConfigDict(frozen=True, extra="forbid")

    @field_validator("dependencies", "capability_ids", "connector_ids")
    @classmethod
    def require_unique_values(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("Values must be unique")
        return values


class ExecutionPlan(BaseModel):
    summary: str = Field(min_length=1, max_length=1000)
    tasks: list[PlannedTask] = Field(default_factory=list, max_length=30)
    clarification: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(frozen=True, extra="forbid")


class PlanningDecision(ExecutionPlan):
    requires_orchestration: bool

    model_config = ConfigDict(frozen=True, extra="forbid")


def validate_dag(tasks: list[PlannedTask]) -> None:
    ids = [task.id for task in tasks]
    if len(ids) != len(set(ids)):
        raise PlanValidationError("duplicate task id")
    known = set(ids)
    indegree = {task.id: 0 for task in tasks}
    dependents: dict[str, list[str]] = {task.id: [] for task in tasks}
    for task in tasks:
        for dependency in task.dependencies:
            if dependency not in known:
                raise PlanValidationError(f"unknown dependency: {dependency}")
            if dependency == task.id:
                raise PlanValidationError(f"cycle: {task.id} depends on itself")
            indegree[task.id] += 1
            dependents[dependency].append(task.id)
    ready = deque(task_id for task_id, degree in indegree.items() if degree == 0)
    visited = 0
    while ready:
        task_id = ready.popleft()
        visited += 1
        for dependent in dependents[task_id]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                ready.append(dependent)
    if visited != len(tasks):
        raise PlanValidationError("cycle detected in task dependencies")
