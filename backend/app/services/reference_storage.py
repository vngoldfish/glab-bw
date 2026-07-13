"""Persistent reference image library stored under data/G-Labs BW/reference_images/."""

from __future__ import annotations

import json
import os
import re
import threading
import secrets
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.output_storage import file_url_from_path

REFERENCE_FOLDER = "G-Labs BW/reference_images"
MAX_LIBRARY_ITEMS = 100
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
VALID_CATEGORIES = {"character", "scene", "prop", "other"}
_MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}
_EXT_MIME = {ext: mime for mime, ext in _MIME_EXT.items()}
_EXT_MIME[".jpeg"] = "image/jpeg"
_NAME_PATTERN = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*$")


def _root() -> Path:
    parts = REFERENCE_FOLDER.replace("\\", "/").split("/")
    return settings.data_dir.joinpath(*parts)


def manifest_path() -> Path:
    return _root() / "library.json"


def ensure_reference_dirs() -> Path:
    root = _root()
    root.mkdir(parents=True, exist_ok=True)
    return root


def slugify_ref_name(value: str) -> str:
    ascii_text = (
        unicodedata.normalize("NFD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    cleaned = re.sub(r"[^a-z0-9]+", "_", ascii_text).strip("_")
    return (cleaned or "ref")[:32]


def is_valid_ref_name(name: str) -> bool:
    return bool(_NAME_PATTERN.match(name))


_manifest_lock = threading.Lock()


def _load_manifest() -> list[dict[str, Any]]:
    with _manifest_lock:
        path = manifest_path()
        if not path.is_file():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        items = data.get("references", data if isinstance(data, list) else [])
        return items if isinstance(items, list) else []


def _save_manifest(items: list[dict[str, Any]]) -> None:
    with _manifest_lock:
        ensure_reference_dirs()
        dest = manifest_path()
        tmp = dest.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"references": items, "updated_at": _now()}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(str(tmp), str(dest))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rel_file_path(filename: str) -> str:
    return f"{REFERENCE_FOLDER}/{filename}"


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    root = _root()
    filename = str(item.get("filename") or "")
    file_path = _rel_file_path(filename)
    full = root / filename
    return {
        "id": item["id"],
        "name": item["name"],
        "label": item.get("label") or item["name"],
        "category": item.get("category") or "other",
        "filename": filename,
        "file_path": file_path,
        "image_url": file_url_from_path(full) if full.is_file() else "",
        "created_at": item.get("created_at"),
        "updated_at": item.get("updated_at"),
    }


def list_references() -> dict[str, Any]:
    ensure_reference_dirs()
    items = [_public_item(item) for item in _load_manifest()]
    return {
        "references": items,
        "folder": REFERENCE_FOLDER,
        "max_items": MAX_LIBRARY_ITEMS,
        "count": len(items),
    }


def _ensure_unique_name(name: str, items: list[dict[str, Any]], exclude_id: str | None = None) -> str:
    candidate = slugify_ref_name(name)
    if not is_valid_ref_name(candidate):
        candidate = "ref"
    suffix = 1
    taken = {
        str(item.get("name", "")).lower()
        for item in items
        if item.get("id") != exclude_id
    }
    base = candidate
    while candidate.lower() in taken:
        suffix += 1
        candidate = f"{base[:28]}_{suffix}"
    return candidate


def _guess_ext(mime_type: str, original_name: str = "") -> str:
    ext = _MIME_EXT.get(mime_type.lower())
    if ext:
        return ext
    if original_name:
        suffix = Path(original_name).suffix.lower()
        if suffix in _EXT_MIME:
            return suffix
    return ".png"


def add_reference(
    image_bytes: bytes,
    mime_type: str,
    *,
    name: str | None = None,
    label: str | None = None,
    category: str = "other",
) -> dict[str, Any]:
    if len(image_bytes) > MAX_REFERENCE_BYTES:
        raise ValueError("Ảnh quá lớn — tối đa 10MB")
    if len(image_bytes) <= 100:
        raise ValueError("File ảnh không hợp lệ")

    items = _load_manifest()
    if len(items) >= MAX_LIBRARY_ITEMS:
        raise ValueError(f"Thư viện đã đầy — tối đa {MAX_LIBRARY_ITEMS} ảnh")

    ref_id = secrets.token_hex(8)
    base_label = (label or name or "ref").strip() or "ref"
    ref_name = _ensure_unique_name(name or base_label, items)
    safe_category = category if category in VALID_CATEGORIES else "other"
    ext = _guess_ext(mime_type, base_label)
    filename = f"{ref_id}_{ref_name}{ext}"

    root = ensure_reference_dirs()
    (root / filename).write_bytes(image_bytes)

    now = _now()
    entry = {
        "id": ref_id,
        "name": ref_name,
        "label": base_label,
        "category": safe_category,
        "filename": filename,
        "created_at": now,
        "updated_at": now,
    }
    items.append(entry)
    _save_manifest(items)
    return _public_item(entry)


def update_reference(ref_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    items = _load_manifest()
    index = next((i for i, item in enumerate(items) if item.get("id") == ref_id), None)
    if index is None:
        raise KeyError(f"Reference {ref_id} not found")

    item = dict(items[index])
    if "label" in patch and patch["label"] is not None:
        item["label"] = str(patch["label"]).strip() or item["name"]
    if "category" in patch and patch["category"] in VALID_CATEGORIES:
        item["category"] = patch["category"]
    if "name" in patch and patch["name"] is not None:
        next_name = slugify_ref_name(str(patch["name"]))
        if not is_valid_ref_name(next_name):
            raise ValueError("Tên chỉ gồm chữ, số và _ — bắt đầu bằng chữ cái")
        item["name"] = _ensure_unique_name(next_name, items, exclude_id=ref_id)

    item["updated_at"] = _now()
    items[index] = item
    _save_manifest(items)
    return _public_item(item)


def replace_reference_image(ref_id: str, image_bytes: bytes, mime_type: str) -> dict[str, Any]:
    if len(image_bytes) > MAX_REFERENCE_BYTES:
        raise ValueError("Ảnh quá lớn — tối đa 10MB")

    items = _load_manifest()
    index = next((i for i, item in enumerate(items) if item.get("id") == ref_id), None)
    if index is None:
        raise KeyError(f"Reference {ref_id} not found")

    item = dict(items[index])
    root = ensure_reference_dirs()
    old_file = root / str(item.get("filename") or "")
    if old_file.is_file():
        old_file.unlink()

    ext = _guess_ext(mime_type, str(item.get("filename") or ""))
    filename = f"{ref_id}_{item['name']}{ext}"
    (root / filename).write_bytes(image_bytes)
    item["filename"] = filename
    item["updated_at"] = _now()
    items[index] = item
    _save_manifest(items)
    return _public_item(item)


def delete_reference(ref_id: str) -> None:
    items = _load_manifest()
    index = next((i for i, item in enumerate(items) if item.get("id") == ref_id), None)
    if index is None:
        raise KeyError(f"Reference {ref_id} not found")

    item = items.pop(index)
    root = _root()
    file_path = root / str(item.get("filename") or "")
    if file_path.is_file():
        file_path.unlink()
    _save_manifest(items)