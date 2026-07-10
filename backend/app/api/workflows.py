from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import workflow_store as store
from app.services.workflow_runner import get_run, run_workflow

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowSave(BaseModel):
    name: str = "Untitled"
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    viewport: dict[str, Any] | None = None


@router.get("")
async def list_workflows() -> dict:
    return {"workflows": store.list_workflows()}


@router.get("/sample/default")
async def sample_workflow() -> dict:
    return {"workflow": store.default_sample()}


@router.get("/sample/video-chain")
async def sample_video_chain() -> dict:
    """Ảnh → Video → frame cuối → Video tiếp."""
    return {"workflow": store.sample_video_chain()}


@router.get("/runs/{run_id}")
async def get_workflow_run(run_id: str) -> dict:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": "Run not found"})
    return run


@router.post("/run")
async def run_inline_workflow(body: WorkflowSave) -> dict:
    """Run graph without requiring a saved id."""
    doc = {
        "id": None,
        "name": body.name,
        "nodes": body.nodes,
        "edges": body.edges,
    }
    return await run_workflow(doc)


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str) -> dict:
    doc = store.get_workflow(workflow_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return {"workflow": doc}


@router.post("", status_code=201)
async def create_workflow(body: WorkflowSave) -> dict:
    doc = store.save_workflow(body.model_dump())
    return {"workflow": doc}


@router.put("/{workflow_id}")
async def update_workflow(workflow_id: str, body: WorkflowSave) -> dict:
    doc = store.save_workflow(body.model_dump(), workflow_id=workflow_id)
    return {"workflow": doc}


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    store.delete_workflow(workflow_id)
    return {"ok": True}


@router.post("/{workflow_id}/run")
async def run_saved_workflow(workflow_id: str) -> dict:
    doc = store.get_workflow(workflow_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return await run_workflow(doc)
