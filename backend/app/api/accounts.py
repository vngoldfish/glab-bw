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

            await flow_session_manager.ensure_session(
                account,
                google_flow_client,
                force_refresh=True,
            )
            account = account_store.get(account.id) or account
        except Exception:
            # Keep account even if offline; label may stay user-typed until first gen
            pass
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
    account = account_store.update(account_id, **updates)
    if not account:
        raise HTTPException(status_code=404, detail={"error": "Account not found"})
    return {"account": account_to_dict(account)}


@router.delete("/{account_id}")
async def delete_account(account_id: str) -> dict:
    if not account_store.delete(account_id):
        raise HTTPException(status_code=404, detail={"error": "Account not found"})
    return {"ok": True}


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