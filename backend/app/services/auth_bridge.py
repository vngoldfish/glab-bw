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
        # Grok in-browser tasks (extension executes fetch on grok.com tab)
        self._grok_pending: dict[str, dict[str, Any]] = {}
        self._grok_waiters: dict[str, asyncio.Future[dict[str, Any]]] = {}
        # x-statsig-id scraped from grok.com tab (anti-bot) — no page reload
        self._statsig_id: str | None = None
        self._statsig_at: float = 0.0
        self._statsig_waiters: list[asyncio.Future[str | None]] = []
        self._statsig_wanted: bool = False
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
            "pending_grok": sum(
                1 for t in self._grok_pending.values() if not t.get("resolved")
            ),
            "statsig_wanted": self._statsig_wanted,
            "has_statsig": bool(self._statsig_id),
        }

    def set_statsig_id(self, statsig_id: str | None) -> None:
        """Store scraped x-statsig-id from browser (extension-grok or helper)."""
        val = (statsig_id or "").strip()
        if not val:
            return
        self._statsig_id = val
        self._statsig_at = time.time()
        self._statsig_wanted = False
        waiters = list(self._statsig_waiters)
        self._statsig_waiters.clear()
        for fut in waiters:
            if not fut.done():
                fut.set_result(val)

    def get_statsig_id(self, max_age: float = 300.0) -> str | None:
        if not self._statsig_id:
            return None
        if time.time() - self._statsig_at > max_age:
            return None
        return self._statsig_id

    async def wait_for_statsig(self, timeout: float = 15.0) -> str | None:
        """Ask extensions to scrape localStorage; wait briefly for a token."""
        cached = self.get_statsig_id()
        if cached:
            return cached
        self._statsig_wanted = True
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[str | None] = loop.create_future()
        self._statsig_waiters.append(fut)
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except TimeoutError:
            self._statsig_wanted = False
            return self.get_statsig_id()
        finally:
            if fut in self._statsig_waiters:
                self._statsig_waiters.remove(fut)

    # ── Grok tasks for official "G-Labs Automation - Auth Helper" ──
    # Protocol (ext v7+):
    #   theme: { g: 1 } when pending
    #   poll:  { task: { id, kind: "gfetch"|"gws"|"get_creds", payload: {...} } }
    #   event: { d: xor({ id, event, data }) }  event=chunk|done|error|ws_*

    def queue_grok_task(
        self,
        *,
        method: str = "POST",
        url: str,
        headers: dict[str, str] | None = None,
        body: Any = None,
        kind: str = "gfetch",
        response_mode: str = "stream",
        timeout_ms: int = 180_000,
        inject_statsig: bool = True,
        payload_extra: dict[str, Any] | None = None,
    ) -> str:
        """Enqueue a task for Auth Helper (_resolveFtJob).

        kind:
          - gfetch: HTTP fetch in grok.com page (payload.url/method/headers/body string)
          - gws: WebSocket stream
          - get_creds: return browser cookie jar
        """
        task_id = secrets.token_hex(8)
        # body must be STRING for gfetch (extension String(p.body))
        if body is None:
            body_str = None
        elif isinstance(body, str):
            body_str = body
        else:
            body_str = json.dumps(body, separators=(",", ":"))

        payload: dict[str, Any] = {
            "url": url,
            "method": method,
            "headers": headers or {},
            "body": body_str,
            "responseMode": response_mode,
            "timeoutMs": int(timeout_ms),
            "injectStatsig": bool(inject_statsig),
        }
        if payload_extra:
            payload.update(payload_extra)

        self._grok_pending[task_id] = {
            "id": task_id,
            "kind": kind,  # gfetch | gws | get_creds
            "payload": payload,
            "created_at": time.time(),
            "resolved": False,
            "dispatched": False,
            "chunks": [],
            "result": None,
            "error": None,
            "status_code": None,
        }
        return task_id

    def pop_grok_task(self) -> dict[str, Any] | None:
        """Return {task: {...}} for Auth Helper, or None."""
        now = time.time()
        pending = []
        for t in self._grok_pending.values():
            if t.get("resolved"):
                continue
            if not t.get("dispatched"):
                pending.append(t)
                continue
            if now - float(t.get("dispatched_at") or t.get("created_at") or 0) > 25:
                t["dispatched"] = False
                pending.append(t)
        if not pending:
            return None
        pending.sort(key=lambda t: t.get("created_at", 0))
        task = pending[0]
        task["dispatched"] = True
        task["dispatched_at"] = now
        return {
            "task": {
                "id": task["id"],
                "kind": task.get("kind") or "gfetch",
                "payload": task.get("payload") or {},
            }
        }

    def ingest_grok_event(
        self,
        task_id: str,
        event: str,
        data: Any = None,
    ) -> None:
        """Handle Auth Helper event stream: chunk / done / error / …"""
        task = self._grok_pending.get(task_id)
        if task is None:
            return
        event = (event or "").lower()
        data = data if isinstance(data, dict) else ({} if data is None else {"value": data})

        if event == "chunk":
            # stream mode: { obj: {...} }
            obj = data.get("obj") if isinstance(data, dict) else None
            if obj is not None:
                task.setdefault("chunks", []).append(obj)
            else:
                task.setdefault("chunks", []).append(data)
            return

        if event in {"ws_message", "message"}:
            task.setdefault("chunks", []).append(data)
            return

        if event == "done":
            task["resolved"] = True
            task["status_code"] = data.get("status") or data.get("status_code") or 200
            # Prefer accumulated chunks; keep raw data too
            task["result"] = {
                "events": list(task.get("chunks") or []),
                "done": data,
            }
            waiter = self._grok_waiters.pop(task_id, None)
            if waiter and not waiter.done():
                waiter.set_result(task)
            return

        if event == "error":
            task["resolved"] = True
            task["error"] = str(
                data.get("message") or data.get("error") or data or "extension error"
            )
            task["status_code"] = data.get("status") or data.get("status_code") or 0
            task["result"] = {
                "events": list(task.get("chunks") or []),
                "error_data": data,
            }
            waiter = self._grok_waiters.pop(task_id, None)
            if waiter and not waiter.done():
                waiter.set_result(task)
            return

        # Other events (ws_open, …) — ignore or store lightly
        task.setdefault("meta_events", []).append({"event": event, "data": data})

    def resolve_grok_task(
        self,
        task_id: str,
        *,
        result: Any = None,
        error: str | None = None,
        status_code: int | None = None,
    ) -> None:
        """Legacy plain resolve (non-streaming). Prefer ingest_grok_event."""
        task = self._grok_pending.get(task_id)
        if task is None:
            return
        task["resolved"] = True
        task["result"] = result
        task["error"] = error
        task["status_code"] = status_code
        waiter = self._grok_waiters.pop(task_id, None)
        if waiter and not waiter.done():
            waiter.set_result(task)

    async def wait_for_grok_task(self, task_id: str, timeout: float = 180.0) -> dict[str, Any]:
        task = self._grok_pending.get(task_id)
        if task is None:
            raise RuntimeError(f"Grok task {task_id} not found")
        if task.get("resolved"):
            return task
        loop = asyncio.get_running_loop()
        future: asyncio.Future = loop.create_future()
        self._grok_waiters[task_id] = future
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._grok_waiters.pop(task_id, None)
            self._grok_pending.pop(task_id, None)

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
        """Payload for Auth Helper /sync/theme (XOR encrypted).

        Captcha: r/s/a (Flow reCAPTCHA)
        Grok: g=1 signals extension to drain /sync/grok-poll-task
        """
        payload: dict[str, Any] = {}
        pending = self.get_pending_captcha()
        if pending is not None:
            payload["r"] = pending.request_id
            payload["s"] = pending.site_key
            payload["a"] = pending.action
        # Official G-Labs Auth Helper checks data.g === 1 then _drainFtQueue()
        if any(not t.get("resolved") for t in self._grok_pending.values()):
            payload["g"] = 1
        return encrypt_payload(payload)

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