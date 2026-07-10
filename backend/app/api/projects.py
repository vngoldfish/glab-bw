from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import project_store as store

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


@router.get("")
async def list_projects() -> dict:
    return {"projects": store.list_projects()}


@router.get("/{project_id}")
async def get_project(project_id: str) -> dict:
    doc = store.get_project(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    return {"project": doc}


@router.post("", status_code=201)
async def create_project(body: ProjectSave) -> dict:
    doc = store.save_project(body.model_dump())
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
async def delete_project(project_id: str) -> dict:
    store.delete_project(project_id)
    return {"ok": True}


@router.post("/{project_id}/duplicate", status_code=201)
async def duplicate_project(project_id: str) -> dict:
    doc = store.duplicate_project(project_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Project not found"})
    return {"project": doc}
