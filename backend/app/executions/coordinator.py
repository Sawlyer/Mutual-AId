import asyncio
import logging

from agents import Agent, RunConfig, Runner

from app.agents.service import AgentService
from app.config import Settings
from app.connectors.google_calendar import CalendarToolContext
from app.connectors.google_oauth import GoogleOAuthClient
from app.connectors.tools import ConnectorAuthorizationError, ToolRegistry
from app.db import Database
from app.executions.models import ExecutionRead, TaskRead
from app.executions.repository import ExecutionRepository
from app.planning.schemas import ExecutionPlan

logger = logging.getLogger(__name__)


class AgentTaskExecutor:
    """Run isolated agent tasks without granting arbitrary executable tools."""

    def __init__(self, settings: Settings, repository: ExecutionRepository, user_id: str, execution_id: str,
                 database: Database, tool_registry: ToolRegistry, google_oauth: GoogleOAuthClient | None):
        self.settings = settings
        self.repository = repository
        self.user_id = user_id
        self.execution_id = execution_id
        self.database = database
        self.tool_registry = tool_registry
        self.google_oauth = google_oauth

    async def __call__(self, task: TaskRead) -> str:
        if not self.settings.openai_configured:
            raise RuntimeError("AI provider unavailable")
        snapshot = task.agent_profile_snapshot or {}
        instructions = str(snapshot.get("instructions") or "Complete the assigned task carefully using only supplied information.")
        execution = self.repository.get(self.user_id, self.execution_id)
        dependency_results = {
            candidate.id: candidate.result for candidate in (execution.tasks if execution else [])
            if candidate.id in task.dependencies and candidate.result
        }
        try:
            tools = self.tool_registry.tools_for_user(self.user_id, task.connector_ids, self.database)
        except ConnectorAuthorizationError as error:
            raise RuntimeError("A required connector is no longer authorized") from error
        if task.connector_ids and self.google_oauth is None:
            raise RuntimeError("Connector provider is unavailable")
        context = CalendarToolContext(self.user_id, self.database, self.google_oauth) if task.connector_ids else None
        agent = Agent(
            name=str(snapshot.get("name") or "Assistant"), instructions=instructions,
            model=self.settings.openai_model.strip(), tools=tools,
        )
        prompt = (
            f"Task: {task.title}\nDescription: {task.description}\nExpected output: {task.expected_output}\n"
            f"Completed dependency outputs: {dependency_results}\n"
            "Return the requested user-facing result. Report only information returned by authorized tools."
        )
        result = await Runner.run(agent, prompt, context=context, max_turns=self.settings.max_agent_turns,
                                  run_config=RunConfig(tracing_disabled=True))
        output = result.final_output
        if not isinstance(output, str) or not output.strip():
            raise RuntimeError("Task returned no user-facing result")
        return output.strip()


class ExecutionCoordinator:
    def __init__(self, repository: ExecutionRepository, agent_service: AgentService, settings: Settings,
                 database: Database, tool_registry: ToolRegistry, google_oauth: GoogleOAuthClient | None):
        self.repository = repository
        self.agent_service = agent_service
        self.settings = settings
        self.database = database
        self.tool_registry = tool_registry
        self.google_oauth = google_oauth
        self._background: dict[str, asyncio.Task[None]] = {}
        self._cancel: dict[str, asyncio.Event] = {}
        self._user_semaphores: dict[str, asyncio.Semaphore] = {}

    async def start(self, user_id: str, conversation_id: str, plan: ExecutionPlan) -> ExecutionRead:
        profile_ids = {task.agent_profile_id for task in plan.tasks if task.agent_profile_id}
        snapshots = {
            profile_id: profile.model_dump(mode="json")
            for profile_id in profile_ids
            if (profile := self.agent_service.get_profile(user_id, profile_id)) is not None and profile.enabled
        }
        if len(snapshots) != len(profile_ids):
            raise PermissionError("An assigned agent profile is unavailable")
        execution = self.repository.create(user_id, conversation_id, plan, snapshots)
        cancel_event = asyncio.Event()
        self._cancel[execution.id] = cancel_event
        self._background[execution.id] = asyncio.create_task(self.run(user_id, execution.id, cancel_event))
        return execution

    async def run(self, user_id: str, execution_id: str, cancel_event: asyncio.Event | None = None) -> None:
        from app.executions.scheduler import DagScheduler

        execution = self.repository.get(user_id, execution_id)
        if execution is None:
            return
        handler = AgentTaskExecutor(self.settings, self.repository, user_id, execution_id,
                                    self.database, self.tool_registry, self.google_oauth)
        user_semaphore = self._user_semaphores.setdefault(user_id, asyncio.Semaphore(self.settings.max_parallel_tasks))

        async def execute_with_user_limit(task: TaskRead) -> str:
            async with user_semaphore:
                return await handler(task)

        scheduler = DagScheduler(self.repository, execute_with_user_limit, user_id, execution_id,
                                 max_concurrency=self.settings.max_parallel_tasks, cancel_event=cancel_event)
        try:
            await scheduler.run()
        except asyncio.CancelledError:
            self.repository.set_execution_status(user_id, execution_id, "cancelled", "Exécution annulée")
            self._persist_final_answer(user_id, execution_id)
            raise
        except Exception:
            logger.exception("Execution failed for %s", execution_id)
            self.repository.set_execution_status(user_id, execution_id, "failed", "L’exécution n’a pas pu être terminée.")
        self._persist_final_answer(user_id, execution_id)

    def _persist_final_answer(self, user_id: str, execution_id: str) -> None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None or execution.status in {"running", "planning", "awaiting_approval"}:
            return
        heading = {
            "completed": "Exécution terminée",
            "partial": "Exécution partielle",
            "failed": "Exécution échouée",
            "cancelled": "Exécution annulée",
            "interrupted": "Exécution interrompue",
        }.get(execution.status, "Résultat de l’exécution")
        lines = [f"{heading} : {execution.summary}"]
        for task in execution.tasks:
            if task.status == "completed" and task.result:
                lines.extend((f"\n**{task.title}**", task.result))
            elif task.status in {"failed", "blocked", "cancelled", "interrupted"}:
                lines.append(f"\n**{task.title}** — {task.error or task.status.replace('_', ' ')}")
        self.repository.create_final_message_once(user_id, execution_id, "\n".join(lines))

    async def cancel(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None:
            return None
        event = self._cancel.get(execution_id)
        if event:
            event.set()
        task = self._background.get(execution_id)
        if task and not task.done():
            task.cancel()
        for item in execution.tasks:
            if item.status in {"pending", "ready", "running"}:
                self.repository.transition_task(user_id, execution_id, item.id, "cancelled", "Exécution annulée")
        self.repository.set_execution_status(user_id, execution_id, "cancelled", "Exécution annulée")
        return self.repository.get(user_id, execution_id)

    async def decide_approval(self, user_id: str, execution_id: str, approval_id: str, decision: str) -> ExecutionRead | None:
        result = self.repository.decide_approval(user_id, execution_id, approval_id, decision)
        if result is None or result == "conflict":
            return None
        if result == "approve":
            current = self._background.get(execution_id)
            if current is not None and not current.done():
                await asyncio.gather(current, return_exceptions=True)
            current = self._background.get(execution_id)
            if current is None or current.done():
                self._cancel[execution_id] = asyncio.Event()
                self._background[execution_id] = asyncio.create_task(self.run(user_id, execution_id, self._cancel[execution_id]))
        elif result == "reject":
            self._persist_final_answer(user_id, execution_id)
        return self.repository.get(user_id, execution_id)
