"""Persist workflow graphs (G-Labs-style node editor)."""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import settings

_LOCK = threading.Lock()

_SAFE_ID = re.compile(r'^[a-zA-Z0-9_\-]+$')


def _validate_id(identifier: str) -> str:
    """Validate and return the identifier, raising ValueError if unsafe."""
    if not identifier or not _SAFE_ID.match(identifier):
        raise ValueError(f"Invalid ID: {identifier!r}")
    return identifier


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
    _validate_id(workflow_id)
    path = _dir() / f"{workflow_id}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_workflow(payload: dict[str, Any], workflow_id: str | None = None) -> dict[str, Any]:
    """Create or update workflow. payload: name, nodes, edges, viewport?"""
    if workflow_id is not None:
        _validate_id(workflow_id)
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
    _validate_id(workflow_id)
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


def sample_product_isolate() -> dict[str, Any]:
    """Bóc tách sản phẩm: Ảnh sản phẩm gốc -> Prompt bóc tách -> Tạo ảnh sản phẩm sạch nền trắng."""
    return {
        "name": "Mẫu: Bóc tách sản phẩm",
        "nodes": [
            {
                "id": "n_ref_raw",
                "type": "reference",
                "position": {"x": 40, "y": 80},
                "data": {
                    "title": "Ảnh gốc sản phẩm",
                    "image": "",
                    "refName": "san_pham_goc",
                },
            },
            {
                "id": "n_prompt_iso",
                "type": "prompt",
                "position": {"x": 40, "y": 320},
                "data": {
                    "title": "Prompt tách nền",
                    "prompt": "A professional studio product shot of the item in @san_pham_goc, isolated on a pure solid white background, clean shadow, sharp details, commercial photography",
                },
            },
            {
                "id": "n_gen_clean",
                "type": "generate",
                "position": {"x": 420, "y": 140},
                "data": {
                    "title": "Tạo ảnh sạch nền",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "1:1",
                },
            },
        ],
        "edges": [
            {
                "id": "e_iso_1",
                "source": "n_ref_raw",
                "target": "n_gen_clean",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_iso_2",
                "source": "n_prompt_iso",
                "target": "n_gen_clean",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.85},
    }


def sample_product_placement() -> dict[str, Any]:
    """Ghép sản phẩm vào nhân vật: Ảnh sản phẩm + Ảnh nhân vật -> Prompt ghép -> Tạo ảnh mới."""
    return {
        "name": "Mẫu: Ghép sản phẩm vào nhân vật",
        "nodes": [
            {
                "id": "n_ref_prod",
                "type": "reference",
                "position": {"x": 40, "y": 40},
                "data": {
                    "title": "Ảnh sản phẩm",
                    "image": "",
                    "refName": "san_pham",
                },
            },
            {
                "id": "n_ref_char",
                "type": "reference",
                "position": {"x": 40, "y": 280},
                "data": {
                    "title": "Ảnh nhân vật",
                    "image": "",
                    "refName": "nhan_vat",
                },
            },
            {
                "id": "n_prompt_merge",
                "type": "prompt",
                "position": {"x": 40, "y": 520},
                "data": {
                    "title": "Prompt ghép cảnh",
                    "prompt": "A professional model (style of @nhan_vat) wearing the shoes from @san_pham, walking down a street in New York, cinematic lighting, 8k resolution, sharp focus",
                },
            },
            {
                "id": "n_gen_merge",
                "type": "generate",
                "position": {"x": 460, "y": 200},
                "data": {
                    "title": "Tạo ảnh ghép",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "16:9",
                },
            },
        ],
        "edges": [
            {
                "id": "e_merge_1",
                "source": "n_ref_prod",
                "target": "n_gen_merge",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_merge_2",
                "source": "n_ref_char",
                "target": "n_gen_merge",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_merge_3",
                "source": "n_prompt_merge",
                "target": "n_gen_merge",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.8},
    }


def sample_multi_product_isolate() -> dict[str, Any]:
    """Bóc tách nhiều sản phẩm: 1 Ảnh gốc chứa nhiều đồ -> 3 Prompt bóc tách riêng -> 3 Ảnh sản phẩm sạch khác nhau."""
    return {
        "name": "Mẫu: Bóc tách nhiều sản phẩm",
        "nodes": [
            {
                "id": "n_ref_raw",
                "type": "reference",
                "position": {"x": 40, "y": 280},
                "data": {
                    "title": "Ảnh gốc nhiều đồ",
                    "image": "",
                    "refName": "bo_do_dac",
                },
            },
            # Item 1: Giày
            {
                "id": "n_prompt_item1",
                "type": "prompt",
                "position": {"x": 380, "y": 40},
                "data": {
                    "title": "Prompt tách Giày",
                    "prompt": "A professional studio product shot of only the shoes from @bo_do_dac, isolated on a pure solid white background, commercial photography",
                },
            },
            {
                "id": "n_gen_item1",
                "type": "generate",
                "position": {"x": 720, "y": 40},
                "data": {
                    "title": "Tách Giày",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "1:1",
                },
            },
            # Item 2: Túi xách
            {
                "id": "n_prompt_item2",
                "type": "prompt",
                "position": {"x": 380, "y": 280},
                "data": {
                    "title": "Prompt tách Túi",
                    "prompt": "A professional studio product shot of only the leather handbag from @bo_do_dac, isolated on a pure solid white background, commercial photography",
                },
            },
            {
                "id": "n_gen_item2",
                "type": "generate",
                "position": {"x": 720, "y": 280},
                "data": {
                    "title": "Tách Túi",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "1:1",
                },
            },
            # Item 3: Kính mắt
            {
                "id": "n_prompt_item3",
                "type": "prompt",
                "position": {"x": 380, "y": 520},
                "data": {
                    "title": "Prompt tách Kính",
                    "prompt": "A professional studio product shot of only the sunglasses from @bo_do_dac, isolated on a pure solid white background, commercial photography",
                },
            },
            {
                "id": "n_gen_item3",
                "type": "generate",
                "position": {"x": 720, "y": 520},
                "data": {
                    "title": "Tách Kính",
                    "model": "nano_banana_2_lite",
                    "aspect_ratio": "1:1",
                },
            },
        ],
        "edges": [
            # Link Giày
            {
                "id": "e_i1_1",
                "source": "n_ref_raw",
                "target": "n_gen_item1",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_i1_2",
                "source": "n_prompt_item1",
                "target": "n_gen_item1",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
            # Link Túi
            {
                "id": "e_i2_1",
                "source": "n_ref_raw",
                "target": "n_gen_item2",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_i2_2",
                "source": "n_prompt_item2",
                "target": "n_gen_item2",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
            # Link Kính
            {
                "id": "e_i3_1",
                "source": "n_ref_raw",
                "target": "n_gen_item3",
                "sourceHandle": "image",
                "targetHandle": "image",
            },
            {
                "id": "e_i3_2",
                "source": "n_prompt_item3",
                "target": "n_gen_item3",
                "sourceHandle": "prompt",
                "targetHandle": "prompt",
            },
        ],
        "viewport": {"x": 0, "y": 0, "zoom": 0.65},
    }


