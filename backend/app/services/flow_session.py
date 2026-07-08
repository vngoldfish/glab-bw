import time
from datetime import datetime, timezone
from typing import Any

from app.providers.base import ProviderError
from app.services.account_store import Account, account_store


def _parse_expires(value: str | None) -> float | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.timestamp()
    except ValueError:
        return None


class FlowSessionManager:
    async def ensure_session(
        self,
        account: Account,
        client: Any,
        *,
        force_refresh: bool = False,
    ) -> dict[str, str]:
        creds = dict(account.credentials)
        session_token = creds.get("session_token", "").strip()
        if not session_token:
            raise ProviderError(
                "Thiếu session_token Flow — lấy cookie __Secure-next-auth.session-token từ labs.google",
                error_code=0,
            )

        access_token = creds.get("access_token", "").strip()
        expires_at = _parse_expires(creds.get("at_expires"))
        needs_refresh = (
            force_refresh
            or not access_token
            or not expires_at
            or expires_at < time.time() + 60
        )
        if needs_refresh:
            session = await client.st_to_at(session_token)
            access_token = str(session.get("access_token", "")).strip()
            expires = str(session.get("expires", "")).strip()
            user = session.get("user") or {}
            # Accept several possible field names from Flow session payload
            tier = str(
                user.get("paygateTier")
                or user.get("userPaygateTier")
                or session.get("paygateTier")
                or creds.get("user_paygate_tier")
                or "PAYGATE_TIER_ONE"
            )
            if not access_token:
                raise ProviderError(
                    "Không lấy được access token từ Google Flow — paste lại cookie session-token trong Settings",
                    error_code=403,
                )
            creds["access_token"] = access_token
            creds["at_expires"] = expires
            creds["user_paygate_tier"] = tier
            account_store.update(account.id, credentials=creds)

        project_id = creds.get("project_id", "").strip()
        if not project_id:
            project_id = await client.create_project(session_token, title="G-Labs BW")
            creds["project_id"] = project_id
            account_store.update(account.id, credentials=creds)

        return {
            "session_token": session_token,
            "access_token": access_token,
            "project_id": project_id,
            "user_paygate_tier": creds.get("user_paygate_tier", "PAYGATE_TIER_ONE"),
        }


flow_session_manager = FlowSessionManager()