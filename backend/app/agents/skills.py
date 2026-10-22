from pydantic import BaseModel, ConfigDict


class AgentSkillRead(BaseModel):
    id: str
    user_id: str
    name: str
    description: str
    instructions: str
    enabled: bool
    created_at: str
    updated_at: str

    model_config = ConfigDict(extra="forbid")
