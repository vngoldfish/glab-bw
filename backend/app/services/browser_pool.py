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


@dataclass
class BrowserInstance:
    account_id: str
    account_label: str = ""
    status: str = "stopped"  # stopped | starting | running | failed | login_required
    last_error: str | None = None
    started_at: float | None = None
    flow_tab_status: str = "closed"
    token_count: int = 0
    ext_id: str | None = None
    _context: Any = field(default=None, repr=False)
    _playwright: Any = field(default=None, repr=False)
    _task: asyncio.Task | None = field(default=None, repr=False)


class BrowserPoolManager:
    def __init__(self) -> None:
        self._instances: dict[str, BrowserInstance] = {}
        self._lock = asyncio.Lock()

    def get_instance(self, account_id: str) -> BrowserInstance | None:
        return self._instances.get(account_id)

    def list_status(self) -> list[dict[str, Any]]:
        accounts = account_store.list_accounts("flow")
        result = []
        for acc in accounts:
            inst = self._instances.get(acc.id)
            if inst:
                result.append({
                    "account_id": acc.id,
                    "account_label": acc.label,
                    "status": inst.status,
                    "started_at": inst.started_at,
                    "flow_tab_status": inst.flow_tab_status,
                    "token_count": inst.token_count,
                    "last_error": inst.last_error,
                    "ext_id": inst.ext_id,
                })
            else:
                result.append({
                    "account_id": acc.id,
                    "account_label": acc.label,
                    "status": "stopped",
                    "started_at": None,
                    "flow_tab_status": "closed",
                    "token_count": 0,
                    "last_error": None,
                    "ext_id": None,
                })
        return result

    async def launch(self, account_id: str, headless: bool = True) -> BrowserInstance:
        async with self._lock:
            existing = self._instances.get(account_id)
            if existing and existing.status in {"starting", "running"}:
                return existing

            account = account_store.get(account_id)
            if not account:
                raise ValueError(f"Account {account_id} not found")

            inst = BrowserInstance(
                account_id=account_id,
                account_label=account.label,
                status="starting",
                started_at=time.time(),
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
        return results

    async def stop_all(self) -> dict[str, int]:
        count = 0
        ids = list(self._instances.keys())
        for aid in ids:
            if await self.stop(aid):
                count += 1
        return {"stopped": count}

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
                headless=False if not headless else False,
                args=args,
                viewport={"width": 1280, "height": 900},
            )
            inst._context = context

            page = context.pages[0] if context.pages else await context.new_page()

            await page.goto("https://labs.google/fx/tools/flow", wait_until="domcontentloaded", timeout=60000)

            inst.status = "running"
            inst.flow_tab_status = "open"
            logger.info("Browser pool instance started for account %s (%s)", account.label, account.id)

            while inst.status == "running":
                await asyncio.sleep(5)
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

        except asyncio.CancelledError:
            inst.status = "stopped"
        except Exception as exc:
            logger.exception("Browser pool error for account %s", account.id)
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
