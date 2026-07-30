"""Browser Pool REST API endpoints."""

from typing import Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.browser_pool import browser_pool_manager

router = APIRouter(prefix="/browser-pool", tags=["browser-pool"])


class LaunchRequest(BaseModel):
    headless: bool = True


@router.get("/status")
async def get_browser_pool_status() -> dict[str, Any]:
    return {
        "ok": True,
        "instances": browser_pool_manager.list_status(),
    }


@router.post("/launch/{account_id}")
async def launch_browser_instance(account_id: str, req: LaunchRequest | None = None) -> dict[str, Any]:
    headless = req.headless if req else True
    try:
        inst = await browser_pool_manager.launch(account_id, headless=headless)
        return {"ok": True, "account_id": account_id, "status": inst.status}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/stop/{account_id}")
async def stop_browser_instance(account_id: str) -> dict[str, Any]:
    stopped = await browser_pool_manager.stop(account_id)
    return {"ok": True, "account_id": account_id, "stopped": stopped}


@router.post("/launch-all")
async def launch_all_browsers(req: LaunchRequest | None = None) -> dict[str, Any]:
    headless = req.headless if req else True
    results = await browser_pool_manager.launch_all(headless=headless)
    return {"ok": True, "results": results}


@router.post("/stop-all")
async def stop_all_browsers() -> dict[str, Any]:
    result = await browser_pool_manager.stop_all()
    return {"ok": True, **result}
