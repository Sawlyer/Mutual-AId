import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from uuid import uuid4

from app.schemas import AuthUserRead, ConversationRead, MessageRead


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Database:
    """Small SQLite repository for product-visible conversations and messages."""

    def __init__(self, path: Path):
        self.path = Path(path)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    owner_id TEXT NOT NULL DEFAULT 'local-user'
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    execution_id TEXT
                );
                CREATE INDEX IF NOT EXISTS messages_conversation_order
                    ON messages(conversation_id, created_at, id);
                CREATE TABLE IF NOT EXISTS connector_connections (
                    user_id TEXT NOT NULL,
                    connector_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (status IN ('connected', 'disconnected', 'error')),
                    granted_scopes_json TEXT NOT NULL DEFAULT '[]',
                    error_message TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, connector_id)
                );
                CREATE TABLE IF NOT EXISTS conversation_connectors (
                    user_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    connector_id TEXT NOT NULL,
                    PRIMARY KEY (user_id, conversation_id, connector_id)
                );
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    name TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
                CREATE TABLE IF NOT EXISTS connector_oauth_states (
                    state_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    connector_id TEXT NOT NULL DEFAULT 'google_calendar',
                    scopes_json TEXT NOT NULL,
                    redirect_path TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS connector_credentials (
                    user_id TEXT NOT NULL,
                    connector_id TEXT NOT NULL,
                    encrypted_payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, connector_id)
                );
                CREATE TABLE IF NOT EXISTS mcp_servers (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    url TEXT NOT NULL,
                    encrypted_auth_token TEXT,
                    status TEXT NOT NULL DEFAULT 'not_checked' CHECK (status IN ('not_checked', 'ready', 'error')),
                    discovered_tools_json TEXT NOT NULL DEFAULT '[]',
                    approved_tools_json TEXT NOT NULL DEFAULT '[]',
                    last_checked_at TEXT,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS mcp_servers_user_created ON mcp_servers(user_id, created_at);
                CREATE TABLE IF NOT EXISTS agent_profiles (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    description TEXT NOT NULL,
                    instructions TEXT NOT NULL,
                    capability_ids_json TEXT NOT NULL DEFAULT '[]',
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    origin TEXT NOT NULL CHECK (origin IN ('user_created', 'auto_created', 'system_template')),
                    template_version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS agent_profiles_user_domain_enabled
                    ON agent_profiles(user_id, domain, enabled);
                CREATE INDEX IF NOT EXISTS agent_profiles_user_enabled
                    ON agent_profiles(user_id, enabled);
                CREATE TABLE IF NOT EXISTS agent_skills (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    instructions TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (user_id, id)
                );
                CREATE INDEX IF NOT EXISTS agent_skills_user_created ON agent_skills(user_id, created_at, id);
                CREATE TABLE IF NOT EXISTS agent_profile_skills (
                    user_id TEXT NOT NULL,
                    profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
                    skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, profile_id, skill_id)
                );
                CREATE INDEX IF NOT EXISTS agent_profile_skills_order ON agent_profile_skills(user_id, profile_id, created_at, skill_id);
                CREATE TABLE IF NOT EXISTS auto_agent_capabilities (
                    user_id TEXT NOT NULL,
                    capability_id TEXT NOT NULL,
                    profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user_id, capability_id),
                    UNIQUE (profile_id)
                );
                CREATE TABLE IF NOT EXISTS executions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS executions_user_updated ON executions(user_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS execution_tasks (
                    id TEXT NOT NULL,
                    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    dependencies_json TEXT NOT NULL,
                    capability_ids_json TEXT NOT NULL,
                    agent_profile_id TEXT,
                    agent_profile_snapshot_json TEXT,
                    approval_id TEXT,
                    connector_ids_json TEXT NOT NULL,
                    expected_output TEXT NOT NULL,
                    approval_required INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    result TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (execution_id, id)
                );
                CREATE INDEX IF NOT EXISTS execution_tasks_ready ON execution_tasks(execution_id, status);
                CREATE TABLE IF NOT EXISTS execution_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL,
                    task_id TEXT,
                    event_type TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS execution_events_cursor ON execution_events(user_id, execution_id, id);
                CREATE TABLE IF NOT EXISTS execution_attempts (
                    id TEXT PRIMARY KEY,
                    execution_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    attempt_number INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS execution_approvals (
                    id TEXT PRIMARY KEY,
                    execution_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    decision TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    decided_at TEXT,
                    UNIQUE (execution_id, task_id)
                );
                CREATE TABLE IF NOT EXISTS execution_tool_calls (
                    id TEXT PRIMARY KEY,
                    execution_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    access TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS execution_artifacts (
                    id TEXT PRIMARY KEY,
                    execution_id TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    media_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS execution_final_messages (
                    execution_id TEXT PRIMARY KEY REFERENCES executions(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL,
                    message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                );
                """
            )
            conversation_columns = {row["name"] for row in connection.execute("PRAGMA table_info(conversations)")}
            message_columns = {row["name"] for row in connection.execute("PRAGMA table_info(messages)")}
            if "execution_id" not in message_columns:
                connection.execute("ALTER TABLE messages ADD COLUMN execution_id TEXT")
            if "owner_id" not in conversation_columns:
                connection.execute("ALTER TABLE conversations ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'local-user'")
            task_columns = {row["name"] for row in connection.execute("PRAGMA table_info(execution_tasks)")}
            if "agent_profile_snapshot_json" not in task_columns:
                connection.execute("ALTER TABLE execution_tasks ADD COLUMN agent_profile_snapshot_json TEXT")
            if "approval_id" not in task_columns:
                connection.execute("ALTER TABLE execution_tasks ADD COLUMN approval_id TEXT")
            oauth_state_columns = {row["name"] for row in connection.execute("PRAGMA table_info(connector_oauth_states)")}
            if "connector_id" not in oauth_state_columns:
                connection.execute("ALTER TABLE connector_oauth_states ADD COLUMN connector_id TEXT NOT NULL DEFAULT 'google_calendar'")

    @staticmethod
    def _agent_profile(row: sqlite3.Row | None) -> dict[str, object] | None:
        if row is None:
            return None
        profile = dict(row)
        profile["capability_ids"] = json.loads(profile.pop("capability_ids_json"))
        profile["enabled"] = bool(profile["enabled"])
        return profile

    def create_agent_profile(self, user_id: str, profile_data: dict[str, object]) -> dict[str, object]:
        timestamp = utc_now()
        with self.connection() as connection:
            connection.execute(
                """INSERT INTO agent_profiles
                   (id, user_id, name, domain, description, instructions, capability_ids_json,
                    enabled, origin, template_version, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(profile_data["id"]), user_id, str(profile_data["name"]), str(profile_data["domain"]),
                    str(profile_data.get("description", "")), str(profile_data.get("instructions", "")),
                    json.dumps(profile_data.get("capability_ids", [])), int(bool(profile_data.get("enabled", True))),
                    str(profile_data.get("origin", "user_created")), int(profile_data.get("template_version", 1)),
                    timestamp, timestamp,
                ),
            )
            row = connection.execute("SELECT * FROM agent_profiles WHERE id = ? AND user_id = ?", (str(profile_data["id"]), user_id)).fetchone()
        result = self._agent_profile(row)
        assert result is not None
        return result

    def get_agent_profile(self, user_id: str, profile_id: str) -> dict[str, object] | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM agent_profiles WHERE user_id = ? AND id = ?", (user_id, profile_id)).fetchone()
        return self._agent_profile(row)

    def list_agent_profiles(self, user_id: str) -> list[dict[str, object]]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM agent_profiles WHERE user_id = ? ORDER BY created_at, id", (user_id,)
            ).fetchall()
        return [profile for row in rows if (profile := self._agent_profile(row)) is not None]

    def update_agent_profile(self, user_id: str, profile_id: str, profile_data: dict[str, object]) -> dict[str, object] | None:
        allowed = {"name", "domain", "description", "instructions", "capability_ids", "enabled"}
        changes = {key: value for key, value in profile_data.items() if key in allowed}
        if not changes:
            return self.get_agent_profile(user_id, profile_id)
        columns = {"capability_ids": "capability_ids_json"}
        assignments: list[str] = []
        values: list[object] = []
        for key, value in changes.items():
            column = columns.get(key, key)
            assignments.append(f"{column} = ?")
            values.append(json.dumps(value) if key == "capability_ids" else int(value) if key == "enabled" else value)
        assignments.append("updated_at = ?")
        values.extend((utc_now(), user_id, profile_id))
        with self.connection() as connection:
            connection.execute(f"UPDATE agent_profiles SET {', '.join(assignments)} WHERE user_id = ? AND id = ?", values)
        return self.get_agent_profile(user_id, profile_id)

    def delete_agent_profile(self, user_id: str, profile_id: str) -> bool:
        with self.connection() as connection:
            cursor = connection.execute("DELETE FROM agent_profiles WHERE user_id = ? AND id = ?", (user_id, profile_id))
        return cursor.rowcount > 0

    @staticmethod
    def _agent_skill(row: sqlite3.Row | None) -> dict[str, object] | None:
        if row is None:
            return None
        skill = dict(row)
        skill["enabled"] = bool(skill["enabled"])
        return skill

    def create_agent_skill(self, user_id: str, skill_id: str, skill_data: dict[str, object]) -> dict[str, object]:
        timestamp = utc_now()
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO agent_skills (id, user_id, name, description, instructions, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (skill_id, user_id, skill_data["name"], skill_data.get("description", ""), skill_data["instructions"], int(bool(skill_data.get("enabled", True))), timestamp, timestamp),
            )
            row = connection.execute("SELECT * FROM agent_skills WHERE user_id = ? AND id = ?", (user_id, skill_id)).fetchone()
        result = self._agent_skill(row)
        assert result is not None
        return result

    def list_agent_skills(self, user_id: str, profile_id: str | None = None) -> list[dict[str, object]]:
        with self.connection() as connection:
            if profile_id is None:
                rows = connection.execute("SELECT * FROM agent_skills WHERE user_id = ? ORDER BY created_at, id", (user_id,)).fetchall()
            else:
                rows = connection.execute(
                    """SELECT s.* FROM agent_skills s JOIN agent_profile_skills a
                       ON a.skill_id = s.id AND a.user_id = s.user_id
                       WHERE a.user_id = ? AND a.profile_id = ? ORDER BY a.created_at, s.id""",
                    (user_id, profile_id),
                ).fetchall()
        return [skill for row in rows if (skill := self._agent_skill(row)) is not None]

    def get_agent_skill(self, user_id: str, skill_id: str, profile_id: str | None = None) -> dict[str, object] | None:
        with self.connection() as connection:
            if profile_id is None:
                row = connection.execute("SELECT * FROM agent_skills WHERE user_id = ? AND id = ?", (user_id, skill_id)).fetchone()
            else:
                row = connection.execute(
                    """SELECT s.* FROM agent_skills s JOIN agent_profile_skills a
                       ON a.skill_id = s.id AND a.user_id = s.user_id
                       WHERE a.user_id = ? AND a.profile_id = ? AND a.skill_id = ?""",
                    (user_id, profile_id, skill_id),
                ).fetchone()
        return self._agent_skill(row)

    def update_agent_skill(self, user_id: str, skill_id: str, skill_data: dict[str, object]) -> dict[str, object] | None:
        allowed = {"name", "description", "instructions", "enabled"}
        changes = {key: value for key, value in skill_data.items() if key in allowed}
        if not changes:
            return self.get_agent_skill(user_id, skill_id)
        assignments: list[str] = []
        values: list[object] = []
        for key, value in changes.items():
            assignments.append(f"{key} = ?")
            values.append(int(value) if key == "enabled" else value)
        assignments.append("updated_at = ?")
        values.extend((utc_now(), user_id, skill_id))
        with self.connection() as connection:
            connection.execute(f"UPDATE agent_skills SET {', '.join(assignments)} WHERE user_id = ? AND id = ?", values)
        return self.get_agent_skill(user_id, skill_id)

    def delete_agent_skill(self, user_id: str, skill_id: str) -> bool:
        with self.connection() as connection:
            cursor = connection.execute("DELETE FROM agent_skills WHERE user_id = ? AND id = ?", (user_id, skill_id))
        return cursor.rowcount > 0

    def set_agent_profile_skill_ids(self, user_id: str, profile_id: str, skill_ids: list[str]) -> bool:
        if len(set(skill_ids)) != len(skill_ids):
            return False
        with self.connection() as connection:
            profile = connection.execute("SELECT 1 FROM agent_profiles WHERE user_id = ? AND id = ?", (user_id, profile_id)).fetchone()
            if profile is None:
                return False
            if skill_ids:
                marks = ",".join("?" for _ in skill_ids)
                rows = connection.execute(
                    f"SELECT id FROM agent_skills WHERE user_id = ? AND id IN ({marks})",
                    (user_id, *skill_ids),
                ).fetchall()
                if {row["id"] for row in rows} != set(skill_ids):
                    return False
            connection.execute("DELETE FROM agent_profile_skills WHERE user_id = ? AND profile_id = ?", (user_id, profile_id))
            connection.executemany(
                "INSERT INTO agent_profile_skills (user_id, profile_id, skill_id, created_at) VALUES (?, ?, ?, ?)",
                [(user_id, profile_id, skill_id, utc_now()) for skill_id in skill_ids],
            )
        return True

    def unassign_agent_skill(self, user_id: str, profile_id: str, skill_id: str) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                "DELETE FROM agent_profile_skills WHERE user_id = ? AND profile_id = ? AND skill_id = ?",
                (user_id, profile_id, skill_id),
            )
        return cursor.rowcount > 0

    def link_auto_agent_capability(self, user_id: str, capability_id: str, profile_id: str) -> None:
        with self.connection() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO auto_agent_capabilities (user_id, capability_id, profile_id, created_at) VALUES (?, ?, ?, ?)",
                (user_id, capability_id, profile_id, utc_now()),
            )

    def get_auto_agent_profile(self, user_id: str, capability_id: str) -> dict[str, object] | None:
        with self.connection() as connection:
            row = connection.execute(
                """SELECT p.* FROM auto_agent_capabilities c
                   JOIN agent_profiles p ON p.id = c.profile_id AND p.user_id = c.user_id
                   WHERE c.user_id = ? AND c.capability_id = ?""",
                (user_id, capability_id),
            ).fetchone()
        return self._agent_profile(row)

    def ensure_auto_agent_profile(
        self,
        user_id: str,
        capability_id: str,
        profile_data: dict[str, object],
        default_skills: list[dict[str, str]] | None = None,
    ) -> dict[str, object]:
        """Atomically reuse or create a template profile and apply versioned default skills."""
        timestamp = utc_now()

        def add_default_skills(connection: sqlite3.Connection, profile_id: str) -> None:
            for skill in default_skills or []:
                skill_id = str(uuid4())
                connection.execute(
                    """INSERT INTO agent_skills
                       (id, user_id, name, description, instructions, enabled, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 1, ?, ?)""",
                    (skill_id, user_id, skill["name"], skill["description"], skill["instructions"], timestamp, timestamp),
                )
                connection.execute(
                    "INSERT INTO agent_profile_skills (user_id, profile_id, skill_id, created_at) VALUES (?, ?, ?, ?)",
                    (user_id, profile_id, skill_id, timestamp),
                )

        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                """SELECT p.* FROM auto_agent_capabilities c
                   JOIN agent_profiles p ON p.id = c.profile_id AND p.user_id = c.user_id
                   WHERE c.user_id = ? AND c.capability_id = ?""",
                (user_id, capability_id),
            ).fetchone()
            if existing is not None:
                existing_profile = self._agent_profile(existing)
                assert existing_profile is not None
                if int(existing_profile["template_version"]) < int(profile_data["template_version"]):
                    add_default_skills(connection, str(existing_profile["id"]))
                    connection.execute(
                        "UPDATE agent_profiles SET template_version = ?, updated_at = ? WHERE user_id = ? AND id = ?",
                        (int(profile_data["template_version"]), timestamp, user_id, str(existing_profile["id"])),
                    )
                    refreshed = connection.execute(
                        "SELECT * FROM agent_profiles WHERE id = ? AND user_id = ?",
                        (str(existing_profile["id"]), user_id),
                    ).fetchone()
                    return self._agent_profile(refreshed)  # type: ignore[return-value]
                return existing_profile
            connection.execute(
                """INSERT INTO agent_profiles
                   (id, user_id, name, domain, description, instructions, capability_ids_json,
                    enabled, origin, template_version, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'auto_created', ?, ?, ?)""",
                (
                    str(profile_data["id"]), user_id, str(profile_data["name"]), str(profile_data["domain"]),
                    str(profile_data["description"]), str(profile_data["instructions"]),
                    json.dumps(profile_data["capability_ids"]), int(profile_data["template_version"]), timestamp, timestamp,
                ),
            )
            connection.execute(
                "INSERT INTO auto_agent_capabilities (user_id, capability_id, profile_id, created_at) VALUES (?, ?, ?, ?)",
                (user_id, capability_id, str(profile_data["id"]), timestamp),
            )
            add_default_skills(connection, str(profile_data["id"]))
            row = connection.execute(
                "SELECT * FROM agent_profiles WHERE id = ? AND user_id = ?", (str(profile_data["id"]), user_id)
            ).fetchone()
        result = self._agent_profile(row)
        assert result is not None
        return result

    def create_user(self, email: str, name: str, password_hash: str) -> AuthUserRead:
        user_id = str(uuid4())
        timestamp = utc_now()
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            is_first_user = connection.execute("SELECT 1 FROM users LIMIT 1").fetchone() is None
            connection.execute(
                "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, email.lower(), name.strip(), password_hash, timestamp),
            )
            if is_first_user:
                connection.execute("UPDATE conversations SET owner_id = ? WHERE owner_id = 'local-user'", (user_id,))
                connection.execute("UPDATE connector_connections SET user_id = ? WHERE user_id = 'local-user'", (user_id,))
                connection.execute("UPDATE conversation_connectors SET user_id = ? WHERE user_id = 'local-user'", (user_id,))
        return AuthUserRead(id=user_id, email=email.lower(), name=name.strip(), created_at=timestamp)

    def get_user_by_email(self, email: str) -> dict[str, str] | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id, email, name, password_hash, created_at FROM users WHERE email = ? COLLATE NOCASE",
                (email.lower(),),
            ).fetchone()
        return dict(row) if row else None

    def get_user(self, user_id: str) -> AuthUserRead | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT id, email, name, created_at FROM users WHERE id = ?", (user_id,)
            ).fetchone()
        return AuthUserRead(**dict(row)) if row else None

    def create_auth_session(self, token_hash: str, user_id: str, expires_at: str) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (utc_now(),))
            connection.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, user_id, utc_now(), expires_at),
            )

    def get_user_for_session(self, token_hash: str) -> AuthUserRead | None:
        with self.connection() as connection:
            row = connection.execute(
                """SELECT u.id, u.email, u.name, u.created_at
                   FROM auth_sessions s JOIN users u ON u.id = s.user_id
                   WHERE s.token_hash = ? AND s.expires_at > ?""",
                (token_hash, utc_now()),
            ).fetchone()
        return AuthUserRead(**dict(row)) if row else None

    def delete_auth_session(self, token_hash: str) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))

    def create_connector_oauth_state(self, state_hash: str, user_id: str, scopes: list[str], redirect_path: str, expires_at: str, connector_id: str = "google_calendar") -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM connector_oauth_states WHERE expires_at <= ?", (utc_now(),))
            connection.execute(
                "INSERT INTO connector_oauth_states (state_hash, user_id, connector_id, scopes_json, redirect_path, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (state_hash, user_id, connector_id, json.dumps(scopes), redirect_path, utc_now(), expires_at),
            )

    def consume_connector_oauth_state(self, state_hash: str, user_id: str, connector_id: str | None = None) -> dict[str, object] | None:
        with self.connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM connector_oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ?",
                (state_hash, user_id, utc_now()),
            ).fetchone()
            if row is None or (connector_id is not None and row["connector_id"] != connector_id):
                return None
            connection.execute("DELETE FROM connector_oauth_states WHERE state_hash = ?", (state_hash,))
        return {"connector_id": row["connector_id"], "scopes": json.loads(row["scopes_json"]), "redirect_path": row["redirect_path"]}

    def store_connector_credentials(self, user_id: str, connector_id: str, encrypted_payload: str) -> None:
        with self.connection() as connection:
            connection.execute(
                """INSERT INTO connector_credentials (user_id, connector_id, encrypted_payload, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, connector_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at""",
                (user_id, connector_id, encrypted_payload, utc_now()),
            )

    def get_connector_credentials(self, user_id: str, connector_id: str) -> str | None:
        with self.connection() as connection:
            row = connection.execute("SELECT encrypted_payload FROM connector_credentials WHERE user_id = ? AND connector_id = ?", (user_id, connector_id)).fetchone()
        return row["encrypted_payload"] if row else None

    def delete_connector_credentials(self, user_id: str, connector_id: str) -> None:
        with self.connection() as connection:
            connection.execute("DELETE FROM connector_credentials WHERE user_id = ? AND connector_id = ?", (user_id, connector_id))

    def create_mcp_server(self, server_id: str, user_id: str, name: str, url: str, encrypted_auth_token: str | None) -> None:
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO mcp_servers (id, user_id, name, url, encrypted_auth_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (server_id, user_id, name, url, encrypted_auth_token, utc_now(), utc_now()),
            )

    def list_mcp_servers(self, user_id: str) -> list[dict[str, object]]:
        with self.connection() as connection:
            rows = connection.execute("SELECT * FROM mcp_servers WHERE user_id = ? ORDER BY created_at, id", (user_id,)).fetchall()
        return [dict(row) for row in rows]

    def get_mcp_server(self, user_id: str, server_id: str) -> dict[str, object] | None:
        with self.connection() as connection:
            row = connection.execute("SELECT * FROM mcp_servers WHERE user_id = ? AND id = ?", (user_id, server_id)).fetchone()
        return dict(row) if row else None

    def update_mcp_server_tools(self, user_id: str, server_id: str, tools: list[dict[str, object]], status: str = "ready", error: str | None = None) -> bool:
        with self.connection() as connection:
            existing = connection.execute(
                "SELECT approved_tools_json FROM mcp_servers WHERE user_id = ? AND id = ?", (user_id, server_id),
            ).fetchone()
            if existing is None:
                return False
            safe_names = {item.get("name") for item in tools if item.get("access") == "read"}
            approved = [name for name in json.loads(existing["approved_tools_json"]) if name in safe_names]
            cursor = connection.execute(
                "UPDATE mcp_servers SET discovered_tools_json = ?, approved_tools_json = ?, status = ?, last_checked_at = ?, last_error = ?, updated_at = ? WHERE user_id = ? AND id = ?",
                (json.dumps(tools), json.dumps(approved), status, utc_now(), error, utc_now(), user_id, server_id),
            )
        return cursor.rowcount == 1

    def set_mcp_server_approved_tools(self, user_id: str, server_id: str, names: list[str]) -> bool:
        with self.connection() as connection:
            cursor = connection.execute(
                "UPDATE mcp_servers SET approved_tools_json = ?, updated_at = ? WHERE user_id = ? AND id = ?",
                (json.dumps(names), utc_now(), user_id, server_id),
            )
        return cursor.rowcount == 1

    def delete_mcp_server(self, user_id: str, server_id: str) -> bool:
        with self.connection() as connection:
            connection.execute(
                "DELETE FROM conversation_connectors WHERE user_id = ? AND connector_id = ?",
                (user_id, f"mcp:{server_id}"),
            )
            cursor = connection.execute("DELETE FROM mcp_servers WHERE user_id = ? AND id = ?", (user_id, server_id))
        return cursor.rowcount == 1

    def create_conversation(self, title: str, owner_id: str = "local-user") -> ConversationRead:
        conversation_id = str(uuid4())
        timestamp = utc_now()
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?)",
                (conversation_id, title.strip(), timestamp, timestamp, owner_id),
            )
        return ConversationRead(id=conversation_id, title=title.strip(), created_at=timestamp, updated_at=timestamp)

    def list_conversations(self, owner_id: str = "local-user") -> list[ConversationRead]:
        with self.connection() as connection:
            rows = connection.execute(
                """SELECT c.*, COUNT(m.id) AS message_count
                   FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
                   WHERE c.owner_id = ? GROUP BY c.id ORDER BY c.updated_at DESC""",
                (owner_id,),
            ).fetchall()
        return [ConversationRead(**dict(row)) for row in rows]

    def get_conversation(self, conversation_id: str, owner_id: str = "local-user") -> ConversationRead | None:
        with self.connection() as connection:
            row = connection.execute(
                """SELECT c.*, COUNT(m.id) AS message_count
                   FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
                   WHERE c.id = ? AND c.owner_id = ? GROUP BY c.id""",
                (conversation_id, owner_id),
            ).fetchone()
        return ConversationRead(**dict(row)) if row else None

    def rename_conversation(self, conversation_id: str, title: str, owner_id: str = "local-user") -> ConversationRead | None:
        with self.connection() as connection:
            cursor = connection.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
                (title.strip(), utc_now(), conversation_id, owner_id),
            )
            if cursor.rowcount == 0:
                return None
        return self.get_conversation(conversation_id, owner_id)

    def delete_conversation(self, conversation_id: str, owner_id: str = "local-user") -> bool:
        with self.connection() as connection:
            cursor = connection.execute("DELETE FROM conversations WHERE id = ? AND owner_id = ?", (conversation_id, owner_id))
        return cursor.rowcount > 0

    def create_message(self, conversation_id: str, role: str, content: str, execution_id: str | None = None) -> MessageRead:
        message_id = str(uuid4())
        timestamp = utc_now()
        with self.connection() as connection:
            connection.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at, execution_id) VALUES (?, ?, ?, ?, ?, ?)",
                (message_id, conversation_id, role, content, timestamp, execution_id),
            )
            connection.execute(
                """UPDATE conversations SET updated_at = ?,
                   title = CASE WHEN title = 'Nouvelle conversation' AND ? = 'user'
                     THEN substr(?, 1, 52) ELSE title END
                   WHERE id = ?""",
                (timestamp, role, content.strip(), conversation_id),
            )
        return MessageRead(id=message_id, conversation_id=conversation_id, role=role, content=content, created_at=timestamp, execution_id=execution_id)

    def list_messages(self, conversation_id: str) -> list[MessageRead]:
        with self.connection() as connection:
            rows = connection.execute(
                "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
                (conversation_id,),
            ).fetchall()
        return [MessageRead(**dict(row)) for row in rows]

    def get_user_analytics(self, user_id: str) -> dict[str, object]:
        with self.connection() as connection:
            conversations = connection.execute("SELECT COUNT(*) FROM conversations WHERE owner_id = ?", (user_id,)).fetchone()[0]
            execution_counts = connection.execute(
                "SELECT status, COUNT(*) AS count FROM executions WHERE user_id = ? GROUP BY status", (user_id,)
            ).fetchall()
            task_counts = connection.execute(
                "SELECT t.status, COUNT(*) AS count FROM execution_tasks t JOIN executions e ON e.id = t.execution_id WHERE t.user_id = ? AND e.user_id = ? GROUP BY t.status",
                (user_id, user_id),
            ).fetchall()
        executions_by_status = {row["status"]: row["count"] for row in execution_counts}
        tasks_by_status = {row["status"]: row["count"] for row in task_counts}
        total_tasks = sum(tasks_by_status.values())
        completed_tasks = tasks_by_status.get("completed", 0)
        return {
            "conversations": conversations,
            "executions": sum(executions_by_status.values()),
            "active_executions": sum(executions_by_status.get(key, 0) for key in ("planning", "running", "awaiting_approval")),
            "tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "task_completion_percent": round(completed_tasks * 100 / total_tasks) if total_tasks else 0,
            "execution_statuses": executions_by_status,
            "task_statuses": tasks_by_status,
        }

    def get_connector_connection(self, user_id: str, connector_id: str) -> dict[str, object] | None:
        with self.connection() as connection:
            row = connection.execute(
                "SELECT * FROM connector_connections WHERE user_id = ? AND connector_id = ?",
                (user_id, connector_id),
            ).fetchone()
        if row is None:
            return None
        return {
            "status": row["status"],
            "granted_scopes": json.loads(row["granted_scopes_json"]),
            "error_message": row["error_message"],
        }

    def has_other_connected_google_connector(self, user_id: str, connector_id: str) -> bool:
        google_ids = ("gmail", "google_drive", "google_calendar")
        placeholders = ",".join("?" for _ in google_ids)
        with self.connection() as connection:
            row = connection.execute(
                f"SELECT 1 FROM connector_connections WHERE user_id = ? AND connector_id IN ({placeholders}) AND connector_id != ? AND status = 'connected' LIMIT 1",
                (user_id, *google_ids, connector_id),
            ).fetchone()
        return row is not None

    def set_connector_connection(
        self,
        user_id: str,
        connector_id: str,
        status: str,
        granted_scopes: list[str] | None = None,
        error_message: str | None = None,
    ) -> None:
        """Persist connector state and scopes without accepting or storing credentials."""
        with self.connection() as connection:
            connection.execute(
                """INSERT INTO connector_connections
                   (user_id, connector_id, status, granted_scopes_json, error_message, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(user_id, connector_id) DO UPDATE SET
                     status = excluded.status, granted_scopes_json = excluded.granted_scopes_json,
                     error_message = excluded.error_message, updated_at = excluded.updated_at""",
                (user_id, connector_id, status, json.dumps(granted_scopes or []), error_message, utc_now()),
            )

    def get_conversation_connector_ids(self, user_id: str, conversation_id: str) -> list[str]:
        with self.connection() as connection:
            rows = connection.execute(
                """SELECT cc.connector_id FROM conversation_connectors cc
                   JOIN conversations c ON c.id = cc.conversation_id
                   WHERE cc.user_id = ? AND cc.conversation_id = ? AND c.owner_id = ?
                   ORDER BY cc.connector_id""",
                (user_id, conversation_id, user_id),
            ).fetchall()
        return [row["connector_id"] for row in rows]

    def set_conversation_connector_ids(
        self,
        user_id: str,
        conversation_id: str,
        connector_ids: list[str],
    ) -> bool:
        with self.connection() as connection:
            owner = connection.execute(
                "SELECT 1 FROM conversations WHERE id = ? AND owner_id = ?",
                (conversation_id, user_id),
            ).fetchone()
            if owner is None:
                return False
            connection.execute(
                "DELETE FROM conversation_connectors WHERE user_id = ? AND conversation_id = ?",
                (user_id, conversation_id),
            )
            connection.executemany(
                "INSERT INTO conversation_connectors (user_id, conversation_id, connector_id) VALUES (?, ?, ?)",
                [(user_id, conversation_id, connector_id) for connector_id in connector_ids],
            )
        return True
