"""Multi-user API key management with SQLite storage.

Each key has: name, rate limit, daily quota, permissions, and expiry.
Keys are stored as SHA-256 hashes — the raw key is only shown once at creation.
"""

import hashlib
import json
import logging
import secrets
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

_DB_PATH = settings.data_dir / "api_keys.db"
_KEY_PREFIX = "glbw_sk_"


@dataclass
class ApiKeyInfo:
    """Represents a verified API key with its metadata."""

    key_id: str
    name: str
    created_at: float
    expires_at: float | None
    is_active: bool
    rate_limit: int  # requests per minute
    daily_quota: int  # requests per day
    permissions: list[str] = field(default_factory=lambda: ["image", "video"])


class ApiKeyStore:
    def __init__(self, db_path: Path | None = None) -> None:
        self._db_path = db_path or _DB_PATH
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        return conn

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS api_keys (
                    key_id       TEXT PRIMARY KEY,
                    key_hash     TEXT NOT NULL UNIQUE,
                    name         TEXT NOT NULL DEFAULT '',
                    created_at   REAL NOT NULL,
                    expires_at   REAL,
                    is_active    INTEGER NOT NULL DEFAULT 1,
                    rate_limit   INTEGER NOT NULL DEFAULT 30,
                    daily_quota  INTEGER NOT NULL DEFAULT 500,
                    permissions  TEXT NOT NULL DEFAULT '["image","video"]'
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS api_usage (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    key_id      TEXT NOT NULL,
                    endpoint    TEXT NOT NULL DEFAULT '',
                    provider    TEXT NOT NULL DEFAULT '',
                    task_type   TEXT NOT NULL DEFAULT '',
                    status      TEXT NOT NULL DEFAULT 'pending',
                    prompt      TEXT NOT NULL DEFAULT '',
                    task_id     TEXT NOT NULL DEFAULT '',
                    created_at  REAL NOT NULL,
                    completed_at REAL,
                    FOREIGN KEY (key_id) REFERENCES api_keys(key_id)
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_usage_key_date
                ON api_usage (key_id, created_at)
            """)

    @staticmethod
    def _hash_key(raw_key: str) -> str:
        return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()

    def create_key(
        self,
        name: str,
        rate_limit: int = 30,
        daily_quota: int = 500,
        permissions: list[str] | None = None,
        expires_at: float | None = None,
    ) -> tuple[str, str]:
        """Create a new API key. Returns (key_id, raw_key). Raw key shown only once."""
        if permissions is None:
            permissions = ["image", "video", "workflow"]

        raw_secret = secrets.token_urlsafe(32)
        raw_key = f"{_KEY_PREFIX}{raw_secret}"
        key_hash = self._hash_key(raw_key)
        key_id = f"glbw_{secrets.token_hex(6)}"

        with self._conn() as conn:
            conn.execute(
                """INSERT INTO api_keys
                   (key_id, key_hash, name, created_at, expires_at, is_active, rate_limit, daily_quota, permissions)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)""",
                (
                    key_id,
                    key_hash,
                    name.strip(),
                    time.time(),
                    expires_at,
                    max(1, rate_limit),
                    max(1, daily_quota),
                    json.dumps(permissions),
                ),
            )

        logger.info("Created API key %s for '%s'", key_id, name)
        return key_id, raw_key

    def verify_key(self, raw_key: str) -> ApiKeyInfo | None:
        """Verify a raw API key. Returns ApiKeyInfo if valid, None otherwise."""
        if not raw_key or not raw_key.startswith(_KEY_PREFIX):
            return None

        key_hash = self._hash_key(raw_key)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,)
            ).fetchone()

        if not row:
            return None
        if not row["is_active"]:
            return None
        if row["expires_at"] and row["expires_at"] < time.time():
            return None

        return ApiKeyInfo(
            key_id=row["key_id"],
            name=row["name"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
            is_active=bool(row["is_active"]),
            rate_limit=row["rate_limit"],
            daily_quota=row["daily_quota"],
            permissions=json.loads(row["permissions"] or "[]"),
        )

    def revoke_key(self, key_id: str) -> bool:
        """Deactivate an API key."""
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE api_keys SET is_active = 0 WHERE key_id = ?", (key_id,)
            )
        revoked = cur.rowcount > 0
        if revoked:
            logger.info("Revoked API key %s", key_id)
        return revoked

    def delete_key(self, key_id: str) -> bool:
        """Permanently delete an API key and its usage history."""
        with self._conn() as conn:
            conn.execute("DELETE FROM api_usage WHERE key_id = ?", (key_id,))
            cur = conn.execute("DELETE FROM api_keys WHERE key_id = ?", (key_id,))
        return cur.rowcount > 0

    def list_keys(self) -> list[dict[str, Any]]:
        """List all API keys (masked, no hash)."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT key_id, name, created_at, expires_at, is_active, "
                "rate_limit, daily_quota, permissions FROM api_keys ORDER BY created_at DESC"
            ).fetchall()

        result = []
        for row in rows:
            result.append({
                "key_id": row["key_id"],
                "name": row["name"],
                "created_at": row["created_at"],
                "expires_at": row["expires_at"],
                "is_active": bool(row["is_active"]),
                "rate_limit": row["rate_limit"],
                "daily_quota": row["daily_quota"],
                "permissions": json.loads(row["permissions"] or "[]"),
            })
        return result

    def update_key(
        self,
        key_id: str,
        name: str | None = None,
        rate_limit: int | None = None,
        daily_quota: int | None = None,
        permissions: list[str] | None = None,
        is_active: bool | None = None,
    ) -> bool:
        """Update API key settings."""
        updates: list[str] = []
        params: list[Any] = []

        if name is not None:
            updates.append("name = ?")
            params.append(name.strip())
        if rate_limit is not None:
            updates.append("rate_limit = ?")
            params.append(max(1, rate_limit))
        if daily_quota is not None:
            updates.append("daily_quota = ?")
            params.append(max(1, daily_quota))
        if permissions is not None:
            updates.append("permissions = ?")
            params.append(json.dumps(permissions))
        if is_active is not None:
            updates.append("is_active = ?")
            params.append(int(is_active))

        if not updates:
            return False

        params.append(key_id)
        with self._conn() as conn:
            cur = conn.execute(
                f"UPDATE api_keys SET {', '.join(updates)} WHERE key_id = ?",
                tuple(params),
            )
        return cur.rowcount > 0

    # ── Usage tracking ─────────────────────────────────────────────────────

    def record_usage(
        self,
        key_id: str,
        endpoint: str,
        provider: str = "",
        task_type: str = "",
        status: str = "pending",
        prompt: str = "",
        task_id: str = "",
    ) -> int:
        """Record an API usage event. Returns the usage row ID."""
        with self._conn() as conn:
            cur = conn.execute(
                """INSERT INTO api_usage
                   (key_id, endpoint, provider, task_type, status, prompt, task_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (key_id, endpoint, provider, task_type, status, prompt[:200], task_id, time.time()),
            )
            return cur.lastrowid or 0

    def update_usage_status(self, task_id: str, status: str) -> None:
        """Update usage record when task completes or fails."""
        with self._conn() as conn:
            conn.execute(
                "UPDATE api_usage SET status = ?, completed_at = ? WHERE task_id = ?",
                (status, time.time(), task_id),
            )

    def get_daily_count(self, key_id: str) -> int:
        """Count API calls today for rate limit check."""
        today_start = time.time() - (time.time() % 86400)
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM api_usage WHERE key_id = ? AND created_at >= ?",
                (key_id, today_start),
            ).fetchone()
        return row["cnt"] if row else 0

    def get_minute_count(self, key_id: str) -> int:
        """Count API calls in the last 60 seconds."""
        one_minute_ago = time.time() - 60
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM api_usage WHERE key_id = ? AND created_at >= ?",
                (key_id, one_minute_ago),
            ).fetchone()
        return row["cnt"] if row else 0

    def get_usage_summary(self, key_id: str, days: int = 30) -> list[dict]:
        """Get daily usage summary for the last N days."""
        cutoff = time.time() - (days * 86400)
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT
                     DATE(created_at, 'unixepoch') as day,
                     COUNT(*) as total,
                     SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                     SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
                   FROM api_usage
                   WHERE key_id = ? AND created_at >= ?
                   GROUP BY day ORDER BY day DESC""",
                (key_id, cutoff),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_usage_recent(self, key_id: str, limit: int = 50) -> list[dict]:
        """Get recent usage records for a key."""
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT endpoint, provider, task_type, status, prompt, task_id,
                          created_at, completed_at
                   FROM api_usage
                   WHERE key_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (key_id, limit),
            ).fetchall()
        return [dict(r) for r in rows]


# Singleton
api_key_store = ApiKeyStore()
