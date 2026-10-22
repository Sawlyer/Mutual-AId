from pydantic import BaseModel, ConfigDict, Field


class AgentCapability(BaseModel):
    id: str
    label: str
    template_id: str


class AgentProfileRead(BaseModel):
    id: str
    user_id: str
    name: str
    domain: str
    description: str
    instructions: str
    capability_ids: list[str]
    enabled: bool
    origin: str
    template_version: int
    created_at: str
    updated_at: str

    model_config = ConfigDict(extra="forbid")


class AgentProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    domain: str = Field(min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    description: str = Field(min_length=1, max_length=500)
    instructions: str = Field(min_length=1, max_length=4000)
    capability_ids: list[str] = Field(default_factory=list, max_length=10)
    enabled: bool = True

    model_config = ConfigDict(extra="forbid")


class AgentProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    domain: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[a-z][a-z0-9_-]*$")
    description: str | None = Field(default=None, min_length=1, max_length=500)
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    capability_ids: list[str] | None = Field(default=None, max_length=10)
    enabled: bool | None = None

    model_config = ConfigDict(extra="forbid")
