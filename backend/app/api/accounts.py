from fastapi import APIRouter, HTTPException

from app.models.schemas import AccountCreate, AccountUpdate
from app.providers.registry import account_to_dict
from app.services.account_store import account_store
from app.services.cookie_parser import parse_flow_credentials

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("")
async def list_accounts(provider: str | None = None) -> dict:
    accounts = account_store.list_accounts(provider=provider)  # type: ignore[arg-type]
    return {"accounts": [account_to_dict(a) for a in accounts]}


def _normalize_credentials(provider: str, label: str, credentials: dict[str, str]) -> tuple[str, dict[str, str]]:
    if provider != "flow":
        return label, credentials

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
    return {"account": account_to_dict(account)}


@router.patch("/{account_id}")
async def update_account(account_id: str, body: AccountUpdate) -> dict:
    account = account_store.update(
        account_id,
        label=body.label,
        credentials=body.credentials,
        image_enabled=body.image_enabled,
        video_enabled=body.video_enabled,
        enabled=body.enabled,
    )
    if not account:
        raise HTTPException(status_code=404, detail={"error": "Account not found"})
    return {"account": account_to_dict(account)}


@router.delete("/{account_id}")
async def delete_account(account_id: str) -> dict:
    if not account_store.delete(account_id):
        raise HTTPException(status_code=404, detail={"error": "Account not found"})
    return {"ok": True}