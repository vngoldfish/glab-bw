"""Load reference image bytes from data URLs or on-disk paths."""

from __future__ import annotations

import base64
import re
from pathlib import Path
from urllib.parse import unquote, urlparse

from app.services.output_storage import resolve_data_file

_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _mime_for_path(path: Path) -> str:
    return _EXT_MIME.get(path.suffix.lower(), "image/png")


def _decode_data_url(data: str) -> tuple[bytes, str] | None:
    if not data:
        return None
    mime_type = "image/png"
    mime_match = re.match(r"data:([^;]+);base64,", data)
    if mime_match:
        mime_type = mime_match.group(1)
    match = re.search(r"base64,(.+)$", data)
    payload = match.group(1) if match else data
    try:
        decoded = base64.b64decode(payload, validate=False)
    except Exception:
        return None
    if len(decoded) <= 100:
        return None
    return decoded, mime_type


def _normalize_storage_path(data: str) -> str | None:
    normalized = data.strip().replace("\\", "/")
    if not normalized:
        return None
    if normalized.startswith("http://") or normalized.startswith("https://"):
        parsed = urlparse(normalized)
        if parsed.path.startswith("/api/files/"):
            return unquote(parsed.path[len("/api/files/") :])
        return None
    if normalized.startswith("/api/files/"):
        return unquote(normalized[len("/api/files/") :])
    return normalized


def load_reference_image(item) -> tuple[bytes, str] | None:
    if isinstance(item, dict):
        data = item.get("data") or item.get("image") or item.get("url") or item.get("file_path") or ""
        mime_type = str(item.get("mime_type") or item.get("mimeType") or "")
    else:
        data = str(item)
        mime_type = ""

    if not data:
        return None

    if data.startswith("data:") or "base64," in data:
        return _decode_data_url(data)

    storage_path = _normalize_storage_path(data)
    if storage_path:
        try:
            path = resolve_data_file(storage_path)
        except ValueError:
            return None
        if path.is_file():
            return path.read_bytes(), mime_type or _mime_for_path(path)

    return _decode_data_url(data)