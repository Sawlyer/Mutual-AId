import asyncio
import logging
from typing import Protocol

from agents import Agent, RunConfig, Runner

from app.agents.service import AgentService
from app.config import Settings
from app.connectors.context import ConnectorToolContext
from app.connectors.google_oauth import GoogleOAuthClient
from app.connectors.github_oauth import GitHubAppOAuthClient
from app.connectors.tools import ConnectorAuthorizationError, ToolRegistry
from app.connectors.mcp_runtime import McpAuthorizationError, McpRuntime, MCP_CONNECTOR_PREFIX
from app.db import Database
from app.executions.models import ExecutionRead, TaskRead
from app.executions.repository import ExecutionRepository
from app.executions.reviewer import ExecutionResultReview, ExecutionResultReviewer
from app.planning.schemas import ExecutionPlan

logger = logging.getLogger(__name__)
RESULT_REVIEW_TIMEOUT_SECONDS = 30


class ResultReviewer(Protocol):
    async def review(self, execution: ExecutionRead) -> ExecutionResultReview: ...


class AgentTaskExecutor:
    """Run isolated agent tasks without granting arbitrary executable tools."""

    def __init__(self, settings: Settings, repository: ExecutionRepository, user_id: str, execution_id: str,
                 database: Database, tool_registry: ToolRegistry, google_oauth: GoogleOAuthClient | None,
                 github_oauth: GitHubAppOAuthClient | None = None, mcp_runtime: McpRuntime | None = None,
                 agent_service: AgentService | None = None):
        self.settings = settings
        self.repository = repository
        self.user_id = user_id
        self.execution_id = execution_id
        self.database = database
        self.tool_registry = tool_registry
        self.google_oauth = google_oauth
        self.github_oauth = github_oauth
        self.mcp_runtime = mcp_runtime
        self.agent_service = agent_service

    async def __call__(self, task: TaskRead) -> str:
        if not self.settings.openai_configured:
            raise RuntimeError("AI provider unavailable")
        snapshot = task.agent_profile_snapshot or {}
        instructions = str(snapshot.get("instructions") or "Complete the assigned task carefully using only supplied information.")
        if self.agent_service is not None and task.agent_profile_id:
            instructions = self.agent_service.instructions_for_profile(self.user_id, task.agent_profile_id) or instructions
        execution = self.repository.get(self.user_id, self.execution_id)
        dependency_results = {
            candidate.id: candidate.result for candidate in (execution.tasks if execution else [])
            if candidate.id in task.dependencies and candidate.result
        }
        mcp_ids = [connector_id for connector_id in task.connector_ids if connector_id.startswith(MCP_CONNECTOR_PREFIX)]
        static_ids = [connector_id for connector_id in task.connector_ids if not connector_id.startswith(MCP_CONNECTOR_PREFIX)]
        try:
            tools = self.tool_registry.tools_for_user(self.user_id, static_ids, self.database)
            if mcp_ids:
                if self.mcp_runtime is None:
                    raise McpAuthorizationError("MCP runtime is unavailable")
                self.mcp_runtime.validate_selection(self.user_id, mcp_ids)
        except ConnectorAuthorizationError as error:
            raise RuntimeError("A required connector is no longer authorized") from error
        except McpAuthorizationError as error:
            raise RuntimeError("A required MCP server is no longer authorized") from error
        if any(connector_id in {"gmail", "google_drive", "google_calendar"} for connector_id in static_ids) and self.google_oauth is None:
            raise RuntimeError("Connector provider is unavailable")
        if "github" in static_ids and self.github_oauth is None:
            raise RuntimeError("Connector provider is unavailable")
        context = ConnectorToolContext(self.user_id, self.database, self.google_oauth, self.github_oauth) if static_ids else None
        prompt = (
            f"Task: {task.title}\nDescription: {task.description}\nExpected output: {task.expected_output}\n"
            f"Completed dependency outputs: {dependency_results}\n"
            "Return the requested user-facing result. Report only information returned by authorized tools."
        )
        if self.mcp_runtime:
            execution_record = self.repository.get(self.user_id, self.execution_id)
            conversation_id = execution_record.conversation_id if execution_record else ""
            async with self.mcp_runtime.open_approved_servers(
                self.user_id, mcp_ids, conversation_id=conversation_id, agent_profile_id=task.agent_profile_id,
            ) as mcp_servers:
                agent = Agent(
                    name=str(snapshot.get("name") or "Assistant"), instructions=instructions,
                    model=self.settings.openai_model.strip(), tools=tools, mcp_servers=mcp_servers,
                    mcp_config={"include_server_in_tool_names": True, "failure_error_function": None} if mcp_servers else None,
                )
                result = await Runner.run(agent, prompt, context=context, max_turns=self.settings.max_agent_turns,
                                          run_config=RunConfig(tracing_disabled=True))
        else:
            agent = Agent(name=str(snapshot.get("name") or "Assistant"), instructions=instructions,
                          model=self.settings.openai_model.strip(), tools=tools)
            result = await Runner.run(agent, prompt, context=context, max_turns=self.settings.max_agent_turns,
                                      run_config=RunConfig(tracing_disabled=True))
        output = result.final_output
        if not isinstance(output, str) or not output.strip():
            raise RuntimeError("Task returned no user-facing result")
        return output.strip()


class ExecutionCoordinator:
    def __init__(self, repository: ExecutionRepository, agent_service: AgentService, settings: Settings,
                 database: Database, tool_registry: ToolRegistry, google_oauth: GoogleOAuthClient | None,
                 github_oauth: GitHubAppOAuthClient | None = None, mcp_runtime: McpRuntime | None = None,
                 result_reviewer: ResultReviewer | None = None):
        self.repository = repository
        self.agent_service = agent_service
        self.settings = settings
        self.database = database
        self.tool_registry = tool_registry
        self.google_oauth = google_oauth
        self.github_oauth = github_oauth
        self.mcp_runtime = mcp_runtime
        self.result_reviewer = result_reviewer
        self._background: dict[str, asyncio.Task[None]] = {}
        self._cancel: dict[str, asyncio.Event] = {}
        self._pause: dict[str, asyncio.Event] = {}
        self._user_semaphores: dict[str, asyncio.Semaphore] = {}

    async def start(self, user_id: str, conversation_id: str, plan: ExecutionPlan) -> ExecutionRead:
        profile_ids = {task.agent_profile_id for task in plan.tasks if task.agent_profile_id}
        snapshots = {
            profile_id: {
                key: value for key, value in profile.model_dump(mode="json").items()
                if key not in {"skills", "skill_ids"}
            }
            for profile_id in profile_ids
            if (profile := self.agent_service.get_profile(user_id, profile_id)) is not None and profile.enabled
        }
        if len(snapshots) != len(profile_ids):
            raise PermissionError("An assigned agent profile is unavailable")
        execution = self.repository.create(user_id, conversation_id, plan, snapshots)
        cancel_event = asyncio.Event()
        pause_event = asyncio.Event()
        self._cancel[execution.id] = cancel_event
        self._pause[execution.id] = pause_event
        self._background[execution.id] = asyncio.create_task(self.run(user_id, execution.id, cancel_event, pause_event))
        return execution

    async def run(
        self,
        user_id: str,
        execution_id: str,
        cancel_event: asyncio.Event | None = None,
        pause_event: asyncio.Event | None = None,
    ) -> None:
        from app.executions.scheduler import DagScheduler

        execution = self.repository.get(user_id, execution_id)
        if execution is None:
            return
        handler = AgentTaskExecutor(self.settings, self.repository, user_id, execution_id,
                                    self.database, self.tool_registry, self.google_oauth, self.github_oauth,
                                    self.mcp_runtime, self.agent_service)
        user_semaphore = self._user_semaphores.setdefault(user_id, asyncio.Semaphore(self.settings.max_parallel_tasks))

        async def execute_with_user_limit(task: TaskRead) -> str:
            async with user_semaphore:
                return await handler(task)

        scheduler = DagScheduler(self.repository, execute_with_user_limit, user_id, execution_id,
                                 max_concurrency=self.settings.max_parallel_tasks, cancel_event=cancel_event,
                                 pause_event=pause_event)
        try:
            await scheduler.run()
            current = self.repository.get(user_id, execution_id)
            if current and current.status == "validating":
                await self._review_completed_execution(user_id, current)
            elif current and current.status in {"partial", "failed", "cancelled", "interrupted"} and current.result_review_status == "pending":
                self.repository.set_result_review(
                    user_id, execution_id, "skipped", "La revue finale nécessite une exécution complète.",
                )
        except asyncio.CancelledError:
            current = self.repository.get(user_id, execution_id)
            if current and current.result_review_status == "pending":
                self.repository.set_result_review(
                    user_id, execution_id, "skipped", "La revue finale a été interrompue par l’annulation.",
                )
            self.repository.set_execution_status(user_id, execution_id, "cancelled", "Exécution annulée")
            self._persist_final_answer(user_id, execution_id)
            raise
        except Exception:
            logger.exception("Execution failed for %s", execution_id)
            self.repository.set_execution_status(user_id, execution_id, "failed", "L’exécution n’a pas pu être terminée.")
            current = self.repository.get(user_id, execution_id)
            if current and current.result_review_status == "pending":
                self.repository.set_result_review(
                    user_id, execution_id, "skipped", "La revue finale nécessite une exécution complète.",
                )
        self._persist_final_answer(user_id, execution_id)

    async def _review_completed_execution(self, user_id: str, execution: ExecutionRead) -> None:
        if execution.result_review_status in {"verified", "needs_review"}:
            self.repository.set_execution_status(user_id, execution.id, "completed", "Revue précédente restaurée")
            return

        if self.result_reviewer is None:
            self.repository.set_result_review(
                user_id, execution.id, "unavailable", "La revue automatique n’est pas configurée; vérifiez le résultat manuellement.",
            )
        else:
            try:
                review = await asyncio.wait_for(
                    self.result_reviewer.review(execution), timeout=RESULT_REVIEW_TIMEOUT_SECONDS,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Execution result review failed for %s", execution.id)
                self.repository.set_result_review(
                    user_id, execution.id, "unavailable", "La revue automatique est indisponible; vérifiez le résultat manuellement.",
                )
            else:
                self.repository.set_result_review(user_id, execution.id, review.verdict, review.feedback)

        reviewed = self.repository.get(user_id, execution.id)
        if reviewed and reviewed.result_review_status == "verified":
            detail = "Toutes les tâches sont terminées et la revue IA n’a pas relevé d’incohérence."
        elif reviewed and reviewed.result_review_status == "needs_review":
            detail = "Les tâches sont terminées; la revue IA signale des points à vérifier."
        else:
            detail = "Les tâches sont terminées; la revue IA n’a pas pu être effectuée."
        self.repository.set_execution_status(user_id, execution.id, "completed", detail)

    async def pause(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None:
            return None
        if execution.status in {"completed", "partial", "failed", "cancelled", "interrupted", "paused", "pausing"}:
            return execution
        if execution.status not in {"running", "awaiting_approval"}:
            return execution

        background = self._background.get(execution_id)
        pause_event = self._pause.get(execution_id)
        if background is not None and not background.done() and pause_event is not None:
            self.repository.set_execution_status(user_id, execution_id, "pausing", "Pause demandée; les tâches en cours vont se terminer")
            pause_event.set()
        else:
            self.repository.set_execution_status(user_id, execution_id, "paused", "Exécution mise en pause")
        return self.repository.get(user_id, execution_id)

    def _persist_final_answer(self, user_id: str, execution_id: str) -> None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None or execution.status not in {"completed", "partial", "failed", "cancelled", "interrupted"}:
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
        if execution.result_review_status == "verified":
            lines.append(f"\n**Revue IA :** Résultat jugé cohérent avec l’objectif. {execution.result_review_feedback or ''}".strip())
        elif execution.result_review_status == "needs_review":
            lines.append(f"\n**Revue IA : points à vérifier.** {execution.result_review_feedback or ''}".strip())
        elif execution.result_review_status == "unavailable":
            lines.append(f"\n**Revue IA indisponible :** vérifiez manuellement les résultats. {execution.result_review_feedback or ''}".strip())
        self.repository.create_final_message_once(user_id, execution_id, "\n".join(lines))

    async def cancel(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None:
            return None
        if execution.status in {"completed", "partial", "failed", "cancelled", "interrupted"}:
            return execution
        event = self._cancel.get(execution_id)
        if event:
            event.set()
        background = self._background.get(execution_id)
        if background and not background.done():
            background.cancel()
            await asyncio.gather(background, return_exceptions=True)
        current = self.repository.get(user_id, execution_id)
        for item in current.tasks if current else []:
            if item.status in {"pending", "ready", "running", "awaiting_approval", "validating", "paused"}:
                self.repository.transition_task(user_id, execution_id, item.id, "cancelled", "Exécution annulée")
        self.repository.set_execution_status(user_id, execution_id, "cancelled", "Exécution annulée")
        self._persist_final_answer(user_id, execution_id)
        return self.repository.get(user_id, execution_id)

    async def resume(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        execution = self.repository.get(user_id, execution_id)
        if execution is None or execution.status not in {"interrupted", "paused"}:
            return execution
        background = self._background.get(execution_id)
        if background is not None and not background.done():
            await asyncio.gather(background, return_exceptions=True)
            execution = self.repository.get(user_id, execution_id)
            if execution is None or execution.status not in {"interrupted", "paused"}:
                return execution

        resumed = (
            self.repository.resume_interrupted(user_id, execution_id)
            if execution.status == "interrupted"
            else self.repository.get(user_id, execution_id)
        )
        if resumed is None:
            return None
        if execution.status == "paused":
            self.repository.set_execution_status(user_id, execution_id, "running", "Reprise de l’exécution")
            resumed = self.repository.get(user_id, execution_id)
            if resumed is None:
                return None
        cancel_event = asyncio.Event()
        pause_event = asyncio.Event()
        self._cancel[execution_id] = cancel_event
        self._pause[execution_id] = pause_event
        self._background[execution_id] = asyncio.create_task(self.run(user_id, execution_id, cancel_event, pause_event))
        return resumed

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
