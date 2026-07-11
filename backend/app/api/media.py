"""Media utilities: frame extract from video."""

from __future__ import annotations

import base64
import secrets
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Query
from pydantic import BaseModel, Field


from app.core.config import settings
from app.services.frame_extract import extract_frames
from app.services.output_storage import resolve_data_file

router = APIRouter(prefix="/media", tags=["media"])


class ExtractFramesBody(BaseModel):
    """Extract from a file already under data/ (relative path or /api/files/...)."""

    file_path: str = ""
    file_url: str = ""
    positions: list[str] = Field(default_factory=lambda: ["start", "middle", "end"])


def _resolve_video_path(file_path: str = "", file_url: str = "") -> Path:
    raw = (file_path or file_url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail={"error": "Missing file_path or file_url"})
    if "/api/files/" in raw:
        raw = raw.split("/api/files/", 1)[1].split("?", 1)[0]
    from urllib.parse import unquote

    raw = unquote(raw)
    try:
        path = resolve_data_file(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail={"error": f"File not found: {raw}"})
    return path


@router.post("/extract-frames")
async def extract_frames_api(body: ExtractFramesBody) -> dict:
    path = _resolve_video_path(body.file_path, body.file_url)
    try:
        frames = extract_frames(path, positions=body.positions or ["start", "end", "middle"])
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"frames": frames, "source": path.relative_to(settings.data_dir).as_posix()}


@router.post("/extract-frames/upload")
async def extract_frames_upload(
    file: UploadFile = File(...),
    positions: str = Form(default="start,middle,end"),
) -> dict:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": "Empty file"})
    tmp_dir = settings.data_dir / "temp" / "uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    dest = tmp_dir / f"{secrets.token_hex(6)}{suffix}"
    dest.write_bytes(data)
    pos_list = [p.strip() for p in positions.split(",") if p.strip()] or [
        "start",
        "middle",
        "end",
    ]
    try:
        frames = extract_frames(dest, positions=pos_list)
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return {
        "frames": frames,
        "source": dest.relative_to(settings.data_dir).as_posix(),
    }


class FrameToDataUrlBody(BaseModel):
    file_path: str


@router.post("/file-as-data-url")
async def file_as_data_url(body: FrameToDataUrlBody) -> dict:
    try:
        path = resolve_data_file(body.file_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    raw = path.read_bytes()
    mime = "image/png"
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif path.suffix.lower() == ".webp":
        mime = "image/webp"
    b64 = base64.b64encode(raw).decode("ascii")
    return {"data_url": f"data:{mime};base64,{b64}", "path": body.file_path}


@router.delete("/delete-file")
async def delete_media_file(
    file_path: str = Query(..., description="Relative path under data/ or /api/files/ URL")
) -> dict:
    raw = file_path.strip()
    if "/api/files/" in raw:
        raw = raw.split("/api/files/", 1)[1].split("?", 1)[0]
    from urllib.parse import unquote
    raw = unquote(raw)

    try:
        path = resolve_data_file(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    if not path.is_file():
        raise HTTPException(status_code=404, detail={"error": "File not found"})

    allowed_dirs = {"image_output", "video_output", "grok_output", "meta_output", "temp", "webhook_uploads"}
    try:
        resolved_path = path.resolve()
        data_dir_resolved = settings.data_dir.resolve()
        
        # Đảm bảo không nhảy ra ngoài data dir
        if not str(resolved_path).startswith(str(data_dir_resolved)):
            raise HTTPException(status_code=403, detail={"error": "Access denied"})

        # Chỉ cho phép xóa trong các thư mục output được phép
        parts = resolved_path.relative_to(data_dir_resolved).parts
        if not any(d in parts for d in allowed_dirs):
            raise HTTPException(status_code=403, detail={"error": "Deletion not allowed in this directory"})

        # Tiến hành xóa file
        resolved_path.unlink()

        # Dọn dẹp thư mục cha nếu trống (ví dụ thư mục task_xxx)
        parent = resolved_path.parent
        if parent != data_dir_resolved and (parent.name.startswith("task_") or parent.name == "uploads"):
            try:
                # Kiểm tra thư mục có rỗng không
                if not any(parent.iterdir()):
                    parent.rmdir()
            except Exception:
                pass

        return {"status": "ok", "message": f"Deleted file: {raw}"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)})

