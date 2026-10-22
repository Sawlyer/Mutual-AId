from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.agents.models import AgentCapability, AgentProfileCreate, AgentProfileRead, AgentProfileUpdate


class AgentCatalogRead(BaseModel):
    profiles: list[AgentProfileRead]
    capabilities: list[AgentCapability]


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]


class AnalyticsRead(BaseModel):
    conversations: int
    executions: int
    active_executions: int
    tasks: int
    completed_tasks: int
    task_completion_percent: int
    execution_statuses: dict[str, int]
    task_statuses: dict[str, int]


class AuthRegister(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name is required")
        return value

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        local, separator, domain = value.partition("@")
        if not separator or not local or "." not in domain or any(char.isspace() for char in value):
            raise ValueError("A valid email address is required")
        return value


class AuthLogin(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        local, separator, domain = value.partition("@")
        if not separator or not local or "." not in domain or any(char.isspace() for char in value):
            raise ValueError("A valid email address is required")
        return value


class AuthUserRead(BaseModel):
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
    content: str = Field(min_length=1, max_length=12_000)
    connector_ids: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("connector_ids")
    @classmethod
    def unique_connector_ids(cls, connector_ids: list[str]) -> list[str]:
        if len(set(connector_ids)) != len(connector_ids):
            raise ValueError("connector_ids must not contain duplicates")
        return connector_ids


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
    availability: Literal["available", "coming_soon"]


class ConnectorPreferencesUpdate(BaseModel):
    connector_ids: list[str] = Field(default_factory=list, max_length=5)

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


class MessageRead(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime
    execution_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class HealthRead(BaseModel):
    status: Literal["ok"] = "ok"
    openai_configured: bool
    model_configured: bool
