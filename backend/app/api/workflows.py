import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import workflow_store as store
from app.services.workflow_runner import get_run, run_workflow, start_workflow_background

router = APIRouter(prefix="/workflows", tags=["workflows"])


class WorkflowSave(BaseModel):
    name: str = "Untitled"
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    viewport: dict[str, Any] | None = None


class WorkflowRunRequest(BaseModel):
    name: str = "Untitled"
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    # Progressive / resume
    async_mode: bool = True
    skip_completed: bool = False
    only_node_ids: list[str] | None = None
    prior_results: dict[str, Any] | None = None
    project_id: str | None = None


@router.get("")
async def list_workflows() -> dict:
    return {"workflows": store.list_workflows()}


@router.get("/sample/default")
async def sample_workflow() -> dict:
    return {"workflow": store.default_sample()}


@router.get("/sample/video-chain")
async def sample_video_chain() -> dict:
    return {"workflow": store.sample_video_chain()}


@router.get("/runs/{run_id}")
async def get_workflow_run(run_id: str) -> dict:
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail={"error": "Run not found"})
    return run


@router.post("/run")
async def run_inline_workflow(body: WorkflowRunRequest) -> dict:
    """
    Run graph.
    async_mode=true (default): return run_id immediately; poll GET /runs/{id}.
    skip_completed: reuse prior_results for completed nodes (Tiếp tục).
    only_node_ids: re-run only these nodes (Tạo lại).
    """
    doc = {
        "id": None,
        "name": body.name,
        "nodes": body.nodes,
        "edges": body.edges,
    }
    if body.async_mode:
        return start_workflow_background(
            doc,
            prior_results=body.prior_results,
            skip_completed=body.skip_completed,
            only_node_ids=body.only_node_ids,
            project_id=body.project_id,
        )
    return await run_workflow(
        doc,
        prior_results=body.prior_results,
        skip_completed=body.skip_completed,
        only_node_ids=body.only_node_ids,
        project_id=body.project_id,
    )


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
async def run_saved_workflow(workflow_id: str, body: WorkflowRunRequest | None = None) -> dict:
    doc = store.get_workflow(workflow_id)
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    req = body or WorkflowRunRequest()
    # prefer saved graph nodes if client didn't send
    graph = {
        "id": workflow_id,
        "name": doc.get("name") or req.name,
        "nodes": req.nodes or doc.get("nodes") or [],
        "edges": req.edges or doc.get("edges") or [],
    }
    if req.async_mode:
        return start_workflow_background(
            graph,
            prior_results=req.prior_results,
            skip_completed=req.skip_completed,
            only_node_ids=req.only_node_ids,
            project_id=req.project_id,
        )
    return await run_workflow(
        graph,
        prior_results=req.prior_results,
        skip_completed=req.skip_completed,
        only_node_ids=req.only_node_ids,
        project_id=req.project_id,
    )
