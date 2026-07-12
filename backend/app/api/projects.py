import subprocess
import sys
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import project_store as store
from app.services.project_outputs import (
    asset_stats,
    clear_outputs,
    delete_asset,
    list_assets,
    open_project_folder,
    project_root,
    is_media,
    kind_of,
)
from app.services.output_storage import file_url_from_path

router = APIRouter(prefix="/projects", tags=["projects"])


class ProjectSave(BaseModel):
    name: str = "Project mới"
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    viewport: dict[str, Any] | None = None
    node_states: dict[str, Any] = Field(default_factory=dict)


class ProjectMetaUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    tags: list[str] | None = None


class DeleteAssetBody(BaseModel):
    path: str


@router.get("")
async def list_projects() -> dict:
    return {"projects": store.list_projects(with_assets=True)}


@router.get("/{project_id}")
async def get_project(project_id: str) -> dict:
    doc = store.get_project(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    stats = asset_stats(project_id)
    doc = {**doc, "asset_stats": stats, "output_folder": f"G-Labs BW/projects/{project_id}"}
    return {"project": doc}


@router.post("", status_code=201)
async def create_project(body: ProjectSave) -> dict:
    doc = store.save_project(body.model_dump())
    project_root(doc["id"])
    return {"project": doc}


@router.put("/{project_id}")
async def update_project(project_id: str, body: ProjectSave) -> dict:
    doc = store.save_project(body.model_dump(), project_id=project_id)
    return {"project": doc}


@router.patch("/{project_id}")
async def patch_project_meta(project_id: str, body: ProjectMetaUpdate) -> dict:
    existing = store.get_project(project_id)
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    payload = {
        "name": body.name if body.name is not None else existing.get("name"),
        "description": body.description
        if body.description is not None
        else existing.get("description"),
        "tags": body.tags if body.tags is not None else existing.get("tags"),
        "nodes": existing.get("nodes") or [],
        "edges": existing.get("edges") or [],
        "viewport": existing.get("viewport"),
        "node_states": existing.get("node_states") or {},
    }
    doc = store.save_project(payload, project_id=project_id)
    return {"project": doc}


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    delete_files: bool = Query(default=False, description="Also delete project media folder"),
) -> dict:
    store.delete_project(project_id)
    removed_media = False
    if delete_files:
        import shutil

        root = open_project_folder(project_id)
        if root.is_dir():
            shutil.rmtree(root, ignore_errors=True)
            removed_media = True
    return {"ok": True, "media_deleted": removed_media}


@router.post("/{project_id}/duplicate", status_code=201)
async def duplicate_project(project_id: str) -> dict:
    doc = store.duplicate_project(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    project_root(doc["id"])
    return {"project": doc}


@router.get("/assets/all")
async def all_project_assets(
    kind: str | None = Query(default="image", description="image|video|all"),
    limit: int = Query(default=200, ge=1, le=1000),
) -> dict:
    """Lấy ảnh từ toàn bộ projects (dùng cho picker trong workflow)."""
    from app.core.config import settings
    from pathlib import Path
    import re
    projects = store.list_projects(with_assets=False)
    combined: list[dict] = []
    seen_paths: set[str] = set()
    
    # 1. Project directories
    for proj in projects:
        pid = proj.get("id")
        if not pid:
            continue
        try:
            assets = list_assets(pid, kind=kind, limit=limit, include_global=False)
            for a in assets:
                pth = str(a.get("path") or "")
                if pth and pth in seen_paths:
                    continue
                if pth:
                    seen_paths.add(pth)
                combined.append({**a, "project_id": pid, "project_name": proj.get("name", pid)})
        except Exception:
            continue

    # 2. Global directories
    global_roots = [
        settings.data_dir / "workflow" / "anh",
        settings.data_dir / "workflow" / "video"
    ]
    data_root = settings.data_dir.resolve()
    for root in global_roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file() or not is_media(p):
                continue
            k = kind_of(p)
            if kind in {"image", "images"} and k != "image":
                continue
            if kind in {"video", "videos"} and k != "video":
                continue
            try:
                rel = p.resolve().relative_to(data_root).as_posix()
                if rel in seen_paths:
                    continue
                seen_paths.add(rel)
                st = p.stat()
                combined.append({
                    "path": rel,
                    "name": p.name,
                    "kind": k,
                    "url": file_url_from_path(p),
                    "bytes": st.st_size,
                    "mb": round(st.st_size / (1024 * 1024), 3),
                    "mtime": st.st_mtime,
                    "folder": p.parent.relative_to(data_root).as_posix(),
                    "project_id": "global",
                    "project_name": "Thư viện chung",
                })
            except Exception:
                continue

    combined.sort(key=lambda x: float(x.get("mtime") or 0), reverse=True)
    return {
        "assets": combined[:limit],
        "total": len(combined),
    }


@router.get("/{project_id}/assets")
async def project_assets(
    project_id: str,
    kind: str | None = Query(default=None, description="image|video|all"),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    if not store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    assets = list_assets(project_id, kind=kind, limit=limit)
    return {
        "project_id": project_id,
        "assets": assets,
        "stats": asset_stats(project_id),
        "output_folder": f"G-Labs BW/projects/{project_id}",
    }


@router.delete("/{project_id}/assets")
async def project_delete_asset(project_id: str, body: DeleteAssetBody) -> dict:
    if not store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    ok = delete_asset(project_id, body.path)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "Asset not found in project"})
    return {"ok": True, "stats": asset_stats(project_id)}


@router.post("/{project_id}/assets/clear")
async def project_clear_assets(
    project_id: str,
    kind: str = Query(default="all", description="image|video|all"),
) -> dict:
    if not store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    result = clear_outputs(project_id, kind=kind)
    return {"ok": True, **result, "stats": asset_stats(project_id)}


@router.post("/{project_id}/open-folder")
async def project_open_folder(project_id: str) -> dict:
    if not store.get_project(project_id):
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    path = open_project_folder(project_id)
    try:
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return {"ok": True, "path": str(path)}


@router.post("/open-folder-by-path")
async def open_folder_by_path(folder_path: str = Query(...)) -> dict:
    from app.services.output_storage import resolve_data_folder
    try:
        path = resolve_data_folder(folder_path)
        path.mkdir(parents=True, exist_ok=True)
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"error": str(exc)}) from exc
    return {"ok": True, "path": str(path)}
