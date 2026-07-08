import json

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.auth_bridge import auth_bridge, parse_theme

router = APIRouter(prefix="/sync", tags=["auth-bridge"])


@router.get("/status")
async def sync_status(x_ext_id: str | None = Header(default=None, alias="X-Ext-Id")) -> dict:
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    return {"ok": True, **auth_bridge.status_payload()}


@router.get("/theme")
async def sync_theme(
    x_ext_id: str | None = Header(default=None, alias="X-Ext-Id"),
    x_tab_status: str | None = Header(default=None, alias="X-Tab-Status"),
    x_grok_tab_status: str | None = Header(default=None, alias="X-Grok-Tab-Status"),
) -> JSONResponse:
    if x_ext_id:
        auth_bridge.touch(
            x_ext_id,
            flow_tab=x_tab_status or "closed",
            grok_tab=x_grok_tab_status or "closed",
        )
    return JSONResponse(auth_bridge.theme_response())


@router.post("/render")
async def sync_render(
    request: Request,
    x_ext_id: str | None = Header(default=None, alias="X-Ext-Id"),
) -> dict:
    if x_ext_id:
        auth_bridge.touch(x_ext_id)

    body = await request.json()
    raw = body.get("d")
    if raw:
        payload = json.loads(parse_theme(raw))
    else:
        payload = body

    auth_bridge.submit_render(payload)
    return {"ok": True}


@router.get("/grok-poll-task")
async def grok_poll_task(x_ext_id: str | None = Header(default=None, alias="X-Ext-Id")) -> JSONResponse:
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    return JSONResponse({})


@router.post("/grok-event")
async def grok_event(
    request: Request,
    x_ext_id: str | None = Header(default=None, alias="X-Ext-Id"),
) -> dict:
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    await request.body()
    return {"ok": True}


class CaptchaQueueRequest(BaseModel):
    site_key: str = ""
    action: str = ""


@router.post("/internal/captcha")
async def queue_internal_captcha(body: CaptchaQueueRequest) -> dict:
    request = auth_bridge.queue_captcha(site_key=body.site_key, action=body.action)
    return {"request_id": request.request_id}


@router.get("/internal/captcha/{request_id}")
async def get_internal_captcha(request_id: str) -> dict:
    request = auth_bridge._captcha_pending.get(request_id)
    if request is None:
        raise HTTPException(status_code=404, detail={"error": f"Captcha {request_id} not found"})
    return {
        "request_id": request.request_id,
        "site_key": request.site_key,
        "action": request.action,
        "resolved": request.resolved,
        "token": request.token,
        "error": request.error,
    }