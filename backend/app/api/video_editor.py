"""Video Editor API — multi-track timeline assemble (video + audio + text).

Edit projects (dựng video) are separate from Workflow projects.
Insert media from: workflow project | Flow Video | Flow Ảnh.
"""

from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services import edit_project_store as edit_store
from app.services import media_browse
from app.services import video_assemble
from app.services.output_storage import file_url_from_path

router = APIRouter(prefix="/video-editor", tags=["video-editor"])


class ClipIn(BaseModel):
    path: str | None = None
    url: str | None = None
    trim_start: float | None = None
    trim_end: float | None = None
    title: str | None = None


class AudioIn(BaseModel):
    path: str | None = None
    url: str | None = None
    start: float = 0  # position on master timeline (seconds)
    trim_start: float | None = None
    trim_end: float | None = None
    volume: float = 1.0
    title: str | None = None


class TextIn(BaseModel):
    text: str = ""
    start: float = 0
    end: float = 3
    style: str = "subtitle"  # title|subtitle|caption|lower|credit|top|center_box|news
    color: str = "white"
    font_size: int | None = None
    # Position of text center as % of frame (0–100). None = style default.
    x_pct: float | None = None
    y_pct: float | None = None


class AssembleRequest(BaseModel):
    clips: list[ClipIn] = Field(min_length=1, max_length=80)
    audios: list[AudioIn] = Field(default_factory=list, max_length=20)
    texts: list[TextIn] = Field(default_factory=list, max_length=40)
    # Workflow project (legacy) — prefer edit_project_id for dựng video
    project_id: str | None = None
    edit_project_id: str | None = None
    output_folder: str | None = None
    filename: str | None = None
    reencode: bool = True


class ProbeRequest(BaseModel):
    sources: list[str] = Field(min_length=1, max_length=80)


class EditProjectSave(BaseModel):
    name: str = "Dựng video mới"
    description: str = ""
    # None = keep existing clips (PATCH-like put); list = replace
    clips: list[dict[str, Any]] | None = None
    filename: str | None = None
    last_export: dict[str, Any] | None = None


class EditProjectMeta(BaseModel):
    name: str | None = None
    description: str | None = None
    filename: str | None = None


def _resolve_assemble_output(
    *,
    edit_project_id: str | None,
    project_id: str | None,
    output_folder: str | None,
) -> tuple[str | None, str | None]:
    """Return (workflow_project_id, output_folder) for assemble.

    Edit projects write to G-Labs BW/video_edits/{id}/exports (not workflow folders).
    """
    if edit_project_id:
        if not edit_store.get_project(edit_project_id):
            raise HTTPException(status_code=404, detail={"error": "Edit project not found"})
        edit_store.edit_project_root(edit_project_id)
        return None, edit_store.edit_output_folder(edit_project_id)
    return project_id, output_folder


@router.get("/status")
async def editor_status() -> dict:
    import shutil

    return {
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ffprobe": bool(shutil.which("ffprobe")),
        "ready": bool(shutil.which("ffmpeg")),
        "text_styles": [
            "title",
            "subtitle",
            "caption",
            "lower",
            "credit",
            "top",
            "center_box",
            "news",
        ],
        "message": (
            "Sẵn sàng dựng video (timeline + audio + text)"
            if shutil.which("ffmpeg")
            else "Cần cài ffmpeg (brew install ffmpeg)"
        ),
    }


@router.post("/probe")
async def probe_clips(body: ProbeRequest) -> dict:
    try:
        items = await video_assemble.probe_sources(body.sources)
    except Exception as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"items": items}


@router.post("/assemble")
async def assemble_video(body: AssembleRequest) -> dict:
    clips = [c.model_dump(exclude_none=True) for c in body.clips]
    audios = [a.model_dump(exclude_none=True) for a in body.audios]
    texts = [t.model_dump(exclude_none=True) for t in body.texts]
    wf_pid, out_folder = _resolve_assemble_output(
        edit_project_id=body.edit_project_id,
        project_id=body.project_id,
        output_folder=body.output_folder,
    )
    try:
        if audios or texts:
            result = await video_assemble.assemble_timeline(
                clips,
                audios=audios,
                texts=texts,
                project_id=wf_pid,
                output_folder=out_folder,
                filename=body.filename,
                reencode=body.reencode,
            )
        else:
            result = await video_assemble.assemble_clips(
                clips,
                project_id=wf_pid,
                output_folder=out_folder,
                filename=body.filename,
                reencode=body.reencode,
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc

    # Persist last export on edit project
    if body.edit_project_id and result:
        try:
            existing = edit_store.get_project(body.edit_project_id)
            if existing:
                edit_store.save_project(
                    {
                        "name": existing.get("name"),
                        "description": existing.get("description") or "",
                        "clips": existing.get("clips") or [],
                        "filename": existing.get("filename") or "",
                        "last_export": {
                            "path": result.get("path"),
                            "url": result.get("url"),
                            "name": result.get("name"),
                            "folder": result.get("folder"),
                        },
                    },
                    project_id=body.edit_project_id,
                )
        except Exception:
            pass
    return result


# ── Edit projects (dựng video — riêng, không dùng chung Workflow) ──


@router.get("/edit-projects")
async def list_edit_projects() -> dict:
    return {"projects": edit_store.list_projects()}


@router.post("/edit-projects", status_code=201)
async def create_edit_project(body: EditProjectSave) -> dict:
    doc = edit_store.save_project(body.model_dump())
    return {"project": doc}


@router.get("/edit-projects/{project_id}")
async def get_edit_project(project_id: str) -> dict:
    doc = edit_store.get_project(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Edit project not found"})
    return {
        "project": {
            **doc,
            "output_folder": edit_store.edit_output_folder(project_id),
        }
    }


@router.put("/edit-projects/{project_id}")
async def update_edit_project(project_id: str, body: EditProjectSave) -> dict:
    if not edit_store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Edit project not found"})
    doc = edit_store.save_project(body.model_dump(), project_id=project_id)
    return {"project": doc}


@router.patch("/edit-projects/{project_id}")
async def patch_edit_project(project_id: str, body: EditProjectMeta) -> dict:
    existing = edit_store.get_project(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Edit project not found"})
    payload = {
        "name": body.name if body.name is not None else existing.get("name"),
        "description": body.description
        if body.description is not None
        else existing.get("description"),
        "clips": existing.get("clips") or [],
        "filename": body.filename if body.filename is not None else existing.get("filename"),
        "last_export": existing.get("last_export"),
    }
    doc = edit_store.save_project(payload, project_id=project_id)
    return {"project": doc}


@router.delete("/edit-projects/{project_id}")
async def delete_edit_project(
    project_id: str,
    delete_files: bool = Query(default=False),
) -> dict:
    if not edit_store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Edit project not found"})
    edit_store.delete_project(project_id, delete_files=delete_files)
    return {"ok": True}


# ── Insert media sources (workflow | flow_video | flow_image) ──


@router.get("/media-sources")
async def media_sources() -> dict:
    """Describe available insert sources (not edit projects)."""
    from app.services import project_store as wf_store

    wf = wf_store.list_projects(with_assets=False)
    return {
        "sources": [
            {
                "id": "workflow",
                "label": "Project Workflow",
                "description": "Video/ảnh đã gen trong project workflow",
                "needs_project": True,
            },
            {
                "id": "flow_video",
                "label": "Flow Video",
                "description": "Thư mục G-Labs BW/video_output (+ grok video)",
                "needs_project": False,
            },
            {
                "id": "flow_image",
                "label": "Flow Ảnh",
                "description": "Thư mục G-Labs BW/image_output (+ grok ảnh)",
                "needs_project": False,
            },
        ],
        "workflow_projects": [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "updated_at": p.get("updated_at"),
            }
            for p in wf
        ],
    }


@router.get("/media-browse")
async def browse_media(
    source: str = Query(..., description="workflow | flow_video | flow_image"),
    workflow_project_id: str | None = Query(default=None),
    kind: str | None = Query(default=None, description="video|image|all"),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    """List media for the insert picker (not edit project assets)."""
    try:
        # For workflow, default to videos for stitcher; allow kind override
        k = kind
        if source == "workflow" and not k:
            k = "video"
        if k == "all":
            k = None
        assets = media_browse.list_source(
            source,
            workflow_project_id=workflow_project_id,
            kind=k,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    if source == "workflow" and workflow_project_id:
        from app.services import project_store as wf_store

        if not wf_store.get_project(workflow_project_id):
            raise HTTPException(status_code=404, detail={"error": "Workflow project not found"})
    return {
        "source": source,
        "workflow_project_id": workflow_project_id,
        "kind": kind,
        "assets": assets,
        "count": len(assets),
    }


@router.post("/upload-audio")
async def upload_audio(
    file: UploadFile = File(...),
    project_id: str | None = Form(default=None),
) -> dict:
    if file.size is not None and file.size > 80 * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error": "File quá lớn (max 80MB)"})
    data = await file.read()
    if len(data) > 80 * 1024 * 1024:
        raise HTTPException(status_code=400, detail={"error": "File quá lớn (max 80MB)"})
    try:
        result = video_assemble.save_upload_bytes(
            data,
            filename=file.filename or "audio.mp3",
            project_id=project_id or None,
            kind="audio",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return result


@router.get("/audio-library")
async def list_audio_library(project_id: str | None = None) -> dict:
    """List audio files in project/audio or global audio_library."""
    roots: list[Path] = []
    if project_id:
        from app.services.project_outputs import project_root

        roots.append(project_root(project_id) / "audio")
    roots.append(settings.data_dir / "G-Labs BW" / "audio_library")
    items: list[dict] = []
    seen: set[str] = set()
    for root in roots:
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*"), key=lambda x: x.stat().st_mtime if x.is_file() else 0, reverse=True):
            if not p.is_file():
                continue
            if p.suffix.lower() not in {
                ".mp3",
                ".wav",
                ".m4a",
                ".aac",
                ".ogg",
                ".flac",
                ".mp4",
                ".mov",
            }:
                continue
            try:
                rel = p.resolve().relative_to(settings.data_dir.resolve()).as_posix()
            except Exception:
                continue
            if rel in seen:
                continue
            seen.add(rel)
            st = p.stat()
            items.append(
                {
                    "path": rel,
                    "name": p.name,
                    "url": file_url_from_path(p),
                    "bytes": st.st_size,
                    "mb": round(st.st_size / (1024 * 1024), 3),
                    "mtime": st.st_mtime,
                }
            )
            if len(items) >= 100:
                break
    return {"items": items}
