import json

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.auth_bridge import auth_bridge, encrypt_payload, parse_theme

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
    """Auth Helper polls this every ~1.5s.

    When g=1, official extension drains /sync/grok-poll-task.
    """
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
    """Official Auth Helper: data.task = { id, kind, payload }.

    Supports both plain JSON and XOR theme envelope {d: ...}.
    """
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    wrapped = auth_bridge.pop_grok_task()
    if not wrapped:
        return JSONResponse({})
    # Plain JSON works; encrypt for consistency with other endpoints
    return JSONResponse(wrapped)


@router.post("/grok-event")
async def grok_event(
    request: Request,
    x_ext_id: str | None = Header(default=None, alias="X-Ext-Id"),
) -> dict:
    """Official Auth Helper posts: { d: xor(JSON.stringify({ id, event, data })) }."""
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    try:
        body = await request.json()
    except Exception:
        raw = await request.body()
        try:
            body = json.loads(raw.decode("utf-8") if raw else "{}")
        except Exception:
            body = {}

    payload: dict = body if isinstance(body, dict) else {}
    if payload.get("d") and "event" not in payload:
        try:
            payload = json.loads(parse_theme(str(payload["d"])))
        except Exception:
            pass

    task_id = str(payload.get("id") or payload.get("task_id") or "")
    if not task_id:
        return {"ok": False, "error": "missing task id"}

    # Official format: { id, event, data }
    if "event" in payload:
        auth_bridge.ingest_grok_event(
            task_id,
            str(payload.get("event") or ""),
            payload.get("data"),
        )
        return {"ok": True}

    # Legacy flat format
    error = payload.get("error")
    result = payload.get("result") or payload.get("data") or payload.get("body")
    status_code = payload.get("status_code") or payload.get("status")
    auth_bridge.resolve_grok_task(
        task_id,
        result=result,
        error=str(error) if error else None,
        status_code=int(status_code) if status_code else None,
    )
    return {"ok": True}


class CaptchaQueueRequest(BaseModel):
    site_key: str = ""
    action: str = ""


class GrokTaskQueueRequest(BaseModel):
    method: str = "POST"
    url: str
    headers: dict | None = None
    body: dict | str | None = None
    kind: str = "gfetch"
    response_mode: str = "stream"
    timeout_ms: int = 180_000
    inject_statsig: bool = True


class StatsigPushRequest(BaseModel):
    statsig_id: str = ""
    source: str = ""


@router.get("/statsig-wanted")
async def statsig_wanted(x_ext_id: str | None = Header(default=None, alias="X-Ext-Id")) -> dict:
    """Extension polls: should it scrape x-statsig-id from grok.com tab?"""
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    return {
        "wanted": auth_bridge._statsig_wanted,
        "has": bool(auth_bridge.get_statsig_id()),
    }


@router.post("/statsig")
async def push_statsig(
    body: StatsigPushRequest,
    x_ext_id: str | None = Header(default=None, alias="X-Ext-Id"),
) -> dict:
    """Extension posts scraped x-statsig-id (no page reload)."""
    if x_ext_id:
        auth_bridge.touch(x_ext_id)
    auth_bridge.set_statsig_id(body.statsig_id)
    return {"ok": True, "has": bool(auth_bridge.get_statsig_id())}


@router.post("/internal/captcha")
async def queue_internal_captcha(body: CaptchaQueueRequest) -> dict:
    request = auth_bridge.queue_captcha(site_key=body.site_key, action=body.action)
    return {"request_id": request.request_id}


@router.post("/internal/grok-task")
async def queue_internal_grok_task(body: GrokTaskQueueRequest) -> dict:
    task_id = auth_bridge.queue_grok_task(
        method=body.method,
        url=body.url,
        headers=body.headers,
        body=body.body,
        kind=body.kind,
        response_mode=body.response_mode,
        timeout_ms=body.timeout_ms,
        inject_statsig=body.inject_statsig,
    )
    return {"task_id": task_id}


@router.get("/internal/grok-task/{task_id}")
async def get_internal_grok_task(task_id: str) -> dict:
    task = auth_bridge._grok_pending.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail={"error": f"Grok task {task_id} not found"})
    return {
        "id": task_id,
        "resolved": bool(task.get("resolved")),
        "error": task.get("error"),
        "status_code": task.get("status_code"),
        "chunks": len(task.get("chunks") or []),
        "has_result": task.get("result") is not None,
    }


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
