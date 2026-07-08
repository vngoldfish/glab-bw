"""Access Auth Bridge state from the API process (8765) via HTTP to port 18923."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.services.auth_bridge import CaptchaRequest


@dataclass
class BridgeSessionView:
    flow_tab_status: str = "closed"
    grok_tab_status: str = "closed"
    token_count: int = 0


class AuthBridgeAccess:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.auth_bridge_url).rstrip("/")

    def is_bridge_running(self) -> bool:
        try:
            response = httpx.get(f"{self.base_url}/", timeout=3.0)
            return response.status_code == 200
        except Exception:
            return False

    def _fetch_status(self) -> dict | None:
        try:
            response = httpx.get(f"{self.base_url}/", timeout=3.0)
            if response.status_code == 200:
                return response.json()
        except Exception:
            return None
        return None

    def is_connected(self, max_age_seconds: int = 30) -> bool:
        del max_age_seconds
        data = self._fetch_status()
        return bool(data and data.get("connected"))

    def get_primary_session(self) -> BridgeSessionView | None:
        data = self._fetch_status()
        if not data or not data.get("connected"):
            return None
        return BridgeSessionView(
            flow_tab_status=str(data.get("flow_tab", "closed")),
            grok_tab_status=str(data.get("grok_tab", "closed")),
            token_count=int(data.get("token_count", 0)),
        )

    def status_payload(self) -> dict:
        data = self._fetch_status()
        if data:
            return {
                "connected": bool(data.get("connected")),
                "flow_tab": data.get("flow_tab", "closed"),
                "grok_tab": data.get("grok_tab", "closed"),
                "token_count": data.get("token_count", 0),
                "extensions": data.get("extensions", 0),
                "pending_captcha": data.get("pending_captcha", 0),
            }
        return {
            "connected": False,
            "flow_tab": "closed",
            "grok_tab": "closed",
            "token_count": 0,
            "extensions": 0,
            "pending_captcha": 0,
        }

    async def queue_captcha(self, site_key: str = "", action: str = "") -> CaptchaRequest:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/sync/internal/captcha",
                json={"site_key": site_key, "action": action},
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
        return CaptchaRequest(
            request_id=str(data["request_id"]),
            site_key=site_key,
            action=action,
        )

    async def wait_for_captcha(self, request_id: str, timeout: float = 120.0) -> CaptchaRequest:
        deadline = time.time() + timeout
        async with httpx.AsyncClient() as client:
            while time.time() < deadline:
                response = await client.get(
                    f"{self.base_url}/sync/internal/captcha/{request_id}",
                    timeout=5.0,
                )
                if response.status_code == 404:
                    raise RuntimeError(f"Captcha request {request_id} not found")
                data = response.json()
                if data.get("resolved"):
                    return CaptchaRequest(
                        request_id=request_id,
                        site_key=str(data.get("site_key", "")),
                        action=str(data.get("action", "")),
                        resolved=True,
                        token=data.get("token"),
                        error=data.get("error"),
                    )
                await asyncio.sleep(0.5)
        raise TimeoutError(f"Captcha request {request_id} timed out after {timeout}s")


auth_bridge_access = AuthBridgeAccess()