import json
from uuid import uuid4

from app.db import Database, utc_now
from app.executions.models import ExecutionArtifactContent, ExecutionArtifactRead, ExecutionEventRead, ExecutionRead, TaskRead
from app.planning.schemas import ExecutionPlan
from app.schemas import MessageRead

MAX_ARTIFACT_BYTES = 1_048_576


class ExecutionRepository:
    def __init__(self, database: Database):
        self.database = database

    @staticmethod
    def _record_event(connection, user_id: str, execution_id: str, task_id: str | None,
                      event_type: str, message: str, timestamp: str, status: str | None = None) -> None:
        if task_id is not None:
            task = connection.execute(
                "SELECT agent_profile_id, status FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND id = ?",
                (user_id, execution_id, task_id),
            ).fetchone()
            agent_id = task["agent_profile_id"] if task else None
            event_status = status or (task["status"] if task else "unknown")
        else:
            execution = connection.execute(
                "SELECT status FROM executions WHERE user_id = ? AND id = ?",
                (user_id, execution_id),
            ).fetchone()
            agent_id = None
            event_status = status or (execution["status"] if execution else "unknown")
        connection.execute(
            """INSERT INTO execution_events
               (execution_id, user_id, task_id, agent_id, event_type, status, message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (execution_id, user_id, task_id, agent_id, event_type, event_status, message, timestamp),
        )

    @staticmethod
    def _task(row) -> TaskRead:
        attempts = row["attempts"] if "attempts" in row.keys() else 0
        return TaskRead(
            id=row["id"], title=row["title"], description=row["description"],
            dependencies=json.loads(row["dependencies_json"]), capability_ids=json.loads(row["capability_ids_json"]),
            agent_profile_id=row["agent_profile_id"],
            agent_profile_snapshot=json.loads(row["agent_profile_snapshot_json"]) if row["agent_profile_snapshot_json"] else None,
            approval_id=row["approval_id"],
            connector_ids=json.loads(row["connector_ids_json"]),
            expected_output=row["expected_output"], approval_required=bool(row["approval_required"]),
            status=row["status"], attempts=attempts, result=row["result"], error=row["error"],
        )

    def _read(self, connection, user_id: str, execution_id: str) -> ExecutionRead | None:
        row = connection.execute("SELECT * FROM executions WHERE user_id = ? AND id = ?", (user_id, execution_id)).fetchone()
        if row is None:
            return None
        tasks = connection.execute(
            """SELECT t.*, (SELECT COUNT(*) FROM execution_attempts a
               WHERE a.execution_id = t.execution_id AND a.task_id = t.id) AS attempts
               FROM execution_tasks t WHERE t.user_id = ? AND t.execution_id = ? ORDER BY t.rowid""",
            (user_id, execution_id),
        ).fetchall()
        return ExecutionRead(
            id=row["id"], conversation_id=row["conversation_id"], status=row["status"], summary=row["summary"],
            tasks=[self._task(task) for task in tasks],
            result_review_status=row["result_review_status"], result_review_feedback=row["result_review_feedback"],
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    def create(self, user_id: str, conversation_id: str, plan: ExecutionPlan, profiles: dict[str, dict[str, object]] | None = None) -> ExecutionRead:
        execution_id = str(uuid4())
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            owner = connection.execute("SELECT 1 FROM conversations WHERE id = ? AND owner_id = ?", (conversation_id, user_id)).fetchone()
            if owner is None:
                raise LookupError("Conversation not found")
            connection.execute(
                "INSERT INTO executions (id, user_id, conversation_id, status, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (execution_id, user_id, conversation_id, "running", plan.summary, timestamp, timestamp),
            )
            for task in plan.tasks:
                approval_id = str(uuid4()) if task.approval_required else None
                connection.execute(
                    """INSERT INTO execution_tasks
                       (id, execution_id, user_id, title, description, dependencies_json, capability_ids_json,
                        agent_profile_id, agent_profile_snapshot_json, approval_id, connector_ids_json, expected_output, approval_required, status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (task.id, execution_id, user_id, task.title, task.description, json.dumps(task.dependencies),
                     json.dumps(task.capability_ids), task.agent_profile_id,
                     json.dumps(profiles.get(task.agent_profile_id), ensure_ascii=False) if profiles and task.agent_profile_id in profiles else None,
                     approval_id,
                     json.dumps(task.connector_ids),
                     task.expected_output, int(task.approval_required), "pending" if task.dependencies else "ready", timestamp, timestamp),
                )
                if approval_id:
                    connection.execute(
                        "INSERT INTO execution_approvals (id, execution_id, task_id, user_id, decision, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                        (approval_id, execution_id, task.id, user_id, timestamp),
                    )
            self._record_event(connection, user_id, execution_id, None, "execution.created", plan.summary, timestamp)
            result = self._read(connection, user_id, execution_id)
        assert result is not None
        return result

    def get(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        with self.database.connection() as connection:
            return self._read(connection, user_id, execution_id)

    def list_executions(self, user_id: str, limit: int = 50) -> list[ExecutionRead]:
        with self.database.connection() as connection:
            rows = connection.execute(
                "SELECT id FROM executions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
                (user_id, max(1, min(limit, 100))),
            ).fetchall()
            return [item for row in rows if (item := self._read(connection, user_id, row["id"])) is not None]

    def transition_task(self, user_id: str, execution_id: str, task_id: str, status: str, detail: str | None = None, event_type: str | None = None) -> TaskRead:
        allowed = {"pending", "ready", "running", "awaiting_approval", "validating", "completed", "failed", "blocked", "paused", "interrupted", "cancelled"}
        if status not in allowed:
            raise ValueError("Unknown task status")
        timestamp = utc_now()
        event_type = event_type or {"running": "task.started", "ready": "task.ready", "validating": "task.validating", "completed": "task.completed", "failed": "task.failed", "blocked": "task.blocked", "cancelled": "task.cancelled", "awaiting_approval": "approval.required"}.get(status, "task.updated")
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE execution_tasks SET status = ?, error = ?, updated_at = ? WHERE user_id = ? AND execution_id = ? AND id = ?",
                (status, detail if status in {"failed", "blocked"} else None, timestamp, user_id, execution_id, task_id),
            )
            if cursor.rowcount != 1:
                raise LookupError("Task not found")
            self._record_event(connection, user_id, execution_id, task_id, event_type, detail or status, timestamp, status)
            row = connection.execute(
                "SELECT * FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND id = ?",
                (user_id, execution_id, task_id),
            ).fetchone()
            connection.execute("UPDATE executions SET updated_at = ? WHERE user_id = ? AND id = ?", (timestamp, user_id, execution_id))
        return self._task(row)

    def start_attempt(self, user_id: str, execution_id: str, task_id: str) -> str:
        attempt_id = str(uuid4())
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            task = connection.execute("SELECT 1 FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND id = ?", (user_id, execution_id, task_id)).fetchone()
            if task is None:
                raise LookupError("Task not found")
            current = connection.execute("SELECT COALESCE(MAX(attempt_number), 0) FROM execution_attempts WHERE execution_id = ? AND task_id = ?", (execution_id, task_id)).fetchone()[0]
            connection.execute(
                "INSERT INTO execution_attempts (id, execution_id, task_id, attempt_number, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
                (attempt_id, execution_id, task_id, current + 1, timestamp),
            )
        return attempt_id

    def finish_attempt(self, attempt_id: str, status: str, error: str | None = None) -> None:
        with self.database.connection() as connection:
            connection.execute(
                "UPDATE execution_attempts SET status = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'",
                (status, error, utc_now(), attempt_id),
            )

    def complete_task(self, user_id: str, execution_id: str, task_id: str, result: str) -> TaskRead:
        if len(result.encode("utf-8")) > MAX_ARTIFACT_BYTES:
            raise ValueError("Task result exceeds the artifact storage limit")
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            task = connection.execute(
                "SELECT title FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND id = ?",
                (user_id, execution_id, task_id),
            ).fetchone()
            if task is None:
                raise LookupError("Task not found")
            cursor = connection.execute(
                "UPDATE execution_tasks SET result = ?, status = 'completed', updated_at = ? WHERE user_id = ? AND execution_id = ? AND id = ?",
                (result, timestamp, user_id, execution_id, task_id),
            )
            if cursor.rowcount != 1:
                raise LookupError("Task not found")
            connection.execute(
                "INSERT INTO execution_artifacts (id, execution_id, task_id, user_id, name, media_type, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (artifact_id := str(uuid4()), execution_id, task_id, user_id, task["title"][:160], "text/plain; charset=utf-8", result, timestamp),
            )
            self._record_event(connection, user_id, execution_id, task_id, "task.completed", "Tâche terminée", timestamp, "completed")
            self._record_event(connection, user_id, execution_id, task_id, "artifact.created", artifact_id, timestamp, "completed")
            row = connection.execute("SELECT * FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND id = ?", (user_id, execution_id, task_id)).fetchone()
            connection.execute("UPDATE executions SET updated_at = ? WHERE user_id = ? AND id = ?", (timestamp, user_id, execution_id))
        return self._task(row)

    def set_execution_status(self, user_id: str, execution_id: str, status: str, detail: str) -> None:
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute("UPDATE executions SET status = ?, updated_at = ? WHERE user_id = ? AND id = ?", (status, timestamp, user_id, execution_id))
            if cursor.rowcount != 1:
                raise LookupError("Execution not found")
            self._record_event(connection, user_id, execution_id, None, f"execution.{status}", detail, timestamp, status)

    def set_result_review(self, user_id: str, execution_id: str, status: str, feedback: str) -> None:
        allowed = {"pending", "verified", "needs_review", "unavailable", "skipped"}
        if status not in allowed:
            raise ValueError("Unknown result review status")
        timestamp = utc_now()
        safe_feedback = feedback.strip()[:500]
        event_types = {
            "verified": "execution.review_verified",
            "needs_review": "execution.review_needs_attention",
            "unavailable": "execution.review_unavailable",
            "skipped": "execution.review_skipped",
            "pending": "execution.review_started",
        }
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE executions SET result_review_status = ?, result_review_feedback = ?, updated_at = ? WHERE user_id = ? AND id = ?",
                (status, safe_feedback or None, timestamp, user_id, execution_id),
            )
            if cursor.rowcount != 1:
                raise LookupError("Execution not found")
            self._record_event(
                connection, user_id, execution_id, None, event_types[status],
                safe_feedback or "Revue du résultat mise à jour.", timestamp,
            )

    def create_final_message_once(self, user_id: str, execution_id: str, content: str) -> MessageRead | None:
        timestamp = utc_now()
        message_id = str(uuid4())
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            execution = connection.execute("SELECT conversation_id FROM executions WHERE id = ? AND user_id = ?", (execution_id, user_id)).fetchone()
            if execution is None:
                raise LookupError("Execution not found")
            existing = connection.execute("SELECT message_id FROM execution_final_messages WHERE execution_id = ? AND user_id = ?", (execution_id, user_id)).fetchone()
            if existing is not None:
                return None
            conversation_id = execution["conversation_id"]
            connection.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
                (message_id, conversation_id, content, timestamp),
            )
            connection.execute("UPDATE conversations SET updated_at = ? WHERE id = ? AND owner_id = ?", (timestamp, conversation_id, user_id))
            connection.execute(
                "INSERT INTO execution_final_messages (execution_id, user_id, message_id, created_at) VALUES (?, ?, ?, ?)",
                (execution_id, user_id, message_id, timestamp),
            )
        return MessageRead(id=message_id, conversation_id=conversation_id, role="assistant", content=content, created_at=timestamp)

    def resume_interrupted(self, user_id: str, execution_id: str) -> ExecutionRead | None:
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            execution = connection.execute(
                "SELECT status FROM executions WHERE user_id = ? AND id = ?",
                (user_id, execution_id),
            ).fetchone()
            if execution is None:
                return None
            if execution["status"] != "interrupted":
                return self._read(connection, user_id, execution_id)

            # Keep the interruption message as history and allow the resumed run to
            # append its own final result when it reaches a terminal state.
            connection.execute(
                "DELETE FROM execution_final_messages WHERE execution_id = ? AND user_id = ?",
                (execution_id, user_id),
            )

            tasks = connection.execute(
                """SELECT id, dependencies_json, connector_ids_json FROM execution_tasks
                   WHERE user_id = ? AND execution_id = ? AND status = 'interrupted'""",
                (user_id, execution_id),
            ).fetchall()
            completed = {
                row["id"] for row in connection.execute(
                    "SELECT id FROM execution_tasks WHERE user_id = ? AND execution_id = ? AND status = 'completed'",
                    (user_id, execution_id),
                ).fetchall()
            }
            for task in tasks:
                has_external_access = bool(json.loads(task["connector_ids_json"])) or connection.execute(
                    "SELECT 1 FROM execution_tool_calls WHERE user_id = ? AND execution_id = ? AND task_id = ? LIMIT 1",
                    (user_id, execution_id, task["id"]),
                ).fetchone() is not None
                dependencies = set(json.loads(task["dependencies_json"]))
                if has_external_access:
                    status = "blocked"
                    detail = "Une action externe a pu avoir lieu avant l’arrêt. Vérifiez son état avant de la relancer."
                    event_type = "task.resume_blocked"
                else:
                    status = "ready" if dependencies.issubset(completed) else "pending"
                    detail = "Reprise sûre après interruption"
                    event_type = "task.ready" if status == "ready" else "task.updated"
                connection.execute(
                    "UPDATE execution_tasks SET status = ?, error = ?, updated_at = ? WHERE user_id = ? AND execution_id = ? AND id = ?",
                    (status, detail if status == "blocked" else None, timestamp, user_id, execution_id, task["id"]),
                )
                self._record_event(connection, user_id, execution_id, task["id"], event_type, detail, timestamp, status)

            connection.execute(
                "UPDATE executions SET status = 'running', updated_at = ? WHERE user_id = ? AND id = ?",
                (timestamp, user_id, execution_id),
            )
            self._record_event(connection, user_id, execution_id, None, "execution.running", "Reprise après interruption", timestamp, "running")
        return self.get(user_id, execution_id)

    def decide_approval(self, user_id: str, execution_id: str, approval_id: str, decision: str) -> str | None:
        if decision not in {"approve", "reject"}:
            raise ValueError("Invalid approval decision")
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM execution_approvals WHERE id = ? AND user_id = ? AND execution_id = ?",
                (approval_id, user_id, execution_id),
            ).fetchone()
            if row is None:
                return None
            if row["decision"] != "pending":
                return row["decision"] if row["decision"] == decision else "conflict"
            connection.execute("UPDATE execution_approvals SET decision = ?, decided_at = ? WHERE id = ?", (decision, timestamp, approval_id))
            task_status = "ready" if decision == "approve" else "blocked"
            connection.execute("UPDATE execution_tasks SET status = ?, approval_required = CASE WHEN ? = 'approve' THEN 0 ELSE approval_required END, updated_at = ? WHERE execution_id = ? AND id = ? AND user_id = ?", (task_status, decision, timestamp, execution_id, row["task_id"], user_id))
            connection.execute("UPDATE executions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?", ("running" if decision == "approve" else "partial", timestamp, execution_id, user_id))
            task_status = "ready" if decision == "approve" else "blocked"
            self._record_event(connection, user_id, execution_id, row["task_id"], "approval.decided", decision, timestamp, task_status)
        return decision

    def list_events(self, user_id: str, execution_id: str, after_id: int | None = None, limit: int = 200) -> list[ExecutionEventRead]:
        with self.database.connection() as connection:
            rows = connection.execute(
                "SELECT e.id, e.task_id, e.agent_id, e.event_type, e.status, e.message, e.created_at FROM execution_events e JOIN executions x ON x.id = e.execution_id AND x.user_id = e.user_id WHERE e.user_id = ? AND e.execution_id = ? AND (? IS NULL OR e.id > ?) ORDER BY e.id LIMIT ?",
                (user_id, execution_id, after_id, after_id, max(1, min(limit, 500))),
            ).fetchall()
        return [ExecutionEventRead(**dict(row)) for row in rows]

    def list_artifacts(self, user_id: str, execution_id: str) -> list[ExecutionArtifactRead]:
        with self.database.connection() as connection:
            rows = connection.execute(
                """SELECT a.id, a.task_id, a.name, a.media_type, a.created_at
                   FROM execution_artifacts a JOIN executions e
                     ON e.id = a.execution_id AND e.user_id = a.user_id
                   WHERE a.user_id = ? AND a.execution_id = ? ORDER BY a.created_at, a.rowid""",
                (user_id, execution_id),
            ).fetchall()
        return [ExecutionArtifactRead(**dict(row)) for row in rows]

    def get_artifact(self, user_id: str, execution_id: str, artifact_id: str) -> ExecutionArtifactContent | None:
        with self.database.connection() as connection:
            row = connection.execute(
                """SELECT a.id, a.task_id, a.name, a.media_type, a.created_at, a.content
                   FROM execution_artifacts a JOIN executions e
                     ON e.id = a.execution_id AND e.user_id = a.user_id
                   WHERE a.user_id = ? AND a.execution_id = ? AND a.id = ?""",
                (user_id, execution_id, artifact_id),
            ).fetchone()
        return ExecutionArtifactContent(**dict(row)) if row else None

    def recover_interrupted(self) -> int:
        """Mark work abandoned by a process restart and persist visible recovery events."""
        timestamp = utc_now()
        with self.database.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            active = connection.execute("SELECT id, user_id FROM executions WHERE status IN ('planning', 'running', 'pausing', 'awaiting_approval', 'validating')").fetchall()
            for execution in active:
                connection.execute(
                    "UPDATE execution_tasks SET status = 'interrupted', updated_at = ? WHERE execution_id = ? AND user_id = ? AND status = 'running'",
                    (timestamp, execution["id"], execution["user_id"]),
                )
                connection.execute(
                    "UPDATE executions SET status = 'interrupted', updated_at = ? WHERE id = ? AND user_id = ?",
                    (timestamp, execution["id"], execution["user_id"]),
                )
                self._record_event(
                    connection,
                    execution["user_id"],
                    execution["id"],
                    None,
                    "execution.interrupted",
                    "Le processus s’est arrêté; cette exécution doit être relancée explicitement.",
                    timestamp,
                    "interrupted",
                )
        return len(active)

    def ready_tasks(self, user_id: str, execution_id: str) -> list[TaskRead]:
        execution = self.get(user_id, execution_id)
        if execution is None:
            return []
        complete = {task.id for task in execution.tasks if task.status == "completed"}
        return [task for task in execution.tasks if task.status == "ready" and set(task.dependencies).issubset(complete)]

    def unblock_dependents(self, user_id: str, execution_id: str) -> None:
        execution = self.get(user_id, execution_id)
        if execution is None:
            return
        complete = {task.id for task in execution.tasks if task.status == "completed"}
        for task in execution.tasks:
            if task.status == "pending" and set(task.dependencies).issubset(complete):
                self.transition_task(user_id, execution_id, task.id, "ready", "Dépendances terminées")
