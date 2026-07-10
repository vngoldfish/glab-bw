"""Launch headed browser for Google Flow login → save cookie account (G-Labs style)."""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class LoginJob:
    job_id: str
    status: str = "pending"  # pending|running|completed|failed|cancelled
    message: str = ""
    email: str | None = None
    account_id: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None


class LoginBrowserService:
    def __init__(self) -> None:
        self._jobs: dict[str, LoginJob] = {}
        self._lock = asyncio.Lock()

    def get(self, job_id: str) -> LoginJob | None:
        return self._jobs.get(job_id)

    def list_recent(self, limit: int = 10) -> list[LoginJob]:
        jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
        return jobs[:limit]

    async def start(
        self,
        *,
        label: str = "",
        timeout_sec: int = 600,
        headless: bool = False,
    ) -> LoginJob:
        job = LoginJob(job_id=secrets.token_hex(4), status="pending", message="Queued")
        self._jobs[job.job_id] = job
        asyncio.create_task(
            self._run(job, label=label, timeout_sec=timeout_sec, headless=headless)
        )
        return job

    async def _run(
        self,
        job: LoginJob,
        *,
        label: str,
        timeout_sec: int,
        headless: bool,
    ) -> None:
        job.status = "running"
        job.message = "Opening Chrome — login Google Flow in the browser window"
        try:
            try:
                from playwright.async_api import async_playwright
            except ImportError as exc:
                raise RuntimeError(
                    "Playwright chưa cài. Chạy: pip install playwright && playwright install chromium"
                ) from exc

            profiles = settings.data_dir / "browser_profiles"
            profiles.mkdir(parents=True, exist_ok=True)
            profile_dir = profiles / f"login_{job.job_id}"

            session_token: str | None = None
            email_found: str | None = None

            async with async_playwright() as p:
                context = await p.chromium.launch_persistent_context(
                    user_data_dir=str(profile_dir),
                    headless=headless,
                    args=["--disable-blink-features=AutomationControlled"],
                    viewport={"width": 1280, "height": 900},
                )
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto(
                    "https://labs.google/fx/tools/flow",
                    wait_until="domcontentloaded",
                    timeout=60000,
                )
                job.message = "Đăng nhập Google trên cửa sổ Chrome (tối đa vài phút)…"

                deadline = time.time() + max(60, timeout_sec)
                while time.time() < deadline:
                    if job.status == "cancelled":
                        await context.close()
                        return
                    cookies = await context.cookies()
                    for c in cookies:
                        name = c.get("name") or ""
                        if name == "__Secure-next-auth.session-token" or name.endswith(
                            "next-auth.session-token"
                        ):
                            session_token = c.get("value") or ""
                            break
                    if session_token:
                        # try email from page or cookie hints
                        try:
                            email_found = await page.evaluate(
                                """() => {
                                  const t = document.body?.innerText || '';
                                  const m = t.match(/[\\w.+-]+@gmail\\.com/i);
                                  return m ? m[0] : null;
                                }"""
                            )
                        except Exception:
                            email_found = None
                        break
                    await asyncio.sleep(1.5)

                await context.close()

            if not session_token:
                job.status = "failed"
                job.error = "Timeout — không thấy session-token. Login Flow rồi thử lại."
                job.message = job.error
                job.finished_at = time.time()
                return

            from app.services.account_store import account_store
            from app.services.cookie_parser import parse_flow_credentials

            try:
                creds = parse_flow_credentials(session_token)
            except ValueError:
                creds = {"session_token": session_token, "cookie": session_token}

            acc_label = (
                (label or "").strip()
                or (email_found or "").strip()
                or creds.get("email")
                or f"Flow login {job.job_id}"
            )
            account = account_store.create(
                provider="flow",
                label=acc_label,
                credentials=creds,
                image_enabled=True,
                video_enabled=True,
                enabled=True,
            )
            # Best-effort session refresh for real email
            try:
                from app.services.flow_client import google_flow_client
                from app.services.flow_session import flow_session_manager

                await flow_session_manager.ensure_session(
                    account, google_flow_client, force_refresh=True
                )
                account = account_store.get(account.id) or account
            except Exception:
                pass

            job.status = "completed"
            job.account_id = account.id
            job.email = getattr(account, "label", None) or email_found
            job.message = f"Đã lưu account: {account.label}"
            job.finished_at = time.time()
            logger.info("Login browser OK account=%s", account.id)
        except Exception as exc:
            logger.exception("Login browser failed")
            job.status = "failed"
            job.error = str(exc)
            job.message = str(exc)
            job.finished_at = time.time()

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job or job.status not in {"pending", "running"}:
            return False
        job.status = "cancelled"
        job.message = "Cancelled"
        job.finished_at = time.time()
        return True

    def to_dict(self, job: LoginJob) -> dict[str, Any]:
        return {
            "job_id": job.job_id,
            "status": job.status,
            "message": job.message,
            "email": job.email,
            "account_id": job.account_id,
            "created_at": job.created_at,
            "finished_at": job.finished_at,
            "error": job.error,
        }


login_browser_service = LoginBrowserService()
