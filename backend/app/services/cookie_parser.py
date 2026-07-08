import json
import re
from typing import Any
from urllib.parse import unquote


SESSION_COOKIE_NAMES = (
    "__Secure-next-auth.session-token",
    "__secure-next-auth.session-token",
)


def _normalize_cookie_item(item: dict[str, Any]) -> tuple[str, str] | None:
    name = str(item.get("name", "")).strip()
    value = str(item.get("value", "")).strip()
    if not name or not value:
        return None
    return name, unquote(value)


def parse_flow_credentials(raw_input: str) -> dict[str, str]:
    """Extract Flow session token from raw token or cookie JSON export."""
    text = (raw_input or "").strip()
    if not text:
        raise ValueError("Chưa nhập cookie hoặc session token")

    if text.startswith("["):
        try:
            cookies = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("Cookie JSON không hợp lệ") from exc
        if not isinstance(cookies, list):
            raise ValueError("Cookie JSON phải là mảng")

        session_token = ""
        email = ""
        for item in cookies:
            if not isinstance(item, dict):
                continue
            parsed = _normalize_cookie_item(item)
            if not parsed:
                continue
            name, value = parsed
            if name in SESSION_COOKIE_NAMES:
                session_token = value
            elif name.lower() == "email" and not email:
                email = value
            elif name == "EMAIL" and not email:
                email = value.strip('"')

        if not session_token:
            raise ValueError(
                "Không tìm thấy __Secure-next-auth.session-token trong cookie JSON"
            )
        result = {"session_token": session_token}
        if email:
            result["email"] = email
        return result

    if text.startswith("{") and "session-token" in text:
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            for key in SESSION_COOKIE_NAMES:
                if payload.get(key):
                    return {"session_token": str(payload[key]).strip()}

    if "__Secure-next-auth.session-token=" in text:
        match = re.search(
            r"__Secure-next-auth\.session-token=([^;\s]+)",
            text,
            re.IGNORECASE,
        )
        if match:
            return {"session_token": unquote(match.group(1).strip())}

    if text.startswith("eyJ"):
        return {"session_token": text}

    raise ValueError(
        "Không nhận diện được định dạng. Dán JSON cookie export hoặc chỉ session token."
    )