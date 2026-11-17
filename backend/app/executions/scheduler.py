import asyncio
import logging
from collections.abc import Awaitable, Callable

from app.executions.repository import ExecutionRepository
from app.executions.models import TaskRead

TaskHandler = Callable[[TaskRead], Awaitable[str]]
TaskReplanner = Callable[[TaskRead, str], Awaitable[tuple[str, str]]]
logger = logging.getLogger(__name__)


class DagScheduler:
    def __init__(self, repository: ExecutionRepository, handler: TaskHandler, user_id: str, execution_id: str,
                 max_concurrency: int = 3, cancel_event: asyncio.Event | None = None, max_attempts: int = 2,
                 task_timeout_seconds: float = 300, pause_event: asyncio.Event | None = None,
                 replanner: TaskReplanner | None = None):
        self.repository = repository
        self.handler = handler
        self.user_id = user_id
        self.execution_id = execution_id
        self.max_concurrency = max(1, min(max_concurrency, 8))
        self.cancel_event = cancel_event
        self.max_attempts = max(1, min(max_attempts, 3))
        self.task_timeout_seconds = max(0.01, min(task_timeout_seconds, 900))
        self.pause_event = pause_event
        self.replanner = replanner

    async def _run_task(self, task: TaskRead, semaphore: asyncio.Semaphore) -> bool:
        async with semaphore:
            succeeded, failure_type = await self._run_attempts(task)
            if succeeded or not self.replanner or task.connector_ids or task.approval_required:
                return succeeded
            if (self.cancel_event and self.cancel_event.is_set()) or (self.pause_event and self.pause_event.is_set()):
                return False
            if self.repository.has_task_event(self.user_id, self.execution_id, task.id, "task.replanned"):
                return False
            current_execution = self.repository.get(self.user_id, self.execution_id)
            current_task = next((item for item in current_execution.tasks if item.id == task.id), None) if current_execution else None
            if current_task is None or current_task.status != "failed":
                return False
            try:
                revised_description, public_summary = await asyncio.wait_for(
                    self.replanner(current_task, failure_type or "UnknownError"),
                    timeout=self.task_timeout_seconds,
                )
                if self.cancel_event and self.cancel_event.is_set():
                    return False
                revised = self.repository.replan_failed_task(
                    self.user_id, self.execution_id, task.id, revised_description, public_summary,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Task replan failed (execution_id=%s, task_id=%s)", self.execution_id, task.id)
                return False
            if revised is None:
                return False
            if self.pause_event and self.pause_event.is_set():
                return False
            succeeded, _ = await self._run_attempts(revised)
            return succeeded

    async def _run_attempts(self, task: TaskRead) -> tuple[bool, str | None]:
        self.repository.transition_task(self.user_id, self.execution_id, task.id, "running", "Agent au travail")
        attempts_allowed = self.max_attempts if not task.connector_ids else 1
        for attempt_number in range(1, attempts_allowed + 1):
            attempt_id = self.repository.start_attempt(self.user_id, self.execution_id, task.id)
            try:
                result = await asyncio.wait_for(self.handler(task), timeout=self.task_timeout_seconds)
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "validating", "Vérification du résultat")
                if not result.strip():
                    raise ValueError("Task returned an empty result")
                self.repository.complete_task(self.user_id, self.execution_id, task.id, result)
                self.repository.finish_attempt(attempt_id, "completed")
                self.repository.unblock_dependents(self.user_id, self.execution_id)
                return True, None
            except asyncio.CancelledError:
                self.repository.finish_attempt(attempt_id, "cancelled")
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "cancelled", "Exécution annulée")
                raise
            except Exception as error:
                logger.exception(
                    "Execution task attempt failed (execution_id=%s, task_id=%s, attempt=%s)",
                    self.execution_id, task.id, attempt_number,
                )
                safe_error = "La tâche n’a pas pu être terminée."
                self.repository.finish_attempt(attempt_id, "failed", safe_error)
                if attempt_number < attempts_allowed:
                    self.repository.transition_task(
                        self.user_id, self.execution_id, task.id, "running",
                        f"Nouvelle tentative automatique ({attempt_number + 1}/{attempts_allowed})",
                        event_type="task.retrying",
                    )
                    await asyncio.sleep(min(0.15 * (2 ** (attempt_number - 1)), 1.0))
                    if self.cancel_event and self.cancel_event.is_set():
                        self.repository.transition_task(self.user_id, self.execution_id, task.id, "cancelled", "Exécution annulée")
                        return False, type(error).__name__
                    continue
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "failed", safe_error)
                return False, type(error).__name__
        return False, None

    async def run(self) -> None:
        semaphore = asyncio.Semaphore(self.max_concurrency)
        while True:
            if self.cancel_event and self.cancel_event.is_set():
                return
            if self.pause_event and self.pause_event.is_set():
                execution = self.repository.get(self.user_id, self.execution_id)
                terminal_tasks = {"completed", "failed", "blocked", "cancelled", "interrupted"}
                if execution and execution.status not in {"completed", "partial", "failed", "cancelled", "interrupted"}:
                    if any(task.status not in terminal_tasks for task in execution.tasks):
                        self.repository.set_execution_status(self.user_id, self.execution_id, "paused", "Exécution mise en pause entre deux tâches")
                        return
            execution = self.repository.get(self.user_id, self.execution_id)
            if execution is None or execution.status in {"completed", "partial", "failed", "cancelled", "interrupted"}:
                return
            ready = self.repository.ready_tasks(self.user_id, self.execution_id)
            approval_tasks = [task for task in ready if task.approval_required]
            for task in approval_tasks:
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "awaiting_approval", "Approbation requise avant cette action")
            runnable = [task for task in ready if not task.approval_required]
            if runnable:
                await asyncio.gather(*(self._run_task(task, semaphore) for task in runnable))
                continue
            if approval_tasks:
                self.repository.set_execution_status(self.user_id, self.execution_id, "awaiting_approval", "Une action attend votre approbation")
                return
            execution = self.repository.get(self.user_id, self.execution_id)
            if execution is None:
                return
            statuses = {task.id: task.status for task in execution.tasks}
            newly_blocked = []
            for task in execution.tasks:
                if task.status != "pending":
                    continue
                if set(task.dependencies).issubset({key for key, value in statuses.items() if value == "completed"}):
                    self.repository.transition_task(self.user_id, self.execution_id, task.id, "ready", "Dépendances terminées")
                    newly_blocked.append(task)
                    continue
                failed_dependencies = {"failed", "blocked", "cancelled", "interrupted"}
                if any(statuses.get(dependency) in failed_dependencies for dependency in task.dependencies):
                    self.repository.transition_task(self.user_id, self.execution_id, task.id, "blocked", "Une dépendance a échoué")
                    newly_blocked.append(task)
            if newly_blocked:
                continue
            if any(task.status == "awaiting_approval" for task in execution.tasks):
                self.repository.set_execution_status(self.user_id, self.execution_id, "awaiting_approval", "Une action attend votre approbation")
                return
            unfinished = [task for task in execution.tasks if task.status not in {"completed", "failed", "blocked", "cancelled", "interrupted"}]
            if unfinished:
                self.repository.set_execution_status(self.user_id, self.execution_id, "failed", "Graphe bloqué ou incomplet")
            elif any(task.status in {"failed", "blocked"} for task in execution.tasks):
                self.repository.set_execution_status(self.user_id, self.execution_id, "partial", "Certaines tâches ont échoué")
            elif any(task.status == "cancelled" for task in execution.tasks):
                self.repository.set_execution_status(self.user_id, self.execution_id, "cancelled", "Exécution annulée")
            else:
                self.repository.set_execution_status(self.user_id, self.execution_id, "validating", "Revue du résultat en cours")
            return
