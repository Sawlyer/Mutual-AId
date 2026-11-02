"""Safe operator commands for SQLite backups and artifact retention."""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

TERMINAL_EXECUTION_STATUSES = ("completed", "partial", "failed", "cancelled", "interrupted")


def _existing_file(path: Path, description: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"{description} not found: {resolved}")
    return resolved


def _integrity_check(path: Path) -> None:
    uri = f"{path.as_uri()}?mode=ro"
    with sqlite3.connect(uri, uri=True, timeout=10) as connection:
        result = connection.execute("PRAGMA integrity_check").fetchone()
    if result is None or result[0] != "ok":
        detail = result[0] if result else "no result"
        raise ValueError(f"SQLite integrity check failed for {path}: {detail}")


def _copy_snapshot(source: Path, destination: Path) -> Path:
    source = _existing_file(source, "SQLite source")
    destination = destination.expanduser().resolve()
    if source == destination:
        raise ValueError("Source and destination must be different files")
    if destination.exists() or Path(f"{destination}-wal").exists() or Path(f"{destination}-shm").exists():
        raise FileExistsError(f"Destination or SQLite sidecar already exists: {destination}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    os.close(descriptor)
    try:
        source_uri = f"{source.as_uri()}?mode=ro"
        with sqlite3.connect(source_uri, uri=True, timeout=10) as source_connection:
            with sqlite3.connect(temporary, timeout=10) as destination_connection:
                source_connection.backup(destination_connection)
        _integrity_check(temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
        _integrity_check(destination)
        return destination
    finally:
        temporary.unlink(missing_ok=True)
        Path(f"{temporary}-wal").unlink(missing_ok=True)
        Path(f"{temporary}-shm").unlink(missing_ok=True)


def backup_database(source: Path, destination: Path) -> Path:
    """Create a consistent snapshot without overwriting an existing backup."""
    source = _existing_file(source, "SQLite database")
    _integrity_check(source)
    return _copy_snapshot(source, destination)


def restore_database(source: Path, destination: Path) -> Path:
    """Restore a validated snapshot to a new path, never replacing a live database."""
    source = _existing_file(source, "SQLite backup")
    _integrity_check(source)
    return _copy_snapshot(source, destination)


def prune_artifacts(
    database_path: Path,
    retention_days: int,
    *,
    apply: bool = False,
    now: datetime | None = None,
) -> int:
    """Count or delete expired artifacts belonging to terminal executions only."""
    if retention_days < 1 or retention_days > 3650:
        raise ValueError("retention-days must be between 1 and 3650")
    database_path = _existing_file(database_path, "SQLite database")
    current_time = now or datetime.now(timezone.utc)
    if current_time.tzinfo is None:
        raise ValueError("now must include a timezone")
    cutoff = (current_time.astimezone(timezone.utc) - timedelta(days=retention_days)).isoformat()
    terminal_placeholders = ", ".join("?" for _ in TERMINAL_EXECUTION_STATUSES)
    parameters = (*TERMINAL_EXECUTION_STATUSES, cutoff)

    with sqlite3.connect(database_path, timeout=10) as connection:
        connection.execute("PRAGMA busy_timeout = 10000")
        connection.execute("BEGIN IMMEDIATE")
        count = connection.execute(
            f"""SELECT COUNT(*) FROM execution_artifacts AS artifact
                JOIN executions AS execution
                  ON execution.id = artifact.execution_id AND execution.user_id = artifact.user_id
                WHERE execution.status IN ({terminal_placeholders}) AND artifact.created_at < ?""",
            parameters,
        ).fetchone()[0]
        if apply and count:
            connection.execute(
                f"""DELETE FROM execution_artifacts
                    WHERE EXISTS (
                      SELECT 1 FROM executions AS execution
                      WHERE execution.id = execution_artifacts.execution_id
                        AND execution.user_id = execution_artifacts.user_id
                        AND execution.status IN ({terminal_placeholders})
                    ) AND created_at < ?""",
                parameters,
            )
        if apply:
            connection.commit()
        else:
            connection.rollback()
    return int(count)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safe SQLite backup and artifact retention commands")
    subparsers = parser.add_subparsers(dest="command", required=True)

    backup = subparsers.add_parser("backup", help="create a SQLite-consistent backup")
    backup.add_argument("--destination", type=Path, required=True)

    restore = subparsers.add_parser("restore", help="restore a validated backup to a new file")
    restore.add_argument("--source", type=Path, required=True)
    restore.add_argument("--destination", type=Path, required=True)

    prune = subparsers.add_parser("prune-artifacts", help="preview or apply artifact retention")
    prune.add_argument("--retention-days", type=int, required=True)
    prune.add_argument("--apply", action="store_true", help="delete the artifacts shown in the preview")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    from app.config import Settings

    database_path = Settings().database_path
    try:
        if args.command == "backup":
            result = backup_database(database_path, args.destination)
            print(f"SQLite backup created and validated: {result}")
        elif args.command == "restore":
            result = restore_database(args.source, args.destination)
            print(f"SQLite backup restored and validated at new path: {result}")
            print("Set DATABASE_PATH to this file after stopping the application.")
        else:
            count = prune_artifacts(database_path, args.retention_days, apply=args.apply)
            if args.apply:
                print(f"Deleted {count} expired artifact(s).")
            else:
                print(f"{count} artifact(s) would be deleted. Re-run with --apply to remove them.")
        return 0
    except (FileExistsError, FileNotFoundError, OSError, sqlite3.Error, ValueError) as error:
        print(f"Database maintenance failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
