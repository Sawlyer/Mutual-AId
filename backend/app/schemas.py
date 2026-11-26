from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.connectors.limits import MAX_CONVERSATION_CONNECTORS
from app.agents.models import AgentCapability, AgentProfileCreate, AgentProfileRead, AgentProfileUpdate


class AgentCatalogRead(BaseModel):
    profiles: list[AgentProfileRead]
    capabilities: list[AgentCapability]


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]


class AnalyticsTokenUsageRead(BaseModel):
    runs: int
    requests: int
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    reasoning_tokens: int
    input_cost_usd: float | None
    cached_input_cost_usd: float | None
    output_cost_usd: float | None
    estimated_cost_usd: float | None
    unpriced_runs: int


class ConversationTokenUsageRead(AnalyticsTokenUsageRead):
    conversation_id: str
    title: str
    updated_at: datetime
    message_count: int
    models: list[str]


class AnalyticsRead(BaseModel):
    conversations: int
    executions: int
    active_executions: int
    tasks: int
    completed_tasks: int
    task_completion_percent: int
    execution_statuses: dict[str, int]
    task_statuses: dict[str, int]
    execution_activity: list["AnalyticsExecutionActivityRead"]
    token_usage: AnalyticsTokenUsageRead
    conversation_usage: list[ConversationTokenUsageRead]


class AnalyticsExecutionActivityRead(BaseModel):
    date: date
    count: int = Field(ge=0)


class WorkspaceIdentity(BaseModel):
    id: str
    email: str
    name: str
    created_at: datetime


class ConversationCreate(BaseModel):
    title: str = Field(default="Nouvelle conversation", min_length=1, max_length=160)


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class ConversationRead(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    message_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=12_000)
    connector_ids: list[str] = Field(default_factory=list, max_length=MAX_CONVERSATION_CONNECTORS)
    use_connected_tools: bool = False
    resume_with_tools: bool = False
    decline_mcp_suggestions: bool = False

    @field_validator("connector_ids")
    @classmethod
    def unique_connector_ids(cls, connector_ids: list[str]) -> list[str]:
        if len(set(connector_ids)) != len(connector_ids):
            raise ValueError("connector_ids must not contain duplicates")
        return connector_ids

    @model_validator(mode="after")
    def content_required_for_a_new_turn(self) -> "MessageCreate":
        if self.resume_with_tools and self.decline_mcp_suggestions:
            raise ValueError("resume_with_tools and decline_mcp_suggestions cannot both be set")
        continuing = self.resume_with_tools or self.decline_mcp_suggestions
        if not continuing and not self.content.strip():
            raise ValueError("content is required")
        return self


class ConnectorPermissionRead(BaseModel):
    id: str
    label: str
    description: str
    access: Literal["read", "write"]
    oauth_scope: str | None = None


class ConnectorToolRead(BaseModel):
    name: str
    description: str
    access: Literal["read", "write"]
    required_scopes: list[str]
    requires_human_approval: bool


class ConnectorRead(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    capabilities: list[str]
    available_tools: list[ConnectorToolRead]
    required_scopes: list[ConnectorPermissionRead]
    status: Literal["connected", "disconnected", "error"]
    availability: Literal["available", "setup_required"]


class ConnectorPreferencesUpdate(BaseModel):
    connector_ids: list[str] = Field(default_factory=list, max_length=MAX_CONVERSATION_CONNECTORS)

    @field_validator("connector_ids")
    @classmethod
    def unique_connector_ids(cls, connector_ids: list[str]) -> list[str]:
        if len(set(connector_ids)) != len(connector_ids):
            raise ValueError("connector_ids must not contain duplicates")
        return connector_ids


class ConnectorPreferencesRead(BaseModel):
    conversation_id: str
    connector_ids: list[str]
    connectors: list[ConnectorRead]


class McpActivityRead(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    server: str = Field(min_length=1, max_length=80)
    tool: str = Field(min_length=1, max_length=80)
    status: Literal["running", "done", "failed"]


class MessageRead(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    execution_id: str | None = None
    mcp_activity: list[McpActivityRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class HealthRead(BaseModel):
    status: Literal["ok"] = "ok"
    openai_configured: bool
    model_configured: bool
