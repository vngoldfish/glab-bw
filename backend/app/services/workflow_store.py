"""Persist workflow graphs (G-Labs-style node editor)."""

from __future__ import annotations

import json
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()


def _dir() -> Path:
    d = settings.data_dir / "workflows"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _index_path() -> Path:
    return _dir() / "index.json"


def _load_index() -> list[dict[str, Any]]:
    path = _index_path()
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return list(data.get("workflows") or [])
    except Exception:
        return []


def _save_index(items: list[dict[str, Any]]) -> None:
    path = _index_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(
        json.dumps({"workflows": items}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def list_workflows() -> list[dict[str, Any]]:
    items = _load_index()
    items.sort(key=lambda w: float(w.get("updated_at") or 0), reverse=True)
    return items


def get_workflow(workflow_id: str) -> dict[str, Any] | None:
    path = _dir() / f"{workflow_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_workflow(payload: dict[str, Any], workflow_id: str | None = None) -> dict[str, Any]:
    """Create or update workflow. payload: name, nodes, edges, viewport?"""
    now = time.time()
    with _LOCK:
        wid = workflow_id or secrets.token_hex(6)
        existing = get_workflow(wid) if workflow_id else None
        doc = {
            "id": wid,
            "name": str(payload.get("name") or (existing or {}).get("name") or "Untitled").strip()
            or "Untitled",
            "nodes": payload.get("nodes") if payload.get("nodes") is not None else (existing or {}).get("nodes") or [],
            "edges": payload.get("edges") if payload.get("edges") is not None else (existing or {}).get("edges") or [],
            "viewport": payload.get("viewport")
            if payload.get("viewport") is not None
            else (existing or {}).get("viewport")
            or {"x": 0, "y": 0, "zoom": 1},
            "created_at": (existing or {}).get("created_at") or now,
            "updated_at": now,
        }
        path = _dir() / f"{wid}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

        idx = _load_index()
        meta = {
            "id": wid,
            "name": doc["name"],
            "updated_at": now,
            "created_at": doc["created_at"],
            "node_count": len(doc["nodes"]),
        }
        idx = [i for i in idx if i.get("id") != wid]
        idx.append(meta)
        _save_index(idx)
        return doc


def delete_workflow(workflow_id: str) -> bool:
    with _LOCK:
        path = _dir() / f"{workflow_id}.json"
        if path.is_file():
            path.unlink()
        idx = [i for i in _load_index() if i.get("id") != workflow_id]
        _save_index(idx)
        return True


def default_sample() -> dict[str, Any]:
    """Minimal G-Labs-like sample: Prompt → Generate Image → Video."""
    return {
        "name": "Mẫu: Prompt → Ảnh → Video",
        "nodes": [
            {
                "id": "n_prompt",
                "type": "prompt",
                "position": {"x": 80, "y": 120},
                "data": {
                    "title": "Prompt",
                    "prompt": "A cinematic cat walking in neon city, rain, night",
                },
            },
            {
                "id": "n_gen",
                "type": "generate",
                "position": {"x": 420, "y": 100},
                "data": {
                    "title": "Tạo ảnh",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "16:9",
                },
            },
            {
                "id": "n_video",
                "type": "video_generate",
                "position": {"x": 760, "y": 100},
                "data": {
                    "title": "Tạo video",
                    "model": "veo_31_fast",
                    "aspect_ratio": "16:9",
                    "mode": "start_image",
                },
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n_prompt",
                "target": "n_gen",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
            {
                "id": "e2",
                "source": "n_gen",
                "target": "n_video",
                "sourceHandle": "image",
                "targetHandle": "start_image",
            },
            {
                "id": "e3",
                "source": "n_prompt",
                "target": "n_video",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.9},
    }


def sample_video_chain() -> dict[str, Any]:
    """Ảnh → Video1 → tách khung cuối → Video2 (nối tiếp từ frame cuối)."""
    return {
        "name": "Mẫu: Ảnh → Video → Frame cuối → Video 2",
        "nodes": [
            {
                "id": "n_prompt1",
                "type": "prompt",
                "position": {"x": 40, "y": 40},
                "data": {
                    "title": "Prompt ảnh + Video 1",
                    "prompt": "A person standing on a cliff at sunset, cinematic, wide shot",
                },
            },
            {
                "id": "n_prompt2",
                "type": "prompt",
                "position": {"x": 40, "y": 320},
                "data": {
                    "title": "Prompt Video 2 (tiếp)",
                    "prompt": "Camera slowly pushes in, wind in hair, golden hour continues, smooth motion",
                },
            },
            {
                "id": "n_gen",
                "type": "generate",
                "position": {"x": 380, "y": 40},
                "data": {
                    "title": "1. Tạo ảnh",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "16:9",
                },
            },
            {
                "id": "n_vid1",
                "type": "video_generate",
                "position": {"x": 720, "y": 40},
                "data": {
                    "title": "2. Video đoạn 1",
                    "model": "veo_31_fast",
                    "aspect_ratio": "16:9",
                    "mode": "start_image",
                },
            },
            {
                "id": "n_frame",
                "type": "frame_extract",
                "position": {"x": 1060, "y": 40},
                "data": {
                    "title": "3. Lấy khung cuối",
                    # chỉ end — tránh nhầm frame đầu khi nối image
                    "positions": "end",
                },
            },
            {
                "id": "n_vid2",
                "type": "video_generate",
                "position": {"x": 1060, "y": 300},
                "data": {
                    "title": "4. Video đoạn 2 (từ frame cuối)",
                    "model": "veo_31_fast",
                    "aspect_ratio": "16:9",
                    "mode": "start_image",
                },
            },
        ],
        "edges": [
            {
                "id": "e1",
                "source": "n_prompt1",
                "target": "n_gen",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
            {
                "id": "e2",
                "source": "n_prompt1",
                "target": "n_vid1",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
            {
                "id": "e3",
                "source": "n_gen",
                "target": "n_vid1",
                "sourceHandle": "image",
                "targetHandle": "start_image",
            },
            {
                "id": "e4",
                "source": "n_vid1",
                "target": "n_frame",
                "sourceHandle": "video",
                "targetHandle": "video",
            },
            {
                "id": "e5",
                "source": "n_frame",
                "target": "n_vid2",
                "sourceHandle": "end_image",
                "targetHandle": "start_image",
            },
            {
                "id": "e6",
                "source": "n_prompt2",
                "target": "n_vid2",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.75},
    }
