import asyncio
import json
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

_THEME_XOR = 0x5A


def parse_theme(hex_string: str) -> str:
    result = ""
    for i in range(0, len(hex_string), 2):
        result += chr(int(hex_string[i : i + 2], 16) ^ _THEME_XOR)
    return result


def serialize_theme(plaintext: str) -> str:
    result = ""
    for ch in plaintext:
        result += format(ord(ch) ^ _THEME_XOR, "02x")
    return result


def encrypt_payload(data: dict[str, Any]) -> dict[str, str]:
    return {"d": serialize_theme(json.dumps(data, separators=(",", ":")))}


@dataclass
class CaptchaRequest:
    request_id: str
    site_key: str = ""
    action: str = ""
    created_at: float = field(default_factory=time.time)
    resolved: bool = False
    token: str | None = None
    error: str | None = None


@dataclass
class ExtensionSession:
    ext_id: str
    last_seen: float = field(default_factory=time.time)
    flow_tab_status: str = "closed"
    grok_tab_status: str = "closed"
    token_count: int = 0
    user_agent: str = ""
    platform: str = ""


class AuthBridge:
    """Bridge server compatible with G-Labs Auth Helper Chrome extension.

    Extension polls http://127.0.0.1:18923/sync/* every ~1.5s.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, ExtensionSession] = {}
        self._captcha_pending: dict[str, CaptchaRequest] = {}
        self._captcha_waiters: dict[str, asyncio.Future[CaptchaRequest]] = {}
        self._grok_tasks: list[dict[str, Any]] = []
        self._started_at = time.time()

    @property
    def uptime(self) -> int:
        return int(time.time() - self._started_at)

    def touch(
        self,
        ext_id: str,
        flow_tab: str | None = None,
        grok_tab: str | None = None,
    ) -> ExtensionSession:
        session = self._sessions.get(ext_id)
        if session is None:
            session = ExtensionSession(ext_id=ext_id)
            self._sessions[ext_id] = session
        session.last_seen = time.time()
        if flow_tab:
            session.flow_tab_status = flow_tab
        if grok_tab:
            session.grok_tab_status = grok_tab
        return session

    def get_primary_session(self) -> ExtensionSession | None:
        if not self._sessions:
            return None
        return max(self._sessions.values(), key=lambda s: s.last_seen)

    def is_connected(self, max_age_seconds: int = 30) -> bool:
        session = self.get_primary_session()
        if not session:
            return False
        return (time.time() - session.last_seen) < max_age_seconds

    def status_payload(self) -> dict[str, Any]:
        session = self.get_primary_session()
        return {
            "connected": self.is_connected(),
            "uptime": self.uptime,
            "extensions": len(self._sessions),
            "flow_tab": session.flow_tab_status if session else "closed",
            "grok_tab": session.grok_tab_status if session else "closed",
            "token_count": session.token_count if session else 0,
            "pending_captcha": sum(1 for r in self._captcha_pending.values() if not r.resolved),
        }

    def queue_captcha(self, site_key: str = "", action: str = "") -> CaptchaRequest:
        request = CaptchaRequest(
            request_id=secrets.token_hex(8),
            site_key=site_key,
            action=action,
        )
        self._captcha_pending[request.request_id] = request
        return request

    def get_pending_captcha(self) -> CaptchaRequest | None:
        for request in self._captcha_pending.values():
            if not request.resolved:
                return request
        return None

    def theme_response(self) -> dict[str, Any]:
        pending = self.get_pending_captcha()
        if pending is None:
            return encrypt_payload({})
        return encrypt_payload(
            {
                "r": pending.request_id,
                "s": pending.site_key,
                "a": pending.action,
            }
        )

    def submit_render(self, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("r", ""))
        token = payload.get("t")
        error = payload.get("e")
        user_agent = payload.get("u", "")
        platform = payload.get("p", "")

        request = self._captcha_pending.get(request_id)
        if request is None:
            return

        request.resolved = True
        request.token = token
        request.error = error

        session = self.get_primary_session()
        if session and token:
            session.token_count += 1
            session.user_agent = user_agent or session.user_agent
            session.platform = platform or session.platform

        waiter = self._captcha_waiters.pop(request_id, None)
        if waiter and not waiter.done():
            waiter.set_result(request)

    async def wait_for_captcha(self, request_id: str, timeout: float = 120.0) -> CaptchaRequest:
        request = self._captcha_pending.get(request_id)
        if request is None:
            raise RuntimeError(f"Captcha request {request_id} not found")
        if request.resolved:
            return request

        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._captcha_waiters[request_id] = future
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._captcha_waiters.pop(request_id, None)


auth_bridge = AuthBridge()