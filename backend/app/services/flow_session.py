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
            try:
                session = await client.st_to_at(session_token)
            except ProviderError as exc:
                # Most common when cookie is stale / wrong account paste / not labs.google
                raise ProviderError(
                    f"Session Flow không hợp lệ cho «{account.label}». "
                    "Lấy lại cookie __Secure-next-auth.session-token khi ĐÃ login "
                    "đúng account đó trên labs.google (profile Chrome riêng). "
                    f"Chi tiết: {exc}",
                    error_code=getattr(exc, "error_code", 403) or 403,
                ) from exc
            access_token = str(session.get("access_token", "")).strip()
            expires = str(session.get("expires", "")).strip()
            user = session.get("user") or {}
            if not isinstance(user, dict):
                user = {}
            # Accept several possible field names from Flow session payload
            tier = str(
                user.get("paygateTier")
                or user.get("userPaygateTier")
                or session.get("paygateTier")
                or creds.get("user_paygate_tier")
                or "PAYGATE_TIER_ONE"
            )
            email = str(
                user.get("email")
                or user.get("emailAddress")
                or user.get("userEmail")
                or creds.get("email")
                or ""
            ).strip()
            if not access_token:
                raise ProviderError(
                    f"Không lấy được access token cho «{account.label}» — "
                    "cookie session-token hết hạn hoặc không phải account Flow. "
                    "Login đúng Gmail trên labs.google → copy cookie lại → Cài đặt.",
                    error_code=403,
                )
            creds["access_token"] = access_token
            creds["at_expires"] = expires
            creds["user_paygate_tier"] = tier
            if email:
                creds["email"] = email
            account_store.update(account.id, credentials=creds)
            # Always sync label to real Google email from session (avoids
            # "app shows A, library is B" when user typed wrong label).
            if email and account.label != email:
                account_store.update(account.id, label=email)

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