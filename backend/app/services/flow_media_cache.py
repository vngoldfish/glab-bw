"""Reuse Flow mediaId for the same reference image bytes within a project.

Without this cache, every generation re-uploads refs via flow/uploadImage,
so the same @ten_anh appears many times in the Google Flow project library.
"""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings

_CACHE_NAME = "flow_media_cache.json"
_MAX_ENTRIES = 500
_lock = threading.Lock()


def _cache_path() -> Path:
    return settings.data_dir / _CACHE_NAME


def content_hash(image_bytes: bytes) -> str:
    return hashlib.sha256(image_bytes).hexdigest()


def _entry_key(project_id: str, image_hash: str) -> str:
    return f"{project_id}:{image_hash}"


def _load() -> dict[str, Any]:
    path = _cache_path()
    if not path.is_file():
        return {"entries": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"entries": {}}
    if not isinstance(data, dict):
        return {"entries": {}}
    entries = data.get("entries")
    if not isinstance(entries, dict):
        return {"entries": {}}
    return {"entries": entries}


def _save(data: dict[str, Any]) -> None:
    path = _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _prune(entries: dict[str, Any]) -> dict[str, Any]:
    if len(entries) <= _MAX_ENTRIES:
        return entries
    # Drop oldest by updated_at when over limit
    ranked = sorted(
        entries.items(),
        key=lambda item: str((item[1] or {}).get("updated_at") or ""),
    )
    keep = dict(ranked[-_MAX_ENTRIES :])
    return keep


def get_media_id(project_id: str, image_bytes: bytes) -> str | None:
    if not project_id or not image_bytes:
        return None
    key = _entry_key(project_id, content_hash(image_bytes))
    with _lock:
        entry = _load()["entries"].get(key)
    if isinstance(entry, dict):
        media_id = entry.get("media_id")
        if isinstance(media_id, str) and media_id.strip():
            return media_id.strip()
    if isinstance(entry, str) and entry.strip():
        return entry.strip()
    return None


def set_media_id(project_id: str, image_bytes: bytes, media_id: str) -> None:
    if not project_id or not image_bytes or not media_id:
        return
    image_hash = content_hash(image_bytes)
    key = _entry_key(project_id, image_hash)
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        data = _load()
        entries = data["entries"]
        entries[key] = {
            "media_id": media_id,
            "project_id": project_id,
            "hash": image_hash,
            "updated_at": now,
        }
        data["entries"] = _prune(entries)
        _save(data)


def invalidate_for_bytes(image_bytes: bytes) -> None:
    """Drop cache rows for this image across all projects (e.g. after replace)."""
    if not image_bytes:
        return
    image_hash = content_hash(image_bytes)
    with _lock:
        data = _load()
        entries = data["entries"]
        dead = [key for key in entries if key.endswith(f":{image_hash}")]
        for key in dead:
            entries.pop(key, None)
        if dead:
            _save(data)
