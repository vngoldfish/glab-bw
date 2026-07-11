import datetime
import re
import secrets
import uuid
from collections import defaultdict
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


@router.get("/sample/product-isolate")
async def sample_product_isolate() -> dict:
    return {"workflow": store.sample_product_isolate()}


@router.get("/sample/product-placement")
async def sample_product_placement() -> dict:
    return {"workflow": store.sample_product_placement()}


@router.get("/sample/multi-product-isolate")
async def sample_multi_product_isolate() -> dict:
    return {"workflow": store.sample_multi_product_isolate()}


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


# --- API FOR BULK RUNS FROM OUTSIDE ---

class BulkBoxItem(BaseModel):
    type: str  # "generate" or "video_generate"
    prompts: str


class BulkReferenceItem(BaseModel):
    name: str
    image: str  # base64 or URL


class BulkRunRequest(BaseModel):
    project_id: str | None = None
    project_name: str | None = None
    boxes: list[BulkBoxItem]
    references: list[BulkReferenceItem] = Field(default_factory=list)
    model_image: str = "nano_banana_2_lite"
    model_video: str = "veo_31_fast"
    aspect_ratio: str = "16:9"


def build_bulk_graph(
    boxes: list[BulkBoxItem],
    references: list[BulkReferenceItem],
    model_image: str,
    model_video: str,
    aspect_ratio: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    nodes = []
    edges = []

    # 1. Parse prompts
    parsed_prompts = []
    for box_idx, box in enumerate(boxes):
        lines = [l.strip() for l in box.prompts.split("\n") if l.strip()]
        for line_idx, line in enumerate(lines):
            m = re.match(r"^(\d+(?:\.\d+)?)\s*(.*)", line)
            if m:
                prefix = m.group(1)
                text = m.group(2).strip() or "No prompt"
            else:
                prefix = f"__auto_{box_idx}_{line_idx}"
                text = line
            parsed_prompts.append({
                "prefix": prefix,
                "text": text,
                "box_index": box_idx,
                "line_index": line_idx,
                "type": box.type
            })

    # Group by prefix
    prefix_groups = defaultdict(list)
    for p in parsed_prompts:
        prefix_groups[p["prefix"]].append(p)

    # Coordinates layout
    origin_x, origin_y = 100, 100
    lane_gap = 520
    box_gap = 320
    prompt_offset_x = -310

    node_id_map = {}
    box_line_row_map = {}
    global_row = 0

    for box_idx, box in enumerate(boxes):
        lines = [l.strip() for l in box.prompts.split("\n") if l.strip()]
        for line_idx, _ in enumerate(lines):
            box_line_row_map[f"{box_idx}_{line_idx}"] = global_row
            global_row += 1

    # Create prompt and generator nodes
    for entry in parsed_prompts:
        box_idx = entry["box_index"]
        line_idx = entry["line_index"]
        text = entry["text"]
        prefix = entry["prefix"]
        ntype = entry["type"]

        key = f"{box_idx}_{line_idx}"
        row = box_line_row_map.get(key, 0)

        gen_id = f"{ntype}_{uuid.uuid4().hex[:8]}"
        node_id_map[key] = gen_id

        x = origin_x + box_idx * lane_gap
        y = origin_y + row * box_gap

        title_gen = f"Tạo video {prefix}" if ntype == "video_generate" else f"Tạo ảnh {prefix}"

        gen_node = {
            "id": gen_id,
            "type": ntype,
            "position": {"x": x, "y": y},
            "data": {
                "title": title_gen,
                "runStatus": "idle",
                "aspect_ratio": aspect_ratio,
            }
        }
        if ntype == "generate":
            gen_node["data"]["model"] = model_image
            gen_node["data"]["prompt"] = text
        else:
            gen_node["data"]["model"] = model_video
            gen_node["data"]["mode"] = "text_to_video"
            gen_node["data"]["prompt_hint"] = text

        nodes.append(gen_node)

    # Cross-box connections
    for prefix, entries in prefix_groups.items():
        if len(entries) < 2:
            continue
        sorted_entries = sorted(entries, key=lambda e: e["box_index"])
        for i in range(len(sorted_entries) - 1):
            src = sorted_entries[i]
            dst = sorted_entries[i+1]
            src_id = node_id_map.get(f"{src['box_index']}_{src['line_index']}")
            dst_id = node_id_map.get(f"{dst['box_index']}_{dst['line_index']}")
            if not src_id or not dst_id:
                continue

            src_type = src["type"]
            dst_type = dst["type"]

            if src_type == "generate" and dst_type == "video_generate":
                edges.append({
                    "id": f"edge_img_vid_{src_id}_{dst_id}",
                    "source": src_id,
                    "sourceHandle": "image",
                    "target": dst_id,
                    "targetHandle": "start_image",
                    "animated": True,
                    "style": {"stroke": "#22c55e", "strokeWidth": 2}
                })
                # Update dst node data
                for n in nodes:
                    if n["id"] == dst_id:
                        n["data"]["hasStartImageInput"] = True
                        n["data"]["mode"] = "start_image"

            elif src_type == "video_generate" and dst_type == "video_generate":
                fe_id = f"frame_extract_{uuid.uuid4().hex[:8]}"
                src_row = box_line_row_map.get(f"{src['box_index']}_{src['line_index']}", 0)
                fe_x = origin_x + src["box_index"] * lane_gap + int(lane_gap / 2)
                fe_y = origin_y + src_row * box_gap + 40

                fe_node = {
                    "id": fe_id,
                    "type": "frame_extract",
                    "position": {"x": fe_x, "y": fe_y},
                    "data": {
                        "title": f"Tách frame {prefix}",
                        "positions": "end",
                        "runStatus": "idle"
                    }
                }
                nodes.append(fe_node)

                edges.append({
                    "id": f"edge_fe_in_{fe_id}",
                    "source": src_id,
                    "sourceHandle": "video",
                    "target": fe_id,
                    "targetHandle": "video",
                    "animated": True,
                    "style": {"stroke": "#f59e0b", "strokeWidth": 2}
                })
                edges.append({
                    "id": f"edge_fe_out_{fe_id}",
                    "source": fe_id,
                    "sourceHandle": "end_image",
                    "target": dst_id,
                    "targetHandle": "start_image",
                    "animated": True,
                    "style": {"stroke": "#ec4899", "strokeWidth": 2}
                })
                # Update dst node data
                for n in nodes:
                    if n["id"] == dst_id:
                        n["data"]["hasStartImageInput"] = True
                        n["data"]["hasEndImageInput"] = True
                        n["data"]["mode"] = "start_end_image"

    # Auto-inject reference nodes
    MENTION_PATTERN = re.compile(r"@([a-zA-Z][a-zA-Z0-9_]*)")
    mention_to_gen_ids = defaultdict(list)

    for g_node in nodes:
        if g_node.get("type") not in {"generate", "video_generate"}:
            continue
        prompt_text = ""
        if g_node["type"] == "generate":
            prompt_text = g_node["data"].get("prompt") or ""
        else:
            prompt_text = g_node["data"].get("prompt_hint") or ""

        seen = set()
        for match in MENTION_PATTERN.finditer(prompt_text):
            key = match.group(1).lower()
            if key in seen:
                continue
            seen.add(key)
            mention_to_gen_ids[key].append({
                "genId": g_node["id"],
                "genType": g_node.get("type", "")
            })

    if mention_to_gen_ids:
        # Load local reference library
        try:
            from app.services import reference_storage
            local_refs = reference_storage.list_references().get("references", [])
            local_ref_map = {r["name"].lower(): r for r in local_refs if "name" in r}
        except Exception:
            local_ref_map = {}

        # Merge with API references and save base64 to persistent library
        from app.services.reference_image_loader import _decode_data_url
        for ref in references:
            ref_name_lower = ref.name.lower()
            existing_refs = reference_storage._load_manifest()
            existing_item = next((item for item in existing_refs if item.get("name", "").lower() == ref_name_lower), None)
            
            if existing_item:
                # Character already exists! Use the existing local image from library
                ref_record = reference_storage._public_item(existing_item)
                local_ref_map[ref_name_lower] = {
                    "name": existing_item["name"],
                    "image": ref_record["image_url"],
                    "file_path": ref_record["file_path"]
                }
            else:
                # Character does not exist! Save the base64 image to library
                if ref.image.startswith("data:") or "base64," in ref.image:
                    try:
                        parsed = _decode_data_url(ref.image)
                        if parsed:
                            raw_bytes, mime_type = parsed
                            ref_record = reference_storage.add_reference(
                                raw_bytes,
                                mime_type,
                                name=ref.name,
                                label=ref.name,
                                category="character"
                            )
                            local_ref_map[ref_name_lower] = {
                                "name": ref_record["name"],
                                "image": ref_record["image_url"],
                                "file_path": ref_record["file_path"]
                            }
                    except Exception:
                        local_ref_map[ref_name_lower] = {
                            "name": ref.name,
                            "image": ref.image
                        }
                else:
                    local_ref_map[ref_name_lower] = {
                        "name": ref.name,
                        "image": ref.image
                    }

        ref_node_counter = 0
        for mention, targets in mention_to_gen_ids.items():
            ref_item = local_ref_map.get(mention)
            ref_id = f"reference_{uuid.uuid4().hex[:8]}"

            ref_x = origin_x + prompt_offset_x - 340
            ref_y = origin_y + ref_node_counter * 240
            ref_node_counter += 1

            image_url = None
            if ref_item:
                image_url = ref_item.get("image") or ref_item.get("image_url") or ref_item.get("file_path")
            ref_node = {
                "id": ref_id,
                "type": "reference",
                "position": {"x": ref_x, "y": ref_y},
                "data": {
                    "title": f"@{ref_item['name']}" if ref_item else f"@{mention}",
                    "image": image_url,
                    "resultUrls": [image_url] if image_url else None,
                    "refName": ref_item["name"] if ref_item else mention,
                    "runStatus": "idle"
                }
            }
            nodes.append(ref_node)

            # Connect reference node to generator nodes
            for target in targets:
                target_handle = "reference" if target["genType"] == "video_generate" else "image"
                edges.append({
                    "id": f"edge_ref_{ref_id}_{target['genId']}",
                    "source": ref_id,
                    "sourceHandle": "image",
                    "target": target["genId"],
                    "targetHandle": target_handle,
                    "animated": True,
                    "style": {"stroke": "#14b8a6", "strokeWidth": 2}
                })

    return nodes, edges


@router.post("/run-bulk", status_code=201)
async def run_bulk_workflow(body: BulkRunRequest) -> dict:
    """
    Create a project graph from bulk boxes JSON, saves it to projects index,
    and triggers parallel workflow execution immediately.
    """
    from app.services.project_store import get_project, save_project

    pid = body.project_id
    if pid:
        existing = get_project(pid)
        if not existing:
            raise HTTPException(status_code=404, detail={"error": f"Project ID {pid} not found"})
        name = body.project_name or existing.get("name") or "Project mới"
    else:
        pid = secrets.token_hex(6)
        name = body.project_name or f"Bulk Project {datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

    # Build React Flow nodes and edges structure
    nodes, edges = build_bulk_graph(
        boxes=body.boxes,
        references=body.references,
        model_image=body.model_image,
        model_video=body.model_video,
        aspect_ratio=body.aspect_ratio,
    )

    # Save to disk as a Project so users can see/resume it on the UI
    project_payload = {
        "name": name,
        "nodes": nodes,
        "edges": edges,
    }
    save_project(project_payload, project_id=pid)

    # Run workflow in background
    run_payload = {
        "id": None,
        "name": name,
        "nodes": nodes,
        "edges": edges,
    }
    run_info = start_workflow_background(run_payload, project_id=pid)

    return {
        "run_id": run_info.get("run_id"),
        "project_id": pid,
        "project_name": name,
        "status": "running"
    }


@router.post("/create-bulk", status_code=201)
async def create_bulk_workflow(body: BulkRunRequest) -> dict:
    """
    Create a project graph from bulk boxes JSON, saves it to projects index,
    and returns project info WITHOUT executing the workflow.
    """
    from app.services.project_store import get_project, save_project

    pid = body.project_id
    if pid:
        existing = get_project(pid)
        if not existing:
            raise HTTPException(status_code=404, detail={"error": f"Project ID {pid} not found"})
        name = body.project_name or existing.get("name") or "Project mới"
    else:
        pid = secrets.token_hex(6)
        name = body.project_name or f"Bulk Project {datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"

    # Build React Flow nodes and edges structure
    nodes, edges = build_bulk_graph(
        boxes=body.boxes,
        references=body.references,
        model_image=body.model_image,
        model_video=body.model_video,
        aspect_ratio=body.aspect_ratio,
    )

    # Save to disk as a Project so users can see/resume it on the UI
    project_payload = {
        "name": name,
        "nodes": nodes,
        "edges": edges,
    }
    save_project(project_payload, project_id=pid)

    return {
        "project_id": pid,
        "project_name": name,
        "nodes_count": len(nodes),
        "edges_count": len(edges),
        "status": "created"
    }
