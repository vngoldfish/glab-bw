"""Prompt Hub — saved prompts library (G-Labs style)."""

from __future__ import annotations

import json
import secrets
import threading
import time
from typing import Any, Literal

from app.core.config import settings

_LOCK = threading.Lock()
Kind = Literal["image", "video", "any"]


def _path():
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings.data_dir / "prompt_hub.json"


def _load() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {"prompts": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("prompts"), list):
            return {"prompts": []}
        return data
    except Exception:
        return {"prompts": []}


def _save(data: dict[str, Any]) -> None:
    path = _path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def list_prompts(
    *,
    kind: str | None = None,
    q: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    items = list(_load().get("prompts") or [])
    if kind and kind != "all":
        items = [p for p in items if p.get("kind") in {kind, "any"}]
    if q:
        needle = q.strip().lower()
        items = [
            p
            for p in items
            if needle in str(p.get("title") or "").lower()
            or needle in str(p.get("text") or "").lower()
            or needle in " ".join(p.get("tags") or []).lower()
        ]
    items.sort(key=lambda p: float(p.get("updated_at") or p.get("created_at") or 0), reverse=True)
    return items[: max(1, min(limit, 500))]


def get_prompt(prompt_id: str) -> dict[str, Any] | None:
    for p in _load().get("prompts") or []:
        if p.get("id") == prompt_id:
            return p
    return None


def create_prompt(
    *,
    title: str,
    text: str,
    kind: Kind = "any",
    tags: list[str] | None = None,
) -> dict[str, Any]:
    title = (title or "").strip() or "Untitled"
    text = (text or "").strip()
    if not text:
        raise ValueError("Prompt text is required")
    now = time.time()
    item = {
        "id": secrets.token_hex(6),
        "title": title[:200],
        "text": text[:8000],
        "kind": kind if kind in {"image", "video", "any"} else "any",
        "tags": [t.strip() for t in (tags or []) if t and t.strip()][:20],
        "created_at": now,
        "updated_at": now,
        "use_count": 0,
    }
    with _LOCK:
        data = _load()
        data.setdefault("prompts", []).append(item)
        _save(data)
    return item


def update_prompt(prompt_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    with _LOCK:
        data = _load()
        prompts = data.get("prompts") or []
        for i, p in enumerate(prompts):
            if p.get("id") != prompt_id:
                continue
            if "title" in patch and patch["title"] is not None:
                p["title"] = str(patch["title"]).strip()[:200] or p["title"]
            if "text" in patch and patch["text"] is not None:
                t = str(patch["text"]).strip()
                if t:
                    p["text"] = t[:8000]
            if "kind" in patch and patch["kind"] in {"image", "video", "any"}:
                p["kind"] = patch["kind"]
            if "tags" in patch and patch["tags"] is not None:
                p["tags"] = [str(t).strip() for t in patch["tags"] if str(t).strip()][:20]
            p["updated_at"] = time.time()
            prompts[i] = p
            data["prompts"] = prompts
            _save(data)
            return p
    return None


def delete_prompt(prompt_id: str) -> bool:
    with _LOCK:
        data = _load()
        before = len(data.get("prompts") or [])
        data["prompts"] = [p for p in (data.get("prompts") or []) if p.get("id") != prompt_id]
        if len(data["prompts"]) == before:
            return False
        _save(data)
        return True


def touch_use(prompt_id: str) -> None:
    with _LOCK:
        data = _load()
        for p in data.get("prompts") or []:
            if p.get("id") == prompt_id:
                p["use_count"] = int(p.get("use_count") or 0) + 1
                p["updated_at"] = time.time()
                _save(data)
                return
