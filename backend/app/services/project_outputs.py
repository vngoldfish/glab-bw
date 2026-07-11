"""Per-project media folders and asset catalog."""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from app.core.config import settings
from app.services.output_storage import file_url_from_path


def project_root(project_id: str) -> Path:
    root = settings.data_dir / "G-Labs BW" / "projects" / project_id
    (root / "images").mkdir(parents=True, exist_ok=True)
    (root / "videos").mkdir(parents=True, exist_ok=True)
    (root / "frames").mkdir(parents=True, exist_ok=True)
    (root / "runs").mkdir(parents=True, exist_ok=True)
    (root / "exports").mkdir(parents=True, exist_ok=True)
    (root / "audio").mkdir(parents=True, exist_ok=True)
    return root


def project_output_folder(project_id: str, kind: str) -> str:
    """Relative folder under data/ for generation save."""
    return f"G-Labs BW/projects/{project_id}"


def _is_media(path: Path) -> bool:
    return path.suffix.lower() in {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".mp4",
        ".webm",
        ".mov",
    }


def _kind_of(path: Path) -> str:
    if path.suffix.lower() in {".mp4", ".webm", ".mov"}:
        return "video"
    return "image"


def list_assets(project_id: str, *, kind: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    roots = [
        project_root(project_id),
        settings.data_dir / "workflow" / "anh",
        settings.data_dir / "workflow" / "video"
    ]
    data_root = settings.data_dir.resolve()
    items: list[dict[str, Any]] = []
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or not _is_media(p):
                continue
            k = _kind_of(p)
            if kind in {"image", "images"} and k != "image":
                continue
            if kind in {"video", "videos"} and k != "video":
                continue
            try:
                rel = p.resolve().relative_to(data_root).as_posix()
                st = p.stat()
            except Exception:
                continue
            items.append(
                {
                    "path": rel,
                    "name": p.name,
                    "kind": k,
                    "url": file_url_from_path(p),
                    "bytes": st.st_size,
                    "mb": round(st.st_size / (1024 * 1024), 3),
                    "mtime": st.st_mtime,
                    "folder": p.parent.relative_to(data_root).as_posix(),
                }
            )
    # Dedupe by path (same file can appear twice via rglob edge cases / links)
    seen_paths: set[str] = set()
    unique: list[dict[str, Any]] = []
    for it in items:
        pth = str(it.get("path") or "")
        if pth and pth in seen_paths:
            continue
        if pth:
            seen_paths.add(pth)
        unique.append(it)
    unique.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
    return unique[: max(1, min(limit, 500))]


def asset_stats(project_id: str) -> dict[str, Any]:
    assets = list_assets(project_id, limit=500)
    images = [a for a in assets if a["kind"] == "image"]
    videos = [a for a in assets if a["kind"] == "video"]
    total_bytes = sum(int(a.get("bytes") or 0) for a in assets)
    return {
        "images": len(images),
        "videos": len(videos),
        "total": len(assets),
        "total_mb": round(total_bytes / (1024 * 1024), 2),
        "thumbnails": [a["url"] for a in images[:4]],
        "latest": assets[0] if assets else None,
    }


def delete_asset(project_id: str, rel_path: str) -> bool:
    data_root = settings.data_dir.resolve()
    raw = unquote((rel_path or "").strip())
    if "/api/files/" in raw:
        raw = raw.split("/api/files/", 1)[1].split("?", 1)[0]
        raw = unquote(raw)
    full = (settings.data_dir / raw).resolve()
    proj = project_root(project_id).resolve()
    try:
        full.relative_to(proj)
    except ValueError:
        return False
    if full.is_file() and full.exists():
        full.unlink()
        return True
    return False


def clear_outputs(project_id: str, *, kind: str | None = None) -> dict[str, int]:
    """Delete media under project output folders. kind=image|video|all"""
    root = project_root(project_id)
    removed = 0
    freed = 0
    targets: list[Path] = []
    if kind in (None, "all", ""):
        targets = [root / "images", root / "videos", root / "frames", root / "runs"]
    elif kind in {"image", "images"}:
        targets = [root / "images", root / "frames"]
    elif kind in {"video", "videos"}:
        targets = [root / "videos"]
    else:
        targets = [root / "images", root / "videos", root / "frames"]

    for folder in targets:
        if not folder.is_dir():
            continue
        for p in folder.rglob("*"):
            if p.is_file() and _is_media(p):
                try:
                    sz = p.stat().st_size
                    p.unlink()
                    removed += 1
                    freed += sz
                except OSError:
                    pass
    return {"removed": removed, "freed_mb": round(freed / (1024 * 1024), 2)}


def open_project_folder(project_id: str) -> Path:
    return project_root(project_id)
