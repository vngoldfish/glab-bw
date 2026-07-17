"""Browse media from Workflow projects, Flow Video, Flow Ảnh (shared folders)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.output_storage import file_url_from_path

_VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}
_IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _kind_of(path: Path) -> str:
    if path.suffix.lower() in _VIDEO_EXT:
        return "video"
    if path.suffix.lower() in _IMAGE_EXT:
        return "image"
    return "other"


def _scan_dir(
    root: Path,
    *,
    kind: str | None = None,
    limit: int = 200,
    recursive: bool = True,
) -> list[dict[str, Any]]:
    if not root.is_dir():
        return []
    data_root = settings.data_dir.resolve()
    items: list[dict[str, Any]] = []
    iterator = root.rglob("*") if recursive else root.iterdir()
    for p in iterator:
        if not p.is_file():
            continue
        k = _kind_of(p)
        if k == "other":
            continue
        if kind in {"video", "videos"} and k != "video":
            continue
        if kind in {"image", "images"} and k != "image":
            continue
        try:
            full = p.resolve()
            rel = full.relative_to(data_root).as_posix()
            st = full.stat()
        except Exception:
            continue
        items.append(
            {
                "path": rel,
                "name": p.name,
                "kind": k,
                "url": file_url_from_path(full),
                "bytes": st.st_size,
                "mb": round(st.st_size / (1024 * 1024), 3),
                "mtime": st.st_mtime,
                "folder": full.parent.relative_to(data_root).as_posix(),
            }
        )
    items.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
    return items[: max(1, min(limit, 500))]


# Built-in shared library folders (Flow Ảnh / Flow Video)
FLOW_VIDEO_FOLDERS = [
    "G-Labs BW/video_output",
    "G-Labs BW/media_output",
    "G-Labs BW/meta_output",
    "G-Labs BW/grok_output",
]
FLOW_IMAGE_FOLDERS = [
    "G-Labs BW/image_output",
    "G-Labs BW/media_output",
    "G-Labs BW/meta_output",
    "G-Labs BW/grok_output",
]


def list_flow_video(*, limit: int = 200) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for folder in FLOW_VIDEO_FOLDERS:
        for it in _scan_dir(settings.data_dir / folder, kind="video", limit=limit):
            p = str(it["path"])
            if p in seen:
                continue
            seen.add(p)
            it = {**it, "source": "flow_video"}
            out.append(it)
    out.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
    return out[:limit]


def list_flow_image(*, limit: int = 200) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for folder in FLOW_IMAGE_FOLDERS:
        for it in _scan_dir(settings.data_dir / folder, kind="image", limit=limit):
            p = str(it["path"])
            if p in seen:
                continue
            seen.add(p)
            it = {**it, "source": "flow_image"}
            out.append(it)
    out.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
    return out[:limit]


def list_workflow_project_media(
    project_id: str,
    *,
    kind: str | None = "video",
    limit: int = 200,
) -> list[dict[str, Any]]:
    from app.services.project_outputs import list_assets

    assets = list_assets(project_id, kind=kind, limit=limit)
    return [{**a, "source": "workflow", "workflow_project_id": project_id} for a in assets]


def list_source(
    source: str,
    *,
    workflow_project_id: str | None = None,
    kind: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """
    source: workflow | flow_video | flow_image
    """
    src = (source or "").strip().lower()
    if src == "workflow":
        if not workflow_project_id:
            return []
        k = kind or "video"
        return list_workflow_project_media(workflow_project_id, kind=k, limit=limit)
    if src in {"flow_video", "video", "flow-video"}:
        return list_flow_video(limit=limit)
    if src in {"flow_image", "image", "flow-image", "flow_anh"}:
        return list_flow_image(limit=limit)
    if src == "all":
        from app.services import project_store as wf_store
        from app.services.project_outputs import list_assets

        projects = wf_store.list_projects(with_assets=False)
        out: list[dict[str, Any]] = []
        seen: set[str] = set()

        for folder in FLOW_VIDEO_FOLDERS:
            for it in _scan_dir(settings.data_dir / folder, kind=None, limit=limit):
                p = str(it["path"])
                if p not in seen:
                    seen.add(p)
                    out.append({**it, "source": "flow_video"})

        for folder in FLOW_IMAGE_FOLDERS:
            for it in _scan_dir(settings.data_dir / folder, kind=None, limit=limit):
                p = str(it["path"])
                if p not in seen:
                    seen.add(p)
                    out.append({**it, "source": "flow_image"})

        for proj in projects[:10]:
            pid = str(proj["id"])
            try:
                assets = list_assets(pid, kind=None, limit=limit)
                for it in assets:
                    p = str(it["path"])
                    if p not in seen:
                        seen.add(p)
                        out.append({**it, "source": "workflow", "workflow_project_id": pid})
            except Exception:
                pass

        out.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
        return out[:limit]
    raise ValueError(f"Nguồn không hợp lệ: {source}")
