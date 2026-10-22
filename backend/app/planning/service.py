import logging
from collections.abc import Sequence

from agents import Agent, RunConfig, Runner

from app.agents.models import AgentProfileRead
from app.config import Settings
from app.connectors.registry import Connector
from app.planning.schemas import ExecutionPlan, PlanningDecision, PlanningRequest, PlanValidationError, PlannedTask, validate_dag

logger = logging.getLogger(__name__)

PLANNER_INSTRUCTIONS = """You are Mutual-AId's task planner. Decide whether the user's request needs multiple concrete steps.
Return a concise user-facing summary and, only for complex work, a small task DAG with stable IDs, dependency IDs,
capability IDs, and connector IDs. Use only capability IDs and connector IDs listed in the input. Never invent
profiles, tools, OAuth scopes, connector access, or completed actions. You have no tools and must not attempt
external actions. Use approval_required for any proposed external write. For simple requests set
requires_orchestration=false and return no tasks. Ask a concise clarification when the goal is materially ambiguous.
For wellness topics, organize general habits only: no diagnosis or treatment recommendations. Never include hidden
reasoning; return only the structured plan fields."""


class PlanningUnavailable(RuntimeError):
    """Safe user-facing planning failure; provider diagnostics are logged by the caller."""


class Planner:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def plan(
        self,
        request: PlanningRequest,
        profiles: Sequence[AgentProfileRead],
        connector_catalog: Sequence[Connector],
    ) -> PlanningDecision:
        if not self.settings.openai_configured:
            raise PlanningUnavailable("Planning is unavailable")
        profile_summary = [
            {"id": profile.id, "name": profile.name, "capability_ids": profile.capability_ids}
            for profile in profiles if profile.enabled
        ]
        connector_ids = sorted(set(request.enabled_connector_ids) & {
            connector.id for connector in connector_catalog if connector.availability == "available"
        })
        capability_ids = ["wellness_planning", "schedule_planning"]
        input_text = (
            f"User request:\n{request.message}\n\n"
            f"Known profiles:\n{profile_summary}\n\n"
            f"Allowed capability IDs: {capability_ids}\n"
            f"Enabled and available connector IDs: {connector_ids}\n"
            "Return a plan with at most 12 tasks."
        )
        try:
            agent = Agent(
                name="Mutual-AId Planner", instructions=PLANNER_INSTRUCTIONS,
                model=self.settings.openai_model.strip(), output_type=PlanningDecision, tools=[],
            )
            result = await Runner.run(
                agent, input_text, max_turns=1,
                run_config=RunConfig(tracing_disabled=True),
            )
            decision = result.final_output
            if not isinstance(decision, PlanningDecision):
                raise PlanValidationError("Planner returned an invalid structured result")
            validate_dag(decision.tasks)
            if decision.requires_orchestration and not decision.tasks:
                raise PlanValidationError("Complex plans must contain tasks")
            if not decision.requires_orchestration and decision.tasks:
                raise PlanValidationError("Simple requests cannot create tasks")
            allowed_capabilities = set(capability_ids)
            allowed_connectors = set(connector_ids)
            for task in decision.tasks:
                if not set(task.capability_ids).issubset(allowed_capabilities):
                    raise PlanValidationError("unknown capability")
                if not set(task.connector_ids).issubset(allowed_connectors):
                    raise PlanValidationError("connector is not enabled or available")
            return decision
        except PlanningUnavailable:
            raise
        except Exception as error:
            logger.warning("Planning failed for conversation %s (%s)", request.conversation_id, type(error).__name__)
            raise PlanningUnavailable("Planning could not be completed") from error


class _PlannerPort:
    async def plan(self, *_args, **_kwargs):
        raise NotImplementedError
