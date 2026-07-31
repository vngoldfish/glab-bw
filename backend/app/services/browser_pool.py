"""Browser Pool Manager — automatic background Playwright browser instances per account.

Each Flow account can have a dedicated Chromium instance running in background with:
1. Persistent user_data_dir (keeps Google login session)
2. G-Labs Auth Helper Chrome extension auto-loaded
3. Active tab on labs.google/fx/tools/flow to solve reCAPTCHA on-demand
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.account_store import Account, account_store

logger = logging.getLogger(__name__)

EXTENSION_DIR = Path(__file__).parent.parent.parent / "extension-auth-helper"

# ── Configuration ──────────────────────────────────────────────────────────────
POLL_INTERVAL_STABLE = 15      # seconds — when browser is running stably
POLL_INTERVAL_STARTUP = 5      # seconds — during startup / error recovery
WATCHDOG_INTERVAL = 60         # seconds — how often watchdog checks instances
MAX_RESTART_ATTEMPTS = 3       # max auto-restarts within RESTART_WINDOW
RESTART_WINDOW = 600           # seconds (10 min) — window for restart counting
RECYCLE_AFTER_HOURS = 12       # hours — auto-recycle browser after this time


@dataclass
class BrowserInstance:
    account_id: str
    account_label: str = ""
    status: str = "stopped"  # stopped | starting | running | failed | login_required | stopping
    last_error: str | None = None
    started_at: float | None = None
    flow_tab_status: str = "closed"
    token_count: int = 0
    ext_id: str | None = None
    _context: Any = field(default=None, repr=False)
    _playwright: Any = field(default=None, repr=False)
    _task: asyncio.Task | None = field(default=None, repr=False)
    # Watchdog tracking
    _restart_count: int = field(default=0, repr=False)
    _restart_times: list[float] = field(default_factory=list, repr=False)


class BrowserPoolManager:
    def __init__(self) -> None:
        self._instances: dict[str, BrowserInstance] = {}
        self._lock = asyncio.Lock()
        self._watchdog_task: asyncio.Task | None = None

    def get_instance(self, account_id: str) -> BrowserInstance | None:
        return self._instances.get(account_id)

    def list_status(self) -> list[dict[str, Any]]:
        accounts = account_store.list_accounts("flow")
        result = []
        for acc in accounts:
            inst = self._instances.get(acc.id)
            if inst:
                uptime = int(time.time() - inst.started_at) if inst.started_at else 0
                result.append({
                    "account_id": acc.id,
                    "account_label": acc.label,
                    "status": inst.status,
                    "started_at": inst.started_at,
                    "uptime_seconds": uptime,
                    "flow_tab_status": inst.flow_tab_status,
                    "token_count": inst.token_count,
                    "last_error": inst.last_error,
                    "ext_id": inst.ext_id,
                    "restart_count": inst._restart_count,
                })
            else:
                result.append({
                    "account_id": acc.id,
                    "account_label": acc.label,
                    "status": "stopped",
                    "started_at": None,
                    "uptime_seconds": 0,
                    "flow_tab_status": "closed",
                    "token_count": 0,
                    "last_error": None,
                    "ext_id": None,
                    "restart_count": 0,
                })
        return result

    async def launch(self, account_id: str, headless: bool = True) -> BrowserInstance:
        async with self._lock:
            existing = self._instances.get(account_id)
            if existing and existing.status in {"starting", "running"}:
                return existing

            # Fix 4: Wait for old task to fully stop before relaunch
            if existing and existing._task and not existing._task.done():
                logger.info("Waiting for old browser task to finish for %s...", account_id)
                existing._task.cancel()
                try:
                    await asyncio.wait_for(
                        asyncio.shield(existing._task),
                        timeout=10.0,
                    )
                except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                    pass  # Force proceed after timeout

            account = account_store.get(account_id)
            if not account:
                raise ValueError(f"Account {account_id} not found")

            # Preserve restart count from previous instance
            restart_count = existing._restart_count if existing else 0
            restart_times = existing._restart_times if existing else []

            inst = BrowserInstance(
                account_id=account_id,
                account_label=account.label,
                status="starting",
                started_at=time.time(),
                _restart_count=restart_count,
                _restart_times=restart_times,
            )
            self._instances[account_id] = inst
            inst._task = asyncio.create_task(
                self._run_browser_loop(inst, account, headless=headless)
            )
            return inst

    async def stop(self, account_id: str) -> bool:
        async with self._lock:
            inst = self._instances.get(account_id)
            if not inst:
                return False
            inst.status = "stopping"
            if inst._context:
                try:
                    await inst._context.close()
                except Exception:
                    pass
            if inst._playwright:
                try:
                    await inst._playwright.stop()
                except Exception:
                    pass
            if inst._task and not inst._task.done():
                inst._task.cancel()
            inst.status = "stopped"
            inst._context = None
            inst._playwright = None
            return True

    async def launch_all(self, headless: bool = True) -> list[dict[str, Any]]:
        accounts = account_store.list_accounts("flow")
        results = []
        for acc in accounts:
            if acc.enabled:
                try:
                    await self.launch(acc.id, headless=headless)
                    results.append({"account_id": acc.id, "ok": True})
                except Exception as exc:
                    results.append({"account_id": acc.id, "ok": False, "error": str(exc)})

        # Start watchdog if not running
        if self._watchdog_task is None or self._watchdog_task.done():
            self._watchdog_task = asyncio.create_task(self._watchdog_loop())
            logger.info("Browser pool watchdog started")

        return results

    async def stop_all(self) -> dict[str, int]:
        # Stop watchdog first
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except (asyncio.CancelledError, Exception):
                pass
            self._watchdog_task = None

        count = 0
        ids = list(self._instances.keys())
        for aid in ids:
            if await self.stop(aid):
                count += 1
        logger.info("Stopped all %d browser pool instances", count)
        return {"stopped": count}

    # ── Fix 2: Auto-Restart Watchdog ──────────────────────────────────────────

    async def _watchdog_loop(self) -> None:
        """Periodically check for failed instances and auto-restart them."""
        logger.info("Watchdog loop started (interval=%ds, max_restarts=%d/%ds)",
                     WATCHDOG_INTERVAL, MAX_RESTART_ATTEMPTS, RESTART_WINDOW)
        try:
            while True:
                await asyncio.sleep(WATCHDOG_INTERVAL)
                await self._watchdog_check()
        except asyncio.CancelledError:
            logger.info("Watchdog loop cancelled")

    async def _watchdog_check(self) -> None:
        """Check all instances and restart failed ones."""
        now = time.time()

        for account_id, inst in list(self._instances.items()):
            # Auto-restart failed instances
            if inst.status == "failed":
                # Clean old restart times outside window
                inst._restart_times = [t for t in inst._restart_times if now - t < RESTART_WINDOW]

                if len(inst._restart_times) >= MAX_RESTART_ATTEMPTS:
                    # Too many restarts, don't retry
                    if inst.last_error and "watchdog: quá nhiều lần restart" not in inst.last_error:
                        inst.last_error = (
                            f"⚠️ watchdog: quá nhiều lần restart ({MAX_RESTART_ATTEMPTS} lần trong {RESTART_WINDOW // 60} phút). "
                            f"Lỗi gốc: {inst.last_error}"
                        )
                    continue

                inst._restart_count += 1
                inst._restart_times.append(now)
                logger.warning(
                    "🔄 Watchdog auto-restarting failed browser instance %s (%s) — attempt %d/%d. Error: %s",
                    account_id, inst.account_label, inst._restart_count, MAX_RESTART_ATTEMPTS, inst.last_error,
                )
                try:
                    await self.launch(account_id, headless=True)
                except Exception as exc:
                    logger.error("Watchdog restart failed for %s: %s", account_id, exc)

            # Fix 6: Browser recycling — restart after RECYCLE_AFTER_HOURS
            elif inst.status == "running" and inst.started_at:
                uptime_hours = (now - inst.started_at) / 3600
                if uptime_hours >= RECYCLE_AFTER_HOURS:
                    logger.info(
                        "♻️ Recycling browser instance %s (%s) after %.1fh uptime to free memory",
                        account_id, inst.account_label, uptime_hours,
                    )
                    try:
                        await self.stop(account_id)
                        await self.launch(account_id, headless=True)
                    except Exception as exc:
                        logger.error("Browser recycle failed for %s: %s", account_id, exc)

    # ── Browser Loop ──────────────────────────────────────────────────────────

    async def _run_browser_loop(
        self,
        inst: BrowserInstance,
        account: Account,
        headless: bool = True,
    ) -> None:
        try:
            try:
                from playwright.async_api import async_playwright
            except ImportError:
                async with self._lock:
                    inst.status = "failed"
                    inst.last_error = "Playwright chưa cài. Chạy: pip install playwright && playwright install chromium"
                return

            profile_dir = settings.data_dir / "browser_profiles" / f"account_{account.id}"
            profile_dir.mkdir(parents=True, exist_ok=True)

            args = [
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
                "--no-proxy-server",
                "--proxy-bypass-list=*",
                "--proxy-server=direct://",
            ]

            ext_path = EXTENSION_DIR.resolve()
            if ext_path.is_dir():
                args.extend([
                    f"--disable-extensions-except={ext_path}",
                    f"--load-extension={ext_path}",
                ])

            if headless:
                args.append("--headless=new")

            pw = await async_playwright().start()
            inst._playwright = pw

            context = await pw.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir),
                headless=headless,
                args=args,
                extra_http_headers={"X-Account-Id": account.id},
                viewport={"width": 1280, "height": 900},
            )
            inst._context = context

            page = context.pages[0] if context.pages else await context.new_page()

            async with self._lock:
                inst.status = "starting"
                inst.flow_tab_status = "closed"

            try:
                logger.info("Navigating browser pool page for %s to labs.google/fx/tools/flow", account.label)
                await page.goto("https://labs.google/fx/tools/flow", wait_until="commit", timeout=15000)
            except Exception as e:
                logger.warning("Browser pool initial page.goto warning for %s: %s", account.label, e)

            while inst.status in {"starting", "running", "login_required"}:
                curr_url = page.url or ""

                # Fix 4: Update status under lock
                async with self._lock:
                    if "accounts.google.com" in curr_url or "signin" in curr_url:
                        inst.status = "login_required"
                        inst.flow_tab_status = "closed"
                        inst.last_error = "Chưa đăng nhập Gmail trong profile. Nhấn nút '🔑 Đăng nhập Chrome' ở ô Cài đặt để đăng nhập 1 lần."
                    elif "labs.google" in curr_url:
                        inst.status = "running"
                        inst.flow_tab_status = "open"
                        inst.last_error = None
                    else:
                        inst.status = "running"
                        inst.flow_tab_status = "open"

                try:
                    cookies = await context.cookies()
                    session_token = None
                    for c in cookies:
                        if c.get("name") in {"__Secure-next-auth.session-token", "next-auth.session-token"}:
                            session_token = c.get("value")
                            break

                    if session_token:
                        curr_acc = account_store.get(account.id)
                        if curr_acc:
                            creds = dict(curr_acc.credentials)
                            if creds.get("session_token") != session_token or not creds.get("access_token"):
                                creds["session_token"] = session_token
                                account_store.update(account.id, credentials=creds)
                                try:
                                    from app.services.flow_client import google_flow_client
                                    from app.services.flow_session import flow_session_manager
                                    await flow_session_manager.ensure_session(curr_acc, google_flow_client, force_refresh=True)
                                    logger.info("Auto-synced fresh Flow session token & access token for account %s", account.label)
                                except Exception as err:
                                    logger.warning("Could not exchange session token for %s: %s", account.label, err)
                except Exception as e:
                    logger.debug("Browser loop poll error: %s", e)

                # Fix 5: Adaptive polling — slower when stable
                if inst.status == "running" and inst.flow_tab_status == "open":
                    await asyncio.sleep(POLL_INTERVAL_STABLE)
                else:
                    await asyncio.sleep(POLL_INTERVAL_STARTUP)

        except asyncio.CancelledError:
            async with self._lock:
                inst.status = "stopped"
        except Exception as exc:
            logger.exception("Browser pool error for account %s", account.id)
            async with self._lock:
                inst.status = "failed"
                inst.last_error = str(exc)
        finally:
            if inst._context:
                try:
                    await inst._context.close()
                except Exception:
                    pass
            if inst._playwright:
                try:
                    await inst._playwright.stop()
                except Exception:
                    pass
            inst._context = None
            inst._playwright = None


browser_pool_manager = BrowserPoolManager()

