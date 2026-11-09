import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE executions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL);
            CREATE TABLE execution_artifacts (
                id TEXT PRIMARY KEY,
                execution_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def _run(*args: str, database_path: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "DATABASE_PATH": str(database_path)}
    return subprocess.run(
        [sys.executable, "-m", "app.db_maintenance", *args],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def test_backup_and_restore_round_trip_sqlite_database(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    backup = tmp_path / "snapshots" / "backup.sqlite3"
    restored = tmp_path / "restored.sqlite3"
    _database(source)
    with sqlite3.connect(source) as connection:
        connection.execute("INSERT INTO executions VALUES ('exec-1', 'user-1', 'completed')")

    backup_result = _run("backup", "--destination", str(backup), database_path=source)
    restore_result = _run("restore", "--source", str(backup), "--destination", str(restored), database_path=source)

    assert backup_result.returncode == 0, backup_result.stderr
    assert restore_result.returncode == 0, restore_result.stderr
    with sqlite3.connect(restored) as connection:
        assert connection.execute("SELECT id FROM executions").fetchone() == ("exec-1",)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)


def test_restore_refuses_to_replace_existing_database(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    destination = tmp_path / "destination.sqlite3"
    _database(source)
    _database(destination)
    with sqlite3.connect(source) as connection:
        connection.execute("INSERT INTO executions VALUES ('source', 'user-1', 'completed')")
    with sqlite3.connect(destination) as connection:
        connection.execute("INSERT INTO executions VALUES ('keep', 'user-1', 'completed')")

    assert _run("backup", "--destination", str(backup), database_path=source).returncode == 0
    result = _run("restore", "--source", str(backup), "--destination", str(destination), database_path=source)

    assert result.returncode != 0
    with sqlite3.connect(destination) as connection:
        assert connection.execute("SELECT id FROM executions").fetchone() == ("keep",)


def test_artifact_purge_previews_by_default_and_only_deletes_terminal_runs(tmp_path: Path) -> None:
    database = tmp_path / "database.sqlite3"
    old = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    _database(database)
    with sqlite3.connect(database) as connection:
        connection.executemany(
            "INSERT INTO executions VALUES (?, 'user-1', ?)",
            [("done", "completed"), ("active", "running")],
        )
        connection.executemany(
            "INSERT INTO execution_artifacts VALUES (?, ?, 'user-1', ?)",
            [("old-done", "done", old), ("old-active", "active", old)],
        )

    preview = _run("prune-artifacts", "--retention-days", "30", database_path=database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT COUNT(*) FROM execution_artifacts").fetchone() == (2,)

    applied = _run("prune-artifacts", "--retention-days", "30", "--apply", database_path=database)
    with sqlite3.connect(database) as connection:
        remaining = connection.execute("SELECT id FROM execution_artifacts ORDER BY id").fetchall()

    assert preview.returncode == 0, preview.stderr
    assert "1" in preview.stdout
    assert applied.returncode == 0, applied.stderr
    assert remaining == [("old-active",)]
