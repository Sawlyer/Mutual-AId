import asyncio
from collections.abc import Awaitable, Callable

from app.executions.repository import ExecutionRepository
from app.executions.models import TaskRead

TaskHandler = Callable[[TaskRead], Awaitable[str]]


class DagScheduler:
    def __init__(self, repository: ExecutionRepository, handler: TaskHandler, user_id: str, execution_id: str, max_concurrency: int = 3, cancel_event: asyncio.Event | None = None):
        self.repository = repository
        self.handler = handler
        self.user_id = user_id
        self.execution_id = execution_id
        self.max_concurrency = max(1, min(max_concurrency, 8))
        self.cancel_event = cancel_event

    async def _run_task(self, task: TaskRead, semaphore: asyncio.Semaphore) -> bool:
        async with semaphore:
            self.repository.transition_task(self.user_id, self.execution_id, task.id, "running", "Agent au travail")
            attempt_id = self.repository.start_attempt(self.user_id, self.execution_id, task.id)
            try:
                result = await self.handler(task)
                self.repository.complete_task(self.user_id, self.execution_id, task.id, result)
                self.repository.finish_attempt(attempt_id, "completed")
                self.repository.unblock_dependents(self.user_id, self.execution_id)
                return True
            except asyncio.CancelledError:
                self.repository.finish_attempt(attempt_id, "cancelled")
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "cancelled", "Exécution annulée")
                raise
            except Exception:
                self.repository.finish_attempt(attempt_id, "failed", "La tâche n’a pas pu être terminée.")
                self.repository.transition_task(self.user_id, self.execution_id, task.id, "failed", "La tâche n’a pas pu être terminée.")
                return False

    async def run(self) -> None:
        semaphore = asyncio.Semaphore(self.max_concurrency)
        while True:
            if self.cancel_event and self.cancel_event.is_set():
                return
            execution = self.repository.get(self.user_id, self.execution_id)
            if execution is None or execution.status in {"cancelled", "interrupted"}:
                return
            ready = self.repository.ready_tasks(self.user_id, self.execution_id)
            approval_tasks = [task for task in ready if task.approval_required]
            if approval_tasks:
                for task in approval_tasks:
                    self.repository.transition_task(self.user_id, self.execution_id, task.id, "awaiting_approval", "Approbation requise avant cette action")
                self.repository.set_execution_status(self.user_id, self.execution_id, "awaiting_approval", "Une action attend votre approbation")
                return
            if not ready:
                unfinished = [task for task in execution.tasks if task.status not in {"completed", "failed", "blocked", "cancelled"}]
                if unfinished:
                    self.repository.set_execution_status(self.user_id, self.execution_id, "failed", "Graphe bloqué ou incomplet")
                elif any(task.status != "completed" for task in execution.tasks):
                    self.repository.set_execution_status(self.user_id, self.execution_id, "partial", "Certaines tâches ont échoué")
                else:
                    self.repository.set_execution_status(self.user_id, self.execution_id, "completed", "Toutes les tâches sont terminées")
                return
            results = await asyncio.gather(*(self._run_task(task, semaphore) for task in ready))
            if not all(results):
                execution = self.repository.get(self.user_id, self.execution_id)
                for task in execution.tasks if execution else []:
                    if task.status in {"pending", "ready"}:
                        self.repository.transition_task(self.user_id, self.execution_id, task.id, "blocked", "Une dépendance a échoué")
