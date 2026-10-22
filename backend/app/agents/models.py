from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

from app.agents.skills import AgentSkillRead


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
    skill_ids: list[str] = Field(default_factory=list)
    skills: list[AgentSkillRead] = Field(default_factory=list)

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
    skill_ids: list[str] | None = Field(default=None, max_length=20)

    model_config = ConfigDict(extra="forbid")


class AgentSkillCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    instructions: str = Field(min_length=1, max_length=4000)
    enabled: bool = True

    @field_validator("name", "description", "instructions")
    @classmethod
    def trim_text(cls, value: str, info: ValidationInfo) -> str:
        value = value.strip()
        if "\x00" in value:
            raise ValueError("Text cannot contain NUL characters")
        if not value and info.field_name in {"name", "instructions"}:
            raise ValueError("This field cannot be blank")
        return value

    model_config = ConfigDict(extra="forbid")


class AgentSkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=300)
    instructions: str | None = Field(default=None, min_length=1, max_length=4000)
    enabled: bool | None = None

    @field_validator("name", "description", "instructions")
    @classmethod
    def trim_optional_text(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if "\x00" in value:
            raise ValueError("Text cannot contain NUL characters")
        if not value and info.field_name in {"name", "instructions"}:
            raise ValueError("This field cannot be blank")
        return value

    model_config = ConfigDict(extra="forbid")
