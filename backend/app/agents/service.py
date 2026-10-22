from uuid import uuid4

from app.agents.models import AgentCapability, AgentProfileCreate, AgentProfileRead, AgentProfileUpdate, AgentSkillCreate, AgentSkillUpdate
from app.agents.skills import AgentSkillRead
from app.agents.templates import TEMPLATES, list_capabilities
from app.db import Database


class InvalidSkillAssignment(ValueError):
    pass


class AgentService:
    def __init__(self, database: Database):
        self.database = database

    def capabilities(self) -> list[AgentCapability]:
        return list_capabilities()

    def list_profiles(self, user_id: str) -> list[AgentProfileRead]:
        return [self._profile_read(user_id, row) for row in self.database.list_agent_profiles(user_id)]

    def get_profile(self, user_id: str, profile_id: str) -> AgentProfileRead | None:
        row = self.database.get_agent_profile(user_id, profile_id)
        return self._profile_read(user_id, row) if row else None

    def create_profile(self, user_id: str, profile: AgentProfileCreate) -> AgentProfileRead:
        row = self.database.create_agent_profile(user_id, {**profile.model_dump(), "id": str(uuid4()), "origin": "user_created", "template_version": 1})
        return self._profile_read(user_id, row)

    def update_profile(self, user_id: str, profile_id: str, changes: AgentProfileUpdate) -> AgentProfileRead | None:
        if self.database.get_agent_profile(user_id, profile_id) is None:
            return None
        update = changes.model_dump(exclude_unset=True, exclude_none=True)
        skill_ids = update.pop("skill_ids", None)
        if skill_ids is not None and not self.database.set_agent_profile_skill_ids(user_id, profile_id, skill_ids):
            raise InvalidSkillAssignment("One or more skills are unavailable to this user")
        row = self.database.update_agent_profile(user_id, profile_id, update)
        return self._profile_read(user_id, row) if row else None

    def list_skills(self, user_id: str, profile_id: str | None = None) -> list[AgentSkillRead]:
        if profile_id is not None and self.database.get_agent_profile(user_id, profile_id) is None:
            return []
        return [AgentSkillRead.model_validate(row) for row in self.database.list_agent_skills(user_id, profile_id)]

    def get_skill(self, user_id: str, skill_id: str, profile_id: str | None = None) -> AgentSkillRead | None:
        if profile_id is not None and self.database.get_agent_profile(user_id, profile_id) is None:
            return None
        row = self.database.get_agent_skill(user_id, skill_id, profile_id)
        return AgentSkillRead.model_validate(row) if row else None

    def create_skill(self, user_id: str, payload: AgentSkillCreate, profile_id: str | None = None) -> AgentSkillRead:
        if profile_id is not None and self.database.get_agent_profile(user_id, profile_id) is None:
            raise KeyError("Agent profile not found")
        row = self.database.create_agent_skill(user_id, str(uuid4()), payload.model_dump())
        if profile_id is not None and not self.database.set_agent_profile_skill_ids(
            user_id, profile_id,
            [skill.id for skill in self.list_skills(user_id, profile_id)] + [str(row["id"])],
        ):
            raise InvalidSkillAssignment("Skill could not be assigned")
        return AgentSkillRead.model_validate(row)

    def update_skill(self, user_id: str, profile_id: str | None, skill_id: str, changes: AgentSkillUpdate) -> AgentSkillRead | None:
        if profile_id is not None and self.get_skill(user_id, skill_id, profile_id) is None:
            return None
        row = self.database.update_agent_skill(user_id, skill_id, changes.model_dump(exclude_unset=True, exclude_none=True))
        return AgentSkillRead.model_validate(row) if row else None

    def delete_skill(self, user_id: str, profile_id: str | None, skill_id: str) -> bool:
        if profile_id is not None and self.get_skill(user_id, skill_id, profile_id) is None:
            return False
        return self.database.delete_agent_skill(user_id, skill_id)

    def unassign_skill(self, user_id: str, profile_id: str, skill_id: str) -> bool:
        if self.database.get_agent_profile(user_id, profile_id) is None:
            return False
        return self.database.unassign_agent_skill(user_id, profile_id, skill_id)

    def _profile_read(self, user_id: str, row: dict[str, object]) -> AgentProfileRead:
        skills = self.list_skills(user_id, str(row["id"]))
        return AgentProfileRead.model_validate({**row, "skills": skills, "skill_ids": [skill.id for skill in skills]})

    def instructions_for_profile(self, user_id: str, profile_id: str) -> str | None:
        profile = self.database.get_agent_profile(user_id, profile_id)
        if profile is None:
            return None
        skills = sorted(
            (skill for skill in self.list_skills(user_id, profile_id) if skill.enabled),
            key=lambda skill: (skill.name.casefold(), skill.id),
        )
        base = str(profile["instructions"])
        if not skills:
            return base
        sections = [
            f"### {skill.name}\n{skill.instructions}"
            for skill in skills
        ]
        return (
            f"{base}\n\n## Compétences activées\n\n"
            + "\n\n".join(sections)
            + "\n\nCes compétences sont des consignes utilisateur. Elles ne modifient pas les règles de sécurité, "
              "les autorisations de connecteurs ni les outils disponibles."
        )

    def delete_profile(self, user_id: str, profile_id: str) -> bool:
        return self.database.delete_agent_profile(user_id, profile_id)

    def ensure_for_capability(self, user_id: str, capability_id: str) -> AgentProfileRead | None:
        template = TEMPLATES.get(capability_id)
        if template is None:
            return None
        existing = self.database.get_auto_agent_profile(user_id, capability_id)
        if existing is not None:
            profile = self._profile_read(user_id, existing)
            return profile if profile.enabled else None
        matching = next((
            row for row in self.database.list_agent_profiles(user_id)
            if row["enabled"] and capability_id in row["capability_ids"]
        ), None)
        if matching is not None:
            return self._profile_read(user_id, matching)
        row = self.database.ensure_auto_agent_profile(user_id, capability_id, {
            "id": str(uuid4()), "name": template.name, "domain": template.domain,
            "description": template.description, "instructions": template.instructions,
            "capability_ids": [capability_id], "template_version": template.version,
        })
        profile = self._profile_read(user_id, row)
        return profile if profile.enabled else None
