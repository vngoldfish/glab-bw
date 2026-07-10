"""Workflow projects — save/load full graph for ongoing work."""

from __future__ import annotations

import json
import secrets
import threading
import time
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()


def _dir():
    d = settings.data_dir / "projects"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path():
    return _dir() / "index.json"


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


def list_projects() -> list[dict[str, Any]]:
    items = _load_index()
    items.sort(key=lambda p: float(p.get("updated_at") or 0), reverse=True)
    return items


def get_project(project_id: str) -> dict[str, Any] | None:
    path = _dir() / f"{project_id}.json"
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
      name, description?, nodes, edges, viewport?,
      node_states? (resultUrls/runStatus per node for resume),
      tags?
    """
    now = time.time()
    with _LOCK:
        pid = project_id or secrets.token_hex(6)
        existing = get_project(pid) if project_id else None
        name = str(payload.get("name") or (existing or {}).get("name") or "Project mới").strip()
        if not name:
            name = "Project mới"

        nodes = payload.get("nodes")
        if nodes is None:
            nodes = (existing or {}).get("nodes") or []
        edges = payload.get("edges")
        if edges is None:
            edges = (existing or {}).get("edges") or []

        doc: dict[str, Any] = {
            "id": pid,
            "name": name[:200],
            "description": str(
                payload.get("description")
                if payload.get("description") is not None
                else (existing or {}).get("description") or ""
            )[:2000],
            "tags": payload.get("tags")
            if payload.get("tags") is not None
            else (existing or {}).get("tags") or [],
            "nodes": nodes,
            "edges": edges,
            "viewport": payload.get("viewport")
            if payload.get("viewport") is not None
            else (existing or {}).get("viewport")
            or {"x": 0, "y": 0, "zoom": 1},
            # Optional resume hints (status/results) — UI may embed in node.data too
            "node_states": payload.get("node_states")
            if payload.get("node_states") is not None
            else (existing or {}).get("node_states") or {},
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
        }

        path = _dir() / f"{pid}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

        # thumbnail: first result url found
        thumb = None
        for n in nodes:
            data = (n or {}).get("data") or {}
            urls = data.get("resultUrls") or data.get("result_urls") or []
            if urls:
                thumb = urls[0]
                break

        meta = {
            "id": pid,
            "name": doc["name"],
            "description": (doc["description"] or "")[:120],
            "updated_at": now,
            "created_at": doc["created_at"],
            "node_count": len(nodes),
            "edge_count": len(edges),
            "thumbnail": thumb,
            "tags": doc.get("tags") or [],
        }
        idx = [i for i in _load_index() if i.get("id") != pid]
        idx.append(meta)
        _save_index(idx)
        return doc


def delete_project(project_id: str) -> bool:
    with _LOCK:
        path = _dir() / f"{project_id}.json"
        if path.is_file():
            path.unlink()
        _save_index([i for i in _load_index() if i.get("id") != project_id])
        return True


def duplicate_project(project_id: str, new_name: str | None = None) -> dict[str, Any] | None:
    src = get_project(project_id)
    if not src:
        return None
    name = (new_name or f"{src.get('name') or 'Project'} (copy)").strip()
    return save_project(
        {
            "name": name,
            "description": src.get("description") or "",
            "tags": src.get("tags") or [],
            "nodes": src.get("nodes") or [],
            "edges": src.get("edges") or [],
            "viewport": src.get("viewport"),
            "node_states": src.get("node_states") or {},
        }
    )
