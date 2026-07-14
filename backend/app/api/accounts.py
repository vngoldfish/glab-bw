import time
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.models.schemas import AccountCreate, AccountUpdate
from app.providers.registry import account_to_dict
from app.services.account_store import account_store
from app.services.cookie_parser import parse_flow_credentials, parse_grok_credentials

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("")
async def list_accounts(provider: str | None = None) -> dict:
    accounts = account_store.list_accounts(provider=provider)  # type: ignore[arg-type]
    
    # Refresh live credits for Flow accounts concurrently
    from app.services.flow_client import google_flow_client
    import asyncio
    
    async def refresh_single_account(acc):
        if acc.provider == "flow" and acc.enabled:
            token = acc.credentials.get("session_token")
            proj_id = acc.credentials.get("project_id")
            if token and proj_id:
                credits = await google_flow_client.get_live_credits(token, proj_id)
                if credits is not None:
                    account_store.update(acc.id, credits_remaining=credits)

    flow_accs = [a for a in accounts if a.provider == "flow" and a.enabled]
    if flow_accs:
        try:
            await asyncio.wait_for(
                asyncio.gather(*(refresh_single_account(a) for a in flow_accs), return_exceptions=True),
                timeout=4.0
            )
        except asyncio.TimeoutError:
            pass
            
    # Re-fetch accounts to include updated credits
    accounts = account_store.list_accounts(provider=provider)  # type: ignore[arg-type]
    return {"accounts": [account_to_dict(a) for a in accounts]}


def _normalize_credentials(provider: str, label: str, credentials: dict[str, str]) -> tuple[str, dict[str, str]]:
    if provider == "flow":
        raw = credentials.get("session_token") or credentials.get("cookie") or ""
        try:
            parsed = parse_flow_credentials(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        normalized_label = label
        email = parsed.get("email", "").strip()
        if not normalized_label and email:
            normalized_label = email
        return normalized_label or label, parsed

    if provider == "grok":
        # Cookie (web) preferred; api_key optional fallback
        raw_cookie = (
            credentials.get("cookie")
            or credentials.get("session_token")
            or credentials.get("sso")
            or ""
        )
        api_key = (credentials.get("api_key") or "").strip()
        # Also accept already-split fields from UI
        if not raw_cookie and credentials.get("sso"):
            parts = [f"sso={credentials['sso']}"]
            if credentials.get("sso-rw"):
                parts.append(f"sso-rw={credentials['sso-rw']}")
            raw_cookie = "; ".join(parts)
        if raw_cookie and (
            "sso" in raw_cookie
            or raw_cookie.startswith("eyJ")
            or raw_cookie.startswith("[")
            or "sso=" in raw_cookie
        ):
            try:
                parsed = parse_grok_credentials(raw_cookie)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
            if api_key:
                parsed["api_key"] = api_key
            return label or "Grok (cookie)", parsed
        if api_key:
            return label or "Grok (API key)", {"api_key": api_key, "auth_mode": "api_key"}
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Dán cookie JSON grok.com (có sso + sso-rw) hoặc xAI API key",
            },
        )

    return label, credentials


@router.post("", status_code=201)
async def create_account(body: AccountCreate) -> dict:
    label, credentials = _normalize_credentials(body.provider, body.label, body.credentials)
    account = account_store.create(
        provider=body.provider,
        label=label,
        credentials=credentials,
        image_enabled=body.image_enabled,
        video_enabled=body.video_enabled,
        enabled=body.enabled,
    )
    # Flow: immediately resolve real Google email from session-token so UI
    # never shows a wrong label from cookie-export noise.
    if body.provider == "flow" and credentials.get("session_token"):
        try:
            from app.services.flow_client import google_flow_client
            from app.services.flow_session import flow_session_manager
            from app.services.session_health import session_health

            await flow_session_manager.ensure_session(
                account,
                google_flow_client,
                force_refresh=True,
            )
            account = account_store.get(account.id) or account
            session_health.mark_flow_ok()
            if account.id in session_health.stale_account_ids:
                session_health.stale_account_ids.discard(account.id)
        except Exception as exc:
            # Delete invalid account and raise error
            account_store.delete(account.id)
            raise HTTPException(
                status_code=400,
                detail={"error": f"Session-token Flow không hợp lệ: {exc}"},
            )

    # Meta AI: validate token immediately
    if body.provider == "meta" and credentials.get("cookie"):
        try:
            from app.services.meta_client import MetaClient
            client = MetaClient(credentials)
            status = await client.check_token()
            if not status.get("ok"):
                # Delete invalid account
                account_store.delete(account.id)
                raise HTTPException(
                    status_code=400,
                    detail={"error": f"Cookie Meta không hợp lệ: {status.get('error')}"},
                )
        except Exception as exc:
            account_store.delete(account.id)
            raise HTTPException(
                status_code=400,
                detail={"error": f"Lỗi xác thực Meta AI: {exc}"},
            )

    return {"account": account_to_dict(account)}


@router.patch("/{account_id}")
async def update_account(account_id: str, body: AccountUpdate) -> dict:
    updates: dict = {
        "label": body.label,
        "credentials": body.credentials,
        "image_enabled": body.image_enabled,
        "video_enabled": body.video_enabled,
        "enabled": body.enabled,
    }
    if body.clear_cooldown:
        updates["clear_cooldown"] = True
    # Drop Nones so we don't wipe fields
    updates = {k: v for k, v in updates.items() if v is not None}

    existing = account_store.get(account_id)
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Account not found"})

    label = body.label or existing.label
    creds = body.credentials
    if creds is not None:
        label, creds = _normalize_credentials(existing.provider, label, creds)
        updates["label"] = label
        updates["credentials"] = creds

    account = account_store.update(account_id, **updates)
    if not account:
        raise HTTPException(status_code=404, detail={"error": "Account not found"})

    # Validate new Flow token
    if account.provider == "flow" and creds and creds.get("session_token"):
        try:
            from app.services.flow_client import google_flow_client
            from app.services.flow_session import flow_session_manager
            from app.services.session_health import session_health

            await flow_session_manager.ensure_session(
                account,
                google_flow_client,
                force_refresh=True,
            )
            account = account_store.get(account.id) or account
            session_health.mark_flow_ok(account.id)
        except Exception as exc:
            from app.services.session_health import session_health
            session_health.mark_flow_stale(str(exc), account.id)
            raise HTTPException(
                status_code=400,
                detail={"error": f"Cập nhật thất bại. Session-token Flow không hợp lệ: {exc}"},
            )

    # Validate new Meta cookie
    if account.provider == "meta" and creds and creds.get("cookie"):
        try:
            from app.services.meta_client import MetaClient
            client = MetaClient(creds)
            status = await client.check_token()
            if not status.get("ok"):
                raise HTTPException(
                    status_code=400,
                    detail={"error": f"Cập nhật thất bại. Cookie Meta không hợp lệ: {status.get('error')}"},
                )
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": f"Lỗi xác thực Meta AI: {exc}"},
            )

    return {"account": account_to_dict(account)}


@router.delete("/{account_id}")
async def delete_account(account_id: str) -> dict:
    if not account_store.delete(account_id):
        raise HTTPException(status_code=404, detail={"error": "Account not found"})
    return {"ok": True}


class LoginBrowserRequest(BaseModel):
    label: str = ""
    timeout_sec: int = 600


@router.post("/login/browser")
async def start_login_browser(body: LoginBrowserRequest | None = None) -> dict:
    """Mở Chrome headed — user login Flow → auto lưu cookie account."""
    from app.services.login_browser import login_browser_service

    req = body or LoginBrowserRequest()
    job = await login_browser_service.start(
        label=req.label,
        timeout_sec=max(60, min(req.timeout_sec, 1800)),
        headless=False,
    )
    return login_browser_service.to_dict(job)


@router.get("/login/browser/{job_id}")
async def login_browser_status(job_id: str) -> dict:
    from app.services.login_browser import login_browser_service

    job = login_browser_service.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": "Job not found"})
    return login_browser_service.to_dict(job)


@router.post("/login/browser/{job_id}/cancel")
async def login_browser_cancel(job_id: str) -> dict:
    from app.services.login_browser import login_browser_service

    ok = login_browser_service.cancel(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "Cannot cancel"})
    job = login_browser_service.get(job_id)
    return login_browser_service.to_dict(job) if job else {"ok": True}


@router.get("/export/backup")
async def export_accounts(include_secrets: bool = False) -> dict:
    """Export accounts for backup. Secrets (cookies/keys) off by default."""
    rows: list[dict[str, Any]] = []
    for a in account_store.list_accounts():
        row: dict[str, Any] = {
            "id": a.id,
            "provider": a.provider,
            "label": a.label,
            "image_enabled": a.image_enabled,
            "video_enabled": a.video_enabled,
            "enabled": a.enabled,
            "created_at": a.created_at,
            "has_credentials": bool(a.credentials),
        }
        if include_secrets:
            row["credentials"] = dict(a.credentials)
        rows.append(row)
    return {
        "exported_at": time.time(),
        "include_secrets": include_secrets,
        "count": len(rows),
        "accounts": rows,
    }


class AccountImportItem(BaseModel):
    provider: str
    label: str = ""
    credentials: dict[str, str] = Field(default_factory=dict)
    image_enabled: bool = True
    video_enabled: bool = True
    enabled: bool = True


class AccountImportRequest(BaseModel):
    accounts: list[AccountImportItem]
    skip_empty_credentials: bool = True


@router.post("/import/backup")
async def import_accounts(body: AccountImportRequest) -> dict:
    """Import accounts (creates new ids). Requires credentials for usable accounts."""
    created = 0
    skipped = 0
    errors: list[str] = []
    for item in body.accounts:
        if body.skip_empty_credentials and not item.credentials:
            skipped += 1
            continue
        try:
            label, credentials = _normalize_credentials(
                item.provider, item.label, item.credentials
            )
            account_store.create(
                provider=item.provider,  # type: ignore[arg-type]
                label=label or item.label or item.provider,
                credentials=credentials,
                image_enabled=item.image_enabled,
                video_enabled=item.video_enabled,
                enabled=item.enabled,
            )
            created += 1
        except Exception as exc:
            errors.append(f"{item.label or item.provider}: {exc}")
    return {"created": created, "skipped": skipped, "errors": errors}