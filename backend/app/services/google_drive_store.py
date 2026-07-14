"""Persist Google Drive upload settings (local JSON)."""

from __future__ import annotations

import json
import threading
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()
_FILE = settings.data_dir / "google_drive_settings.json"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "folder_id": "",
    "service_account_info": "",  # Pasted JSON string or parsed dict
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
            if key == "enabled":
                current[key] = bool(val)
            elif key == "folder_id":
                current[key] = str(val).strip() if val is not None else ""
            elif key == "service_account_info":
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
    sa_info = str(data.get("service_account_info") or "").strip()
    
    # Check if Service Account info is a valid JSON dict containing private_key
    has_credentials = False
    client_email = ""
    project_id = ""
    if sa_info:
        try:
            parsed = json.loads(sa_info)
            if isinstance(parsed, dict) and "private_key" in parsed and "client_email" in parsed:
                has_credentials = True
                client_email = parsed.get("client_email", "")
                project_id = parsed.get("project_id", "")
        except Exception:
            pass
            
    return {
        "enabled": bool(data.get("enabled")),
        "folder_id": str(data.get("folder_id") or ""),
        "has_credentials": has_credentials,
        "client_email": client_email,
        "project_id": project_id,
    }
