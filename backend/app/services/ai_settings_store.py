"""Persist AI provider settings for prompt rewriting (local JSON)."""

from __future__ import annotations

import json
import threading
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()
_FILE = settings.data_dir / "ai_settings.json"

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "provider": "openai_compatible",  # openai | openai_compatible | grok | custom
    "api_key": "",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o-mini",
    # Separate polish config for image vs video generation prompts
    "image_enabled": True,
    "video_enabled": True,
    "image_style": "pro",  # light | pro | cinematic | custom
    "video_style": "pro",
    "image_custom_instruction": "",
    "video_custom_instruction": "",
}

_BOOL_KEYS = {"enabled", "image_enabled", "video_enabled"}
_STR_KEYS = {
    "provider",
    "api_key",
    "base_url",
    "model",
    "image_style",
    "video_style",
    "image_custom_instruction",
    "video_custom_instruction",
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
    """Merge patch into stored settings.

    api_key is special: empty / missing / whitespace NEVER clears a saved key.
    Only a non-empty new key replaces the old one.
    """
    with _LOCK:
        current = load_raw()
        preserved_key = str(current.get("api_key") or "")
        for key, val in patch.items():
            if key not in DEFAULTS:
                continue
            # Never wipe stored API key with empty payload
            if key == "api_key":
                new_key = str(val).strip() if val is not None else ""
                if new_key:
                    current["api_key"] = new_key
                # else: keep preserved_key
                continue
            if key in _BOOL_KEYS:
                current[key] = bool(val)
            elif key in _STR_KEYS:
                current[key] = str(val).strip() if val is not None else ""
        # Hard guarantee: if key somehow empty after merge, restore
        if not str(current.get("api_key") or "").strip() and preserved_key:
            current["api_key"] = preserved_key
        path = _path()
        path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        return current


def public_view(raw: dict[str, Any] | None = None) -> dict[str, Any]:
    data = raw or load_raw()
    key = str(data.get("api_key") or "").strip()
    masked = ""
    if key:
        # Show first 4 + last 4 so user recognizes saved key without full secret
        masked = (key[:4] + "…" + key[-4:]) if len(key) > 10 else "••••"
    return {
        "enabled": bool(data.get("enabled")),
        "provider": str(data.get("provider") or DEFAULTS["provider"]),
        "base_url": str(data.get("base_url") or DEFAULTS["base_url"]),
        "model": str(data.get("model") or DEFAULTS["model"]),
        "has_api_key": bool(key),
        "api_key_masked": masked,
        "api_key_set": bool(key),  # alias for UI clarity
        "image_enabled": bool(data.get("image_enabled", True)),
        "video_enabled": bool(data.get("video_enabled", True)),
        "image_style": str(data.get("image_style") or "pro"),
        "video_style": str(data.get("video_style") or "pro"),
        "image_custom_instruction": str(data.get("image_custom_instruction") or ""),
        "video_custom_instruction": str(data.get("video_custom_instruction") or ""),
    }


def get_credentials() -> dict[str, Any]:
    return load_raw()
