import time

from app.providers.flow_veo_provider import FlowVeoProvider
from app.providers.grok_provider import GrokProvider
from app.providers.meta_provider import MetaProvider
from app.providers.openai_provider import OpenAIProvider
from app.services.account_store import Account, account_store


def get_openai_provider() -> OpenAIProvider | None:
    account = account_store.get_active("openai", for_video=False)
    if not account:
        return None
    api_key = account.credentials.get("api_key", "")
    if not api_key:
        return None
    return OpenAIProvider(api_key=api_key)


def get_flow_provider(for_video: bool = False) -> FlowVeoProvider | None:
    account = account_store.get_active("flow", for_video=for_video)
    if not account:
        return None
    return FlowVeoProvider(account=account)


def get_flow_providers(for_video: bool = False) -> list[tuple[Account, FlowVeoProvider]]:
    """All eligible Flow accounts for rotation retry (round-robin start index)."""
    ordered = account_store.list_eligible_rotated("flow", for_video=for_video)
    return [(a, FlowVeoProvider(account=a)) for a in ordered]


def get_grok_provider(for_video: bool = False) -> GrokProvider | None:
    """Next eligible Grok account (cookie web / API key / extension browser session)."""
    account = account_store.get_active("grok", for_video=for_video)
    if not account:
        for acc in account_store.list_accounts("grok"):
            if not acc.enabled:
                continue
            creds = acc.credentials or {}
            has_auth = bool(creds.get("sso") or creds.get("cookie") or creds.get("api_key"))
            if not has_auth:
                continue
            if for_video and not acc.video_enabled:
                continue
            if not for_video and not acc.image_enabled:
                continue
            account = acc
            break
    if account:
        return GrokProvider(
            session_data=account.credentials,
            api_key=account.credentials.get("api_key", ""),
        )
    # No stored account: still allow extension-driven browser session (Flow-like)
    try:
        from app.services.auth_bridge_access import auth_bridge_access

        if auth_bridge_access.is_connected():
            sess = auth_bridge_access.get_primary_session()
            if sess and sess.grok_tab_status == "open":
                return GrokProvider(session_data={"auth_mode": "cookie", "sso": "browser"})
    except Exception:
        pass
    return None


def get_meta_provider(for_video: bool = False) -> MetaProvider | None:
    account = account_store.get_active("meta", for_video=for_video)
    if not account:
        return None
    return MetaProvider(session_data=account.credentials)


def account_to_dict(account: Account) -> dict:
    now = time.time()
    cooldown_left = 0
    if account.cooldown_until and account.cooldown_until > now:
        cooldown_left = int(account.cooldown_until - now)
    creds = account.credentials or {}
    email = str(creds.get("email") or "").strip()
    # Prefer real email from last session refresh for display
    display = email or account.label
    return {
        "id": account.id,
        "provider": account.provider,
        "label": display,
        "email": email or None,
        "image_enabled": account.image_enabled,
        "video_enabled": account.video_enabled,
        "enabled": account.enabled,
        "has_credentials": bool(account.credentials),
        "last_used_at": account.last_used_at,
        "cooldown_until": account.cooldown_until,
        "cooldown_left_sec": cooldown_left,
        "in_cooldown": cooldown_left > 0,
        "last_error": account.last_error,
        "credits_remaining": account.credits_remaining,
        "auth_hint": (
            "cookie/session trong app"
            if account.provider == "flow"
            else (
                "tab browser grok.com (Auth Helper)"
                if account.provider == "grok"
                and not creds.get("api_key")
                else (
                    "cookie meta_session từ vibes.ai"
                    if account.provider == "meta"
                    else "credentials trong app"
                )
            )
        ),
    }