from pydantic import BaseModel, ConfigDict, Field


class AgentSkillRead(BaseModel):
    id: str
    user_id: str
    name: str
    description: str
    instructions: str
    enabled: bool
    source: str = "user"
    catalog_id: str | None = None
    catalog_version: int | None = None
    review_status: str = "approved"
    generated_by: str | None = None
    catalog_snapshot: dict[str, str] | None = Field(default=None, exclude=True)
    assigned_profile_ids: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str

    model_config = ConfigDict(extra="forbid")


class SkillCatalogItem(BaseModel):
    id: str
    name: str
    description: str
    instructions: str
    category: str
    tags: list[str]
    version: int
    author: str
    source: str = "Mutual-AId"
    updated_at: str
    installed: bool = False

    model_config = ConfigDict(extra="forbid")


class SkillCatalogComparison(BaseModel):
    local: AgentSkillRead
    catalog: SkillCatalogItem
    customized: bool
    update_available: bool
    available_versions: list[int] = Field(default_factory=list)

    model_config = ConfigDict(extra="forbid")


class SkillUpgradeResult(BaseModel):
    status: str
    skill: AgentSkillRead
    customized: bool
    message: str

    model_config = ConfigDict(extra="forbid")


class SkillCatalogInstall(BaseModel):
    profile_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class GeneratedSkillReview(BaseModel):
    decision: str

    model_config = ConfigDict(extra="forbid")


class SkillUpgradeRequest(BaseModel):
    strategy: str = "keep_customizations"
    target_version: int | None = None

    model_config = ConfigDict(extra="forbid")
