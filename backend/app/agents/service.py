from uuid import uuid4

from app.agents.models import AgentCapability, AgentProfileCreate, AgentProfileRead, AgentProfileUpdate
from app.agents.templates import TEMPLATES, list_capabilities
from app.db import Database


class AgentService:
    def __init__(self, database: Database):
        self.database = database

    def capabilities(self) -> list[AgentCapability]:
        return list_capabilities()

    def list_profiles(self, user_id: str) -> list[AgentProfileRead]:
        return [AgentProfileRead.model_validate(row) for row in self.database.list_agent_profiles(user_id)]

    def get_profile(self, user_id: str, profile_id: str) -> AgentProfileRead | None:
        row = self.database.get_agent_profile(user_id, profile_id)
        return AgentProfileRead.model_validate(row) if row else None

    def create_profile(self, user_id: str, profile: AgentProfileCreate) -> AgentProfileRead:
        row = self.database.create_agent_profile(user_id, {**profile.model_dump(), "id": str(uuid4()), "origin": "user_created", "template_version": 1})
        return AgentProfileRead.model_validate(row)

    def update_profile(self, user_id: str, profile_id: str, changes: AgentProfileUpdate) -> AgentProfileRead | None:
        row = self.database.update_agent_profile(user_id, profile_id, changes.model_dump(exclude_unset=True, exclude_none=True))
        return AgentProfileRead.model_validate(row) if row else None

    def delete_profile(self, user_id: str, profile_id: str) -> bool:
        return self.database.delete_agent_profile(user_id, profile_id)

    def ensure_for_capability(self, user_id: str, capability_id: str) -> AgentProfileRead | None:
        template = TEMPLATES.get(capability_id)
        if template is None:
            return None
        existing = self.database.get_auto_agent_profile(user_id, capability_id)
        if existing is not None:
            profile = AgentProfileRead.model_validate(existing)
            return profile if profile.enabled else None
        matching = next((
            row for row in self.database.list_agent_profiles(user_id)
            if row["enabled"] and capability_id in row["capability_ids"]
        ), None)
        if matching is not None:
            return AgentProfileRead.model_validate(matching)
        row = self.database.ensure_auto_agent_profile(user_id, capability_id, {
            "id": str(uuid4()), "name": template.name, "domain": template.domain,
            "description": template.description, "instructions": template.instructions,
            "capability_ids": [capability_id], "template_version": template.version,
        })
        profile = AgentProfileRead.model_validate(row)
        return profile if profile.enabled else None
