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


def _cookie_domain(item: dict[str, Any]) -> str:
    return str(item.get("domain") or item.get("host") or "").lower().lstrip(".")


def _analyze_cookie_export(cookies: list[Any]) -> dict[str, Any]:
    """Summarize a cookie-export JSON array for diagnostics / clear errors."""
    domains: set[str] = set()
    names: list[str] = []
    labs_tokens: list[str] = []
    other_session_tokens: list[str] = []
    for item in cookies:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        names.append(name)
        domain = _cookie_domain(item)
        if domain:
            domains.add(domain)
        if name not in SESSION_COOKIE_NAMES:
            continue
        value = str(item.get("value") or "").strip()
        if not value:
            continue
        try:
            value = unquote(value)
        except Exception:
            pass
        if "labs.google" in domain:
            labs_tokens.append(value)
        else:
            other_session_tokens.append(value)
    return {
        "domains": sorted(domains),
        "names": names,
        "count": len(names),
        "labs_tokens": labs_tokens,
        "other_session_tokens": other_session_tokens,
    }


def _missing_flow_token_error(analysis: dict[str, Any]) -> str:
    domains = analysis.get("domains") or []
    count = int(analysis.get("count") or 0)
    sample = ", ".join(domains[:5]) if domains else "(không có domain)"
    more = f" (+{len(domains) - 5} domain khác)" if len(domains) > 5 else ""

    # Clearly not Google Flow (e.g. hosyquan.com shopping site)
    only_unrelated = domains and not any(
        "labs.google" in d or d.endswith("google.com") for d in domains
    )
    if only_unrelated:
        return (
            f"Cookie JSON này không phải Google Flow. "
            f"Domain trong file: {sample}{more} ({count} cookie). "
            f"Cần export từ https://labs.google/fx/tools/flow — "
            f"phải có cookie tên __Secure-next-auth.session-token "
            f"(domain labs.google)."
        )
    if any(d.endswith("google.com") for d in domains) and not any(
        "labs.google" in d for d in domains
    ):
        return (
            f"Thấy cookie Google ({sample}{more}) nhưng thiếu "
            f"__Secure-next-auth.session-token trên labs.google. "
            f"Mở https://labs.google/fx/tools/flow (đã login) rồi export lại."
        )
    return (
        f"Không tìm thấy __Secure-next-auth.session-token trong {count} cookie "
        f"(domain: {sample}{more}). "
        f"Export khi đang mở labs.google và đã login Flow."
    )


def parse_flow_credentials(raw_input: str) -> dict[str, str]:
    """Extract Flow session token from raw token or cookie JSON export.

    Analyzes EditThisCookie-style JSON: prefers labs.google session-token;
    rejects unrelated sites (e.g. hosyquan.com) with an explicit message.
    """
    text = (raw_input or "").strip()
    if not text:
        raise ValueError("Chưa nhập cookie hoặc session token")

    if text.startswith("["):
        try:
            cookies = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("Cookie JSON không hợp lệ (không parse được mảng)") from exc
        if not isinstance(cookies, list):
            raise ValueError("Cookie JSON phải là mảng [ {...}, ... ]")
        if not cookies:
            raise ValueError("Cookie JSON rỗng")

        analysis = _analyze_cookie_export(cookies)
        labs_tokens: list[str] = analysis["labs_tokens"]
        other_tokens: list[str] = analysis["other_session_tokens"]

        if labs_tokens:
            session_token = labs_tokens[-1]
        elif other_tokens:
            session_token = other_tokens[-1]
        else:
            raise ValueError(_missing_flow_token_error(analysis))

        # Real email comes from Google /auth/session after add — not from export.
        return {"session_token": session_token}

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

    # Looks like cookie JSON but missing [ ?
    if "domain" in text and "name" in text and "value" in text:
        raise ValueError(
            "Có vẻ là cookie export nhưng không phải mảng JSON hợp lệ. "
            "Cần dạng [ {\"domain\":\"...\",\"name\":\"...\",\"value\":\"...\"}, ... ] "
            "từ labs.google."
        )

    raise ValueError(
        "Không nhận diện được định dạng. "
        "Dán JSON cookie labs.google (có __Secure-next-auth.session-token) "
        "hoặc chỉ session token (eyJ...)."
    )


GROK_COOKIE_KEYS = (
    "sso",
    "sso-rw",
    "x-anonuserid",
    "x-challenge",
    "x-signature",
    "cf_clearance",
    "__cf_bm",
)


def parse_cookie_header(raw: str) -> dict[str, str]:
    """Parse 'a=1; b=2' or curl -H 'cookie: ...' into a dict."""
    text = (raw or "").strip()
    if not text:
        return {}
    # strip curl wrappers
    if "cookie:" in text.lower():
        # take after last cookie: occurrence
        parts = re.split(r"(?i)cookie:\s*", text)
        text = parts[-1]
    text = text.strip().strip("'\"")
    if text.startswith("-b ") or text.startswith("-H "):
        # crude curl line cleanup
        m = re.search(r"(?:-b|-H)\s+['\"]?(?:cookie:\s*)?([^'\"]+)", text, re.I)
        if m:
            text = m.group(1)

    out: dict[str, str] = {}
    for chunk in text.split(";"):
        chunk = chunk.strip()
        if not chunk or "=" not in chunk:
            continue
        k, v = chunk.split("=", 1)
        k, v = k.strip(), v.strip().strip("'\"")
        if k:
            out[k] = unquote(v)
    return out


def parse_grok_credentials(raw_input: str) -> dict[str, str]:
    """Extract Grok web cookies (sso + sso-rw) from JSON export, curl, or header string.

    Stored as:
      cookie: full Cookie header string for requests
      sso / sso-rw: individual values
    """
    text = (raw_input or "").strip()
    if not text:
        raise ValueError("Chưa nhập cookie Grok — đăng nhập grok.com → copy cookie sso + sso-rw")

    cookies: dict[str, str] = {}

    # JSON array export (EditThisCookie / Cookie-Editor)
    if text.startswith("["):
        try:
            items = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("Cookie JSON không hợp lệ") from exc
        if not isinstance(items, list):
            raise ValueError("Cookie JSON phải là mảng")
        for item in items:
            if not isinstance(item, dict):
                continue
            parsed = _normalize_cookie_item(item)
            if not parsed:
                continue
            name, value = parsed
            cookies[name] = value
    elif text.startswith("{") and ("sso" in text or "cookie" in text.lower()):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            if isinstance(payload.get("cookies"), dict):
                cookies.update({str(k): str(v) for k, v in payload["cookies"].items()})
            else:
                for k, v in payload.items():
                    if isinstance(v, str) and k not in {"email", "label"}:
                        cookies[str(k)] = v
    else:
        cookies = parse_cookie_header(text)

    sso = cookies.get("sso") or cookies.get("SSO") or ""
    sso_rw = cookies.get("sso-rw") or cookies.get("sso_rw") or ""
    if not sso:
        # Sometimes user pastes only the JWT value of sso
        if text.startswith("eyJ") and len(text) > 40:
            sso = text
            cookies["sso"] = sso
        else:
            raise ValueError(
                "Thiếu cookie sso — mở grok.com (đã login) → DevTools → Application/Cookie "
                "hoặc Network → copy header Cookie có sso=...; sso-rw=..."
            )

    # Prefer full set for anti-bot; always require sso
    header_parts = []
    for key in GROK_COOKIE_KEYS:
        if cookies.get(key):
            header_parts.append(f"{key}={cookies[key]}")
    # include any other cookies user provided
    for key, val in cookies.items():
        if key not in GROK_COOKIE_KEYS and val:
            header_parts.append(f"{key}={val}")
    cookie_header = "; ".join(header_parts) if header_parts else f"sso={sso}"

    result: dict[str, str] = {
        "cookie": cookie_header,
        "sso": sso,
        "auth_mode": "cookie",
    }
    if sso_rw:
        result["sso-rw"] = sso_rw
    for key in ("x-anonuserid", "x-challenge", "x-signature", "cf_clearance"):
        if cookies.get(key):
            result[key] = cookies[key]
    return result