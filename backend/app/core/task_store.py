"""SQLite persistence for task queue (survives backend restart)."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class TaskStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    task_type TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    completed_at REAL,
                    results TEXT,
                    error_code INTEGER DEFAULT 0,
                    error TEXT DEFAULT '',
                    error_detail TEXT DEFAULT ''
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC)"
            )
            conn.commit()

    def upsert(
        self,
        *,
        task_id: str,
        task_type: str,
        prompt: str,
        payload: dict[str, Any],
        status: str,
        created_at: float,
        completed_at: float | None = None,
        results: list[str] | None = None,
        error_code: int = 0,
        error: str = "",
        error_detail: str = "",
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO tasks (
                    task_id, task_type, prompt, payload, status,
                    created_at, completed_at, results, error_code, error, error_detail
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    status=excluded.status,
                    completed_at=excluded.completed_at,
                    results=excluded.results,
                    error_code=excluded.error_code,
                    error=excluded.error,
                    error_detail=excluded.error_detail
                """,
                (
                    task_id,
                    task_type,
                    prompt,
                    json.dumps(payload, ensure_ascii=False),
                    status,
                    created_at,
                    completed_at,
                    json.dumps(results or [], ensure_ascii=False),
                    error_code,
                    error or "",
                    error_detail or "",
                ),
            )
            conn.commit()

    def load_recent(self, limit: int = 200) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT * FROM tasks
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            out.append(
                {
                    "task_id": row["task_id"],
                    "task_type": row["task_type"],
                    "prompt": row["prompt"],
                    "payload": json.loads(row["payload"] or "{}"),
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "completed_at": row["completed_at"],
                    "results": json.loads(row["results"] or "[]"),
                    "error_code": row["error_code"] or 0,
                    "error": row["error"] or "",
                    "error_detail": row["error_detail"] or "",
                }
            )
        return out

    def mark_interrupted_running(self) -> int:
        """On startup: running tasks were killed — mark failed so UI is truthful."""
        now = time.time()
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE tasks
                SET status='failed',
                    completed_at=?,
                    error_code=0,
                    error='Backend restarted while task was running',
                    error_detail='Interrupted by process restart'
                WHERE status='running'
                """,
                (now,),
            )
            conn.commit()
            return cur.rowcount
