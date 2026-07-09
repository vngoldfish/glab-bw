"""Persist AI provider settings for prompt rewriting (local JSON)."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()
_FILE = settings.data_dir / "ai_settings.json"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "provider": "openai_compatible",  # openai | openai_compatible | grok
    "api_key": "",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
}


def _path() -> Path:
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
        out.update({k: data.get(k, DEFAULTS.get(k)) for k in DEFAULTS})
        return out
    except Exception:
        return dict(DEFAULTS)


def save_raw(patch: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        current = load_raw()
        for key in DEFAULTS:
            if key not in patch:
                continue
            val = patch[key]
            if key == "api_key" and (val is None or str(val).strip() == ""):
                # Empty string means keep existing key
                continue
            if key == "enabled":
                current[key] = bool(val)
            else:
                current[key] = str(val).strip() if val is not None else ""
        # If api_key provided non-empty, update
        if "api_key" in patch and str(patch.get("api_key") or "").strip():
            current["api_key"] = str(patch["api_key"]).strip()
        path = _path()
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        return current


def public_view(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    data = raw or load_raw()
    key = str(data.get("api_key") or "")
    masked = ""
    if key:
        masked = (key[:4] + "…" + key[-4:]) if len(key) > 10 else "••••"
    return {
        "enabled": bool(data.get("enabled")),
        "provider": str(data.get("provider") or "openai_compatible"),
        "base_url": str(data.get("base_url") or DEFAULTS["base_url"]),
        "model": str(data.get("model") or DEFAULTS["model"]),
        "has_api_key": bool(key),
        "api_key_masked": masked,
    }


def get_credentials() -> dict[str, Any]:
    return load_raw()
