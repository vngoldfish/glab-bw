"""Track session/cookie health for operator UI."""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class SessionHealth:
    flow_session_ok: bool = True
    grok_session_ok: bool = True
    last_flow_error: str | None = None
    last_grok_error: str | None = None
    last_flow_error_at: float | None = None
    last_grok_error_at: float | None = None
    # account ids recently marked stale → monotonic timestamp
    stale_account_ids: dict[str, float] = field(default_factory=dict)

    def mark_flow_ok(self, account_id: str | None = None) -> None:
        self.flow_session_ok = True
        self.last_flow_error = None
        if account_id:
            self.stale_account_ids.pop(account_id, None)

    def mark_flow_stale(self, message: str, account_id: str | None = None) -> None:
        self.flow_session_ok = False
        self.last_flow_error = (message or "Flow session stale")[:300]
        self.last_flow_error_at = time.time()
        if account_id:
            self.stale_account_ids[account_id] = time.monotonic()

    def mark_grok_ok(self, account_id: str | None = None) -> None:
        self.grok_session_ok = True
        self.last_grok_error = None
        if account_id:
            self.stale_account_ids.pop(account_id, None)

    def mark_grok_stale(self, message: str, account_id: str | None = None) -> None:
        self.grok_session_ok = False
        self.last_grok_error = (message or "Grok session stale")[:300]
        self.last_grok_error_at = time.time()
        if account_id:
            self.stale_account_ids[account_id] = time.monotonic()

    def _cleanup_stale(self) -> None:
        """Remove stale account entries older than 1 hour."""
        cutoff = time.monotonic() - 3600
        expired = [aid for aid, ts in self.stale_account_ids.items() if ts < cutoff]
        for aid in expired:
            del self.stale_account_ids[aid]

    def payload(self) -> dict:
        self._cleanup_stale()
        return {
            "flow_session_ok": self.flow_session_ok,
            "grok_session_ok": self.grok_session_ok,
            "last_flow_error": self.last_flow_error,
            "last_grok_error": self.last_grok_error,
            "last_flow_error_at": self.last_flow_error_at,
            "last_grok_error_at": self.last_grok_error_at,
            "stale_accounts": len(self.stale_account_ids),
            "hint": (
                None
                if self.flow_session_ok
                else "Cookie/session Flow có thể hết hạn — Settings → dán lại session-token"
            ),
        }


session_health = SessionHealth()
