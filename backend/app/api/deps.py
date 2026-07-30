from fastapi import Depends, Header, HTTPException

from app.core.config import settings


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail={"error": "Invalid or missing API key"})


# ── Public API auth dependency ────────────────────────────────────────────────

from app.services.api_key_store import ApiKeyInfo, api_key_store
from app.core.rate_limiter import rate_limiter


async def verify_public_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> ApiKeyInfo:
    """Authenticate Public API requests.

    Accepts either:
      - Authorization: Bearer glbw_sk_...
      - X-API-Key: glbw_sk_...

    Also falls back to the server-level API key (settings.api_key) for
    backward compatibility — in that case, returns a synthetic ApiKeyInfo
    with unlimited quota.
    """
    raw_key: str | None = None

    # 1. Try Authorization: Bearer ...
    if authorization and authorization.lower().startswith("bearer "):
        raw_key = authorization[7:].strip()

    # 2. Try X-API-Key header
    if not raw_key and x_api_key:
        raw_key = x_api_key.strip()

    if not raw_key:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "Missing API key",
                "hint": "Pass 'Authorization: Bearer glbw_sk_...' or 'X-API-Key: ...' header",
            },
        )

    # 3. Check against user-created keys first
    key_info = api_key_store.verify_key(raw_key)
    if key_info:
        return key_info

    # 4. Fall back to server-level API key for backward compat
    if settings.api_key and raw_key == settings.api_key:
        return ApiKeyInfo(
            key_id="__server__",
            name="Server Admin Key",
            created_at=0,
            expires_at=None,
            is_active=True,
            rate_limit=9999,
            daily_quota=999999,
            permissions=["image", "video", "workflow", "admin"],
        )

    raise HTTPException(
        status_code=401,
        detail={"error": "Invalid API key"},
    )


def require_permission(permission: str):
    """Factory for permission-checking dependency."""

    async def _check(key_info: ApiKeyInfo) -> ApiKeyInfo:
        if permission not in key_info.permissions and "admin" not in key_info.permissions:
            raise HTTPException(
                status_code=403,
                detail={"error": f"API key lacks '{permission}' permission"},
            )
        return key_info

    return _check


async def check_rate_limit(key_info: ApiKeyInfo = Depends(verify_public_key)) -> ApiKeyInfo:
    """Check rate limit and daily quota for the authenticated key."""
    result = rate_limiter.check_and_consume(
        key_info.key_id,
        rate_limit=key_info.rate_limit,
        daily_quota=key_info.daily_quota,
    )
    if not result.allowed:
        raise HTTPException(
            status_code=429,
            detail={"error": result.reason, "retry_after": result.retry_after},
            headers={
                **result.headers(),
                "Retry-After": str(result.retry_after),
            },
        )
    return key_info