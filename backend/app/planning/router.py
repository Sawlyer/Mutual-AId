from collections.abc import Sequence

from app.agents.models import AgentProfileRead
from app.agents.service import AgentService
from app.connectors.registry import Connector
from app.planning.schemas import PlanningDecision, PlanningRequest, PlanValidationError, validate_dag


class RequestRouter:
    def __init__(self, planner, agent_service: AgentService):
        self.planner = planner
        self.agent_service = agent_service

    async def requires_orchestration(self, message: str, request: PlanningRequest, profiles, connectors) -> bool:
        decision = await self.planner.plan(request.model_copy(update={"message": message}), profiles, connectors)
        return decision.requires_orchestration

    async def route(
        self,
        request: PlanningRequest,
        profiles: Sequence[AgentProfileRead],
        connector_catalog: Sequence[Connector],
    ) -> PlanningDecision:
        decision = await self.planner.plan(request, profiles, connector_catalog)
        if not decision.requires_orchestration:
            return decision
        validate_dag(decision.tasks)
        available_connectors = set(request.enabled_connector_ids) & {
            connector.id for connector in connector_catalog if connector.availability == "available"
        }
        known_capabilities = {item.id for item in self.agent_service.capabilities()}
        capability_labels = {item.id: item.label for item in self.agent_service.capabilities()}
        updated_tasks = []
        profiles_by_id = {profile.id: profile for profile in profiles if profile.enabled}
        for task in decision.tasks:
            if not set(task.connector_ids).issubset(available_connectors):
                raise PlanValidationError("connector is not enabled or available")
            if not set(task.capability_ids).issubset(known_capabilities):
                raise PlanValidationError("unknown capability")
            if task.agent_profile_id:
                profile = profiles_by_id.get(task.agent_profile_id)
                if profile is None:
                    raise PlanValidationError("unknown or disabled agent profile")
                reason = (
                    f"Profil réutilisé : {profile.name} correspond aux compétences et à la description de la tâche."
                )
                task = task.model_copy(update={"agent_assignment_reason": reason})
            elif task.capability_ids:
                profile = None
                selected_capability = None
                reused = False
                for capability_id in task.capability_ids:
                    existing = any(
                        candidate.enabled and capability_id in candidate.capability_ids
                        for candidate in profiles
                    )
                    profile = self.agent_service.ensure_for_capability(request.user_id, capability_id)
                    if profile is not None:
                        selected_capability = capability_id
                        reused = existing
                        break
                if profile is None:
                    raise PlanValidationError("no enabled profile for the requested capability")
                label = capability_labels.get(selected_capability or "", selected_capability or "cette tâche")
                reason = (
                    f"Profil réutilisé : {profile.name} couvre {label}."
                    if reused else f"Profil créé automatiquement : aucun agent actif ne couvrait {label}."
                )
                task = task.model_copy(update={
                    "agent_profile_id": profile.id,
                    "agent_assignment_reason": reason,
                })
                profiles_by_id[profile.id] = profile
            updated_tasks.append(task)
        return decision.model_copy(update={"tasks": updated_tasks})
