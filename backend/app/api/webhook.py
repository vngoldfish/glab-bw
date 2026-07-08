import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import FileResponse

from app.api.deps import verify_api_key
from app.core.config import settings
from app.core.task_queue import TaskStatus, task_queue
from app.models.schemas import (
    GrokGenerateRequest,
    ImageGenerateRequest,
    MetaGenerateRequest,
    OpenAIGenerateRequest,
    TaskQueuedResponse,
    VideoGenerateRequest,
)

router = APIRouter()


def _task_to_status(task) -> dict:
    base = {
        "task_id": task.task_id,
        "type": task.task_type,
        "status": task.status.value,
        "prompt": task.prompt,
        "created_at": task.created_at,
    }
    if task.status == TaskStatus.COMPLETED:
        base["results"] = task.results
        base["completed_at"] = task.completed_at
    if task.status == TaskStatus.FAILED:
        base["error_code"] = task.error_code
        base["error"] = task.error
        base["error_detail"] = task.error_detail
    return base


def _queue_response(task, message: str) -> TaskQueuedResponse:
    return TaskQueuedResponse(
        task_id=task.task_id,
        status=task.status.value,
        message=message,
        poll_url=f"/api/status/{task.task_id}",
    )


@router.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "server": "G-Labs BW Webhook",
        "uptime": task_queue.uptime,
        "tasks_pending": task_queue.pending_count(),
        "tasks_running": task_queue.running_count(),
    }


@router.post("/image/generate", status_code=202, dependencies=[Depends(verify_api_key)])
async def generate_image(request: Request, body: ImageGenerateRequest) -> TaskQueuedResponse:
    task = task_queue.create_task("image", body.prompt, body.model_dump())
    return _queue_response(task, "Image task queued for processing")


@router.post("/video/generate", status_code=202, dependencies=[Depends(verify_api_key)])
async def generate_video(body: VideoGenerateRequest) -> TaskQueuedResponse:
    task = task_queue.create_task("video", body.prompt, body.model_dump())
    return _queue_response(task, "Video task queued for processing")


@router.post("/grok/generate", status_code=202, dependencies=[Depends(verify_api_key)])
async def generate_grok(body: GrokGenerateRequest) -> TaskQueuedResponse:
    task = task_queue.create_task("grok", body.prompt, body.model_dump())
    return _queue_response(task, "Grok task queued for processing")


@router.post("/meta/generate", status_code=202, dependencies=[Depends(verify_api_key)])
async def generate_meta(body: MetaGenerateRequest) -> TaskQueuedResponse:
    task = task_queue.create_task("meta", body.prompt, body.model_dump())
    return _queue_response(task, "Meta task queued for processing")


@router.post("/openai/generate", status_code=202, dependencies=[Depends(verify_api_key)])
async def generate_openai(body: OpenAIGenerateRequest) -> TaskQueuedResponse:
    task = task_queue.create_task("openai", body.prompt, body.model_dump())
    return _queue_response(task, "OpenAI task queued for processing")


@router.get("/status/{task_id}", dependencies=[Depends(verify_api_key)])
async def get_status(task_id: str) -> dict:
    task = task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail={"error": f"Task {task_id} not found"})
    return _task_to_status(task)


@router.get("/result/{task_id}", dependencies=[Depends(verify_api_key)])
async def get_result(task_id: str) -> dict:
    task = task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail={"error": f"Task {task_id} not found"})
    if task.status != TaskStatus.COMPLETED:
        return {
            "task_id": task.task_id,
            "status": task.status.value,
            "message": "Task not yet completed",
        }
    return {
        "task_id": task.task_id,
        "status": "completed",
        "results": task.results,
        "completed_at": task.completed_at,
    }


@router.get("/tasks", dependencies=[Depends(verify_api_key)])
async def list_tasks() -> dict:
    tasks = task_queue.list_tasks(limit=50)
    return {
        "tasks": [
            {
                "task_id": t.task_id,
                "type": t.task_type,
                "status": t.status.value,
                "prompt": t.prompt[:50],
                "created_at": t.created_at,
            }
            for t in tasks
        ]
    }


class OpenFolderRequest(BaseModel):
    folder: str


@router.post("/open-folder")
async def open_folder(body: OpenFolderRequest) -> dict:
    from app.services.output_storage import resolve_data_folder

    folder = body.folder.strip()
    if not folder:
        raise HTTPException(status_code=400, detail={"error": "Missing folder path"})

    try:
        path = resolve_data_folder(folder)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "Invalid folder path"}) from None

    if not path.is_dir():
        raise HTTPException(status_code=404, detail={"error": f"Folder not found: {folder}"})

    if sys.platform == "win32":
        subprocess.Popen(["explorer", str(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])

    return {"ok": True, "path": str(path)}


@router.get("/files/{file_path:path}")
async def get_file(file_path: str) -> FileResponse:
    from app.services.output_storage import resolve_data_file

    try:
        file_path_resolved = resolve_data_file(file_path)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "Invalid file path"}) from None

    if not file_path_resolved.is_file():
        # Back-compat: flat files saved before subfolder support
        legacy = settings.output_dir / Path(file_path).name
        if legacy.is_file():
            file_path_resolved = legacy
        else:
            raise HTTPException(
                status_code=404,
                detail={"error": f"File not found: {file_path}"},
            )

    media_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
    }
    media_type = media_types.get(file_path_resolved.suffix.lower(), "application/octet-stream")
    return FileResponse(file_path_resolved, media_type=media_type)