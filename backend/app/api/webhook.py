import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
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
    """Liveness + operator readiness hints (extension, accounts, disk)."""
    from app.services.account_store import account_store
    from app.services.auth_bridge import auth_bridge as auth_bridge_state
    from app.services.session_health import session_health

    flow_accounts = [
        a
        for a in account_store.list_accounts("flow")
        if a.enabled and a.credentials
    ]
    flow_image_ready = len(account_store.list_eligible("flow", for_video=False))
    flow_video_ready = len(account_store.list_eligible("flow", for_video=True))
    grok_ready = len(account_store.list_eligible("grok", for_video=False)) + len(
        account_store.list_eligible("grok", for_video=True)
    )

    ext = auth_bridge_state.status_payload()
    sh = session_health.payload()
    disk_free_gb: float | None = None
    try:
        import shutil

        usage = shutil.disk_usage(str(settings.data_dir))
        disk_free_gb = round(usage.free / (1024**3), 2)
    except OSError:
        pass

    ext_ok = bool(ext.get("connected"))
    flow_tab_open = str(ext.get("flow_tab") or "") == "open"
    has_account = flow_image_ready > 0 or flow_video_ready > 0 or grok_ready > 0
    disk_ok = disk_free_gb is None or disk_free_gb >= 1.0
    session_ok = bool(sh.get("flow_session_ok", True))

    # Ready = auth path OK + at least one account + disk ok
    ready = ext_ok and has_account and disk_ok and session_ok
    reasons: list[str] = []
    if not ext_ok:
        reasons.append("Auth Helper chưa kết nối")
    if ext_ok and not flow_tab_open and flow_image_ready + flow_video_ready > 0:
        reasons.append("Tab Flow chưa mở (cần reCAPTCHA)")
    if not has_account:
        reasons.append("Chưa có account Flow/Grok khả dụng")
    if not disk_ok:
        reasons.append(f"Disk thấp ({disk_free_gb} GB)")
    if not session_ok:
        reasons.append(sh.get("hint") or "Session Flow có thể hết hạn")

    return {
        "status": "ok",
        "server": "G-Labs BW Webhook",
        "uptime": task_queue.uptime,
        "tasks_pending": task_queue.pending_count(),
        "tasks_running": task_queue.running_count(),
        "max_concurrent": task_queue.max_concurrent,
        "extension_connected": ext_ok,
        "flow_tab": ext.get("flow_tab"),
        "grok_tab": ext.get("grok_tab"),
        "flow_accounts": len(flow_accounts),
        "flow_image_ready": flow_image_ready,
        "flow_video_ready": flow_video_ready,
        "grok_ready": grok_ready,
        "disk_free_gb": disk_free_gb,
        "disk_ok": disk_ok,
        "flow_session_ok": session_ok,
        "session": sh,
        "ready_to_generate": ready,
        "readiness_reasons": reasons,
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
        try:
            subprocess.Popen(["explorer.exe", "/separate,", str(path)])
        except Exception:
            try:
                import os
                os.startfile(path)
            except Exception:
                subprocess.Popen(["explorer.exe", str(path)])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])

    return {"ok": True, "path": str(path)}


@router.get("/files/{file_path:path}")
async def get_file(file_path: str):
    from app.services.output_storage import resolve_data_file
    from fastapi.responses import RedirectResponse

    try:
        file_path_resolved = resolve_data_file(file_path)
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "Invalid file path"}) from None

    if not file_path_resolved.is_file():
        # Check if we have a Google Drive mapping for this file
        from app.services.google_drive import get_drive_mapping
        drive_url = get_drive_mapping(file_path)
        if drive_url:
            return RedirectResponse(url=drive_url, status_code=307)

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
    return FileResponse(
        file_path_resolved,
        media_type=media_type,
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


# --- REMOTE CALLABLE WEBHOOK ENDPOINTS ---

from typing import Any
from pydantic import Field

class RemoteWorkflowRunRequest(BaseModel):
    async_mode: bool = True
    project_id: str | None = None
    node_overrides: dict[str, dict[str, Any]] | None = None  # e.g., {"n_prompt": {"prompt": "cinematic cat"}}


@router.get("/webhook/workflows", dependencies=[Depends(verify_api_key)])
async def list_remote_workflows() -> dict:
    from app.services import workflow_store as store
    # Expose metadata only
    return {"workflows": store.list_workflows()}


@router.post("/webhook/workflows/{workflow_id}/run", dependencies=[Depends(verify_api_key)])
async def run_remote_workflow(workflow_id: str, body: RemoteWorkflowRunRequest) -> dict:
    from app.services import workflow_store as store
    from app.services.workflow_runner import run_workflow, start_workflow_background
    
    doc = store.get_workflow(workflow_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": f"Workflow {workflow_id} not found"})
    
    # Clone nodes to avoid mutating the saved workflow file
    import copy
    nodes = copy.deepcopy(doc.get("nodes", []))
    
    # Apply node overrides if provided
    if body.node_overrides:
        for node in nodes:
            nid = str(node.get("id"))
            if nid in body.node_overrides:
                node["data"] = {**node.get("data", {}), **body.node_overrides[nid]}
                
    graph = {
        "id": workflow_id,
        "name": doc.get("name", "Untitled"),
        "nodes": nodes,
        "edges": doc.get("edges", []),
    }
    
    if body.async_mode:
        run = start_workflow_background(graph, project_id=body.project_id)
        return {
            "run_id": run["run_id"],
            "status": run["status"],
            "message": "Workflow started in background",
            "poll_url": f"/api/webhook/workflows/runs/{run['run_id']}"
        }
    else:
        run = await run_workflow(graph, project_id=body.project_id)
        return run


@router.get("/webhook/workflows/runs/{run_id}", dependencies=[Depends(verify_api_key)])
async def get_remote_workflow_run(run_id: str) -> dict:
    from app.services.workflow_runner import get_run
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": f"Run {run_id} not found"})
    return run


class RemoteClipIn(BaseModel):
    path: str | None = None
    url: str | None = None
    trim_start: float | None = None
    trim_end: float | None = None
    title: str | None = None


class RemoteAudioIn(BaseModel):
    path: str | None = None
    url: str | None = None
    start: float = 0
    trim_start: float | None = None
    trim_end: float | None = None
    volume: float = 1.0
    title: str | None = None


class RemoteTextIn(BaseModel):
    text: str = ""
    start: float = 0
    end: float = 3
    style: str = "subtitle"
    color: str = "white"
    font_size: int | None = None
    x_pct: float | None = None
    y_pct: float | None = None


class RemoteAssembleRequest(BaseModel):
    clips: list[RemoteClipIn] = Field(min_length=1, max_length=80)
    audios: list[RemoteAudioIn] = Field(default_factory=list, max_length=20)
    texts: list[RemoteTextIn] = Field(default_factory=list, max_length=40)
    project_id: str | None = None
    output_folder: str | None = None
    filename: str | None = None
    reencode: bool = True


@router.post("/webhook/video/assemble", dependencies=[Depends(verify_api_key)])
async def remote_assemble_video(body: RemoteAssembleRequest) -> dict:
    from app.services import video_assemble
    clips = [c.model_dump(exclude_none=True) for c in body.clips]
    audios = [a.model_dump(exclude_none=True) for a in body.audios]
    texts = [t.model_dump(exclude_none=True) for t in body.texts]
    
    try:
        if audios or texts:
            result = await video_assemble.assemble_timeline(
                clips,
                audios=audios,
                texts=texts,
                project_id=body.project_id,
                output_folder=body.output_folder,
                filename=body.filename,
                reencode=body.reencode,
            )
        else:
            result = await video_assemble.assemble_clips(
                clips,
                project_id=body.project_id,
                output_folder=body.output_folder,
                filename=body.filename,
                reencode=body.reencode,
            )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"error": str(exc)}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc


@router.get("/webhook/accounts", dependencies=[Depends(verify_api_key)])
async def list_remote_accounts() -> dict:
    from app.services.account_store import account_store
    from app.providers.registry import account_to_dict
    accounts = account_store.list_accounts()
    return {"accounts": [account_to_dict(a) for a in accounts]}


@router.post("/webhook/upload", dependencies=[Depends(verify_api_key)])
async def remote_upload_file(file: UploadFile = File(...)) -> dict:
    import secrets
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": "Empty file"})
        
    dest_dir = settings.data_dir / "G-Labs BW" / "webhook_uploads"
    dest_dir.mkdir(parents=True, exist_ok=True)
    
    suffix = Path(file.filename or "upload.bin").suffix
    name = f"{secrets.token_hex(8)}{suffix}"
    dest_path = dest_dir / name
    
    try:
        dest_path.write_bytes(data)
    except OSError as exc:
        raise HTTPException(status_code=500, detail={"error": f"Failed to write file: {exc}"})
        
    from app.services.output_storage import file_url_from_path
    rel = dest_path.resolve().relative_to(settings.data_dir.resolve()).as_posix()
    return {
        "ok": True,
        "filename": file.filename or name,
        "path": rel,
        "url": file_url_from_path(dest_path),
        "bytes": len(data),
    }