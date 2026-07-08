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


def get_grok_provider() -> GrokProvider | None:
    account = account_store.get_active("grok", for_video=True)
    if not account:
        return None
    return GrokProvider(session_data=account.credentials)


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
    return {
        "id": account.id,
        "provider": account.provider,
        "label": account.label,
        "image_enabled": account.image_enabled,
        "video_enabled": account.video_enabled,
        "enabled": account.enabled,
        "has_credentials": bool(account.credentials),
        "last_used_at": account.last_used_at,
        "cooldown_until": account.cooldown_until,
        "cooldown_left_sec": cooldown_left,
        "in_cooldown": cooldown_left > 0,
        "last_error": account.last_error,
    }