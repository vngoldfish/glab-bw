"""Resolve output folders and build file URLs for generated assets."""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from app.core.config import settings
from app.core.task_queue import Task

_INVALID_CHARS = '<>:"|?*'


def sanitize_output_folder(folder: str) -> Path:
    raw = (folder or "image_output").strip().replace("\\", "/")
    parts: list[str] = []
    for part in raw.split("/"):
        part = part.strip()
        if not part or part in {".", ".."}:
            continue
        cleaned = "".join(ch for ch in part if ch not in _INVALID_CHARS).strip()
        if cleaned:
            parts.append(cleaned)
    if not parts:
        parts = ["image_output"]
    return settings.data_dir.joinpath(*parts)


def resolve_task_output_dir(task: Task) -> Path:
    base = sanitize_output_folder(str(task.payload.get("output_folder", "image_output")))
    if str(task.payload.get("save_mode", "flat")).lower() == "task":
        base = base / f"task_{task.task_id}"
    base.mkdir(parents=True, exist_ok=True)
    return base


def file_url_from_path(path: Path) -> str:
    data_root = settings.data_dir.resolve()
    resolved = path.resolve()
    rel = resolved.relative_to(data_root)
    posix = rel.as_posix()
    return f"http://{settings.host}:{settings.port}/api/files/{quote(posix, safe='/')}"


def resolve_data_file(file_path: str) -> Path:
    candidate = Path(file_path.replace("\\", "/"))
    if ".." in candidate.parts:
        raise ValueError("Invalid path")
    full = (settings.data_dir / candidate).resolve()
    root = settings.data_dir.resolve()
    if not str(full).startswith(str(root)):
        raise ValueError("Path outside data directory")
    return full


def resolve_data_folder(folder_path: str) -> Path:
    full = resolve_data_file(folder_path)
    if full.is_file():
        full = full.parent
    return full


def copy_to_central_dir(src_path: Path, category: str, file_type: str) -> None:
    import shutil
    import logging
    logger = logging.getLogger(__name__)
    try:
        dest_dir = settings.data_dir / category / file_type
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / src_path.name
        shutil.copy2(str(src_path), str(dest_path))
    except Exception as e:
        logger.error(f"Error copying to central dir {category}/{file_type}: {e}")