"""Video-edit (dựng video) projects — separate from Workflow projects.

Workflow projects = graph + gen assets under G-Labs BW/projects/{id}
Edit projects     = clip list + exports under G-Labs BW/video_edits/{id}
"""

from __future__ import annotations

import json
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()


def _meta_dir() -> Path:
    d = settings.data_dir / "video_edit_projects"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _meta_dir() / "index.json"


def edit_project_root(project_id: str) -> Path:
    root = settings.data_dir / "G-Labs BW" / "video_edits" / project_id
    (root / "exports").mkdir(parents=True, exist_ok=True)
    (root / "uploads").mkdir(parents=True, exist_ok=True)
    return root


def edit_output_folder(project_id: str) -> str:
    return f"G-Labs BW/video_edits/{project_id}/exports"


def _load_index() -> list[dict[str, Any]]:
    path = _index_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return list(data.get("projects") or [])
    except Exception:
        return []


def _save_index(items: list[dict[str, Any]]) -> None:
    path = _index_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"projects": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def _doc_path(project_id: str) -> Path:
    return _meta_dir() / f"{project_id}.json"


def list_projects() -> list[dict[str, Any]]:
    items = _load_index()
    items.sort(key=lambda p: float(p.get("updated_at") or 0), reverse=True)
    return items


def get_project(project_id: str) -> dict[str, Any] | None:
    path = _doc_path(project_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_project(
    payload: dict[str, Any],
    project_id: str | None = None,
) -> dict[str, Any]:
    """
    payload:
      name, description?, clips?, filename?, last_export?
    clips: [{ id?, path, url, name, duration? }]
    """
    now = time.time()
    with _LOCK:
        pid = project_id or secrets.token_hex(6)
        existing = get_project(pid) if project_id else None
        name = str(
            payload.get("name") or (existing or {}).get("name") or "Dựng video mới"
        ).strip() or "Dựng video mới"

        if "clips" in payload and payload.get("clips") is not None:
            clips = payload.get("clips") if isinstance(payload.get("clips"), list) else []
        else:
            clips = (existing or {}).get("clips") or []

        if "filename" in payload and payload.get("filename") is not None:
            filename = str(payload.get("filename") or "")[:200]
        else:
            filename = str((existing or {}).get("filename") or "")[:200]

        doc: dict[str, Any] = {
            "id": pid,
            "name": name[:200],
            "description": str(
                payload.get("description")
                if payload.get("description") is not None
                else (existing or {}).get("description") or ""
            )[:2000],
            "clips": clips if isinstance(clips, list) else [],
            "filename": filename,
            "last_export": payload.get("last_export")
            if "last_export" in payload and payload.get("last_export") is not None
            else (existing or {}).get("last_export"),
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
        }

        path = _doc_path(pid)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

        edit_project_root(pid)

        meta = {
            "id": pid,
            "name": doc["name"],
            "description": (doc["description"] or "")[:120],
            "clip_count": len(doc["clips"]),
            "updated_at": now,
            "created_at": doc["created_at"],
            "output_folder": edit_output_folder(pid),
            "last_export_name": (doc.get("last_export") or {}).get("name"),
        }
        idx = [i for i in _load_index() if i.get("id") != pid]
        idx.append(meta)
        _save_index(idx)
        return doc


def delete_project(project_id: str, *, delete_files: bool = False) -> bool:
    with _LOCK:
        path = _doc_path(project_id)
        if path.is_file():
            path.unlink()
        _save_index([i for i in _load_index() if i.get("id") != project_id])
    if delete_files:
        import shutil

        root = settings.data_dir / "G-Labs BW" / "video_edits" / project_id
        if root.is_dir():
            shutil.rmtree(root, ignore_errors=True)
    return True


def ensure_default() -> dict[str, Any]:
    """Create a default edit project if none exist."""
    items = list_projects()
    if items:
        doc = get_project(str(items[0]["id"]))
        if doc:
            return doc
    return save_project({"name": "Dựng video 1", "clips": []})
