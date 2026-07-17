"""Persist Google Drive OAuth2 settings (local JSON)."""

from __future__ import annotations

import json
import threading
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()
_FILE = settings.data_dir / "google_drive_settings.json"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "save_local": True,             # Whether to keep files locally or delete after Drive upload
    "folder_id": "",
    "client_secrets_json": "",      # Client ID / Secrets uploaded by user
    "oauth_credentials_json": "",   # Access/Refresh tokens saved after login
    "authorized_email": "",         # Google Account email of logged-in user
}

def _path():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return _FILE

def load_raw() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return dict(DEFAULTS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return dict(DEFAULTS)
        out = dict(DEFAULTS)
        for k in DEFAULTS:
            if k in data and data[k] is not None:
                out[k] = data[k]
        return out
    except Exception:
        return dict(DEFAULTS)

def save_raw(patch: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        current = load_raw()
        for key, val in patch.items():
            if key not in DEFAULTS:
                continue
            if key in ("enabled", "save_local"):
                current[key] = bool(val)
            elif key in ("folder_id", "client_secrets_json", "oauth_credentials_json", "authorized_email"):
                if isinstance(val, dict):
                    current[key] = json.dumps(val, ensure_ascii=False)
                else:
                    current[key] = str(val).strip() if val is not None else ""
        path = _path()
        tmp = path.with_suffix(path.suffix + ".tmp")
        data = json.dumps(current, ensure_ascii=False, indent=2)
        tmp.write_text(data, encoding="utf-8")
        tmp.replace(path)
        return current

def public_view(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    data = raw or load_raw()
    secrets = str(data.get("client_secrets_json") or "").strip()
    creds = str(data.get("oauth_credentials_json") or "").strip()
    
    has_secrets = False
    client_id = ""
    if secrets:
        try:
            parsed = json.loads(secrets)
            # Support both web and installed client secret structures
            oauth_payload = parsed.get("web") or parsed.get("installed") or parsed
            if "client_id" in oauth_payload:
                has_secrets = True
                client_id = oauth_payload.get("client_id", "")
        except Exception:
            pass
            
    has_credentials = False
    if creds:
        try:
            parsed = json.loads(creds)
            if isinstance(parsed, dict) and "refresh_token" in parsed:
                has_credentials = True
        except Exception:
            pass
            
    return {
        "enabled": bool(data.get("enabled")),
        "save_local": bool(data.get("save_local", True)),
        "folder_id": str(data.get("folder_id") or ""),
        "has_secrets": has_secrets,
        "has_credentials": has_credentials,
        "client_id": client_id[:15] + "..." if len(client_id) > 15 else client_id,
        "authorized_email": str(data.get("authorized_email") or ""),
    }
