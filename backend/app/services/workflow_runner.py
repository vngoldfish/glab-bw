"""Execute workflow graphs in topological order (G-Labs workflow runner lite)."""

from __future__ import annotations

import base64
import logging
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from app.core.config import settings
from app.services.frame_extract import extract_frames
from app.services.generation import handle_batch_item
from app.services.output_storage import file_url_from_path, resolve_data_file

logger = logging.getLogger(__name__)

_runs: dict[str, dict[str, Any]] = {}

# Socket / handle names
# prompt out: prompt
# reference out: image
# generate in: prompt, image ; out: image
# video_generate in: prompt, start_image, end_image ; out: video
# frame_extract in: video ; out: image (start), image_end optional via position


def get_run(run_id: str) -> dict[str, Any] | None:
    return _runs.get(run_id)


def _topo_order(nodes: list[dict], edges: list[dict]) -> list[str]:
    ids = {str(n["id"]) for n in nodes}
    indeg: dict[str, int] = {i: 0 for i in ids}
    adj: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        s, t = str(e.get("source")), str(e.get("target"))
        if s not in ids or t not in ids:
            continue
        adj[s].append(t)
        indeg[t] = indeg.get(t, 0) + 1
        if s not in indeg:
            indeg[s] = indeg.get(s, 0)
    q = deque([i for i, d in indeg.items() if d == 0])
    order: list[str] = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in adj[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(order) != len(ids):
        # cycle or orphan — append remaining
        for i in ids:
            if i not in order:
                order.append(i)
    return order


def _node_map(nodes: list[dict]) -> dict[str, dict]:
    return {str(n["id"]): n for n in nodes}


def _incoming(edges: list[dict], target_id: str) -> list[dict]:
    return [e for e in edges if str(e.get("target")) == target_id]


async def _url_to_data_url(url: str) -> str:
    if url.startswith("data:"):
        return url
    raw = url
    if "/api/files/" in raw:
        raw = unquote(raw.split("/api/files/", 1)[1].split("?", 1)[0])
        path = resolve_data_file(raw)
        data = path.read_bytes()
        mime = "image/png"
        suf = path.suffix.lower()
        if suf in {".jpg", ".jpeg"}:
            mime = "image/jpeg"
        elif suf == ".webp":
            mime = "image/webp"
        return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
    raise ValueError(f"Cannot load media: {url[:100]}")


async def run_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    run_id = secrets.token_hex(5)
    nodes = list(workflow.get("nodes") or [])
    edges = list(workflow.get("edges") or [])
    run: dict[str, Any] = {
        "run_id": run_id,
        "workflow_id": workflow.get("id"),
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "node_results": {},
        "logs": [],
        "error": None,
    }
    _runs[run_id] = run

    def log(msg: str) -> None:
        run["logs"].append({"t": time.time(), "msg": msg})
        logger.info("[wf %s] %s", run_id, msg)

    try:
        order = _topo_order(nodes, edges)
        nmap = _node_map(nodes)
        # outputs[node_id][handle] = list of values (urls or text)
        outputs: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))

        for nid in order:
            node = nmap.get(nid)
            if not node:
                continue
            ntype = str(node.get("type") or "")
            data = dict(node.get("data") or {})
            if data.get("disabled") or data.get("skipped"):
                log(f"Skip {nid} ({ntype})")
                run["node_results"][nid] = {"status": "skipped"}
                continue

            # gather inputs from edges
            inputs: dict[str, list[Any]] = defaultdict(list)
            for e in _incoming(edges, nid):
                src = str(e.get("source"))
                sh = str(e.get("sourceHandle") or "out")
                th = str(e.get("targetHandle") or "in")
                vals = outputs.get(src, {}).get(sh) or outputs.get(src, {}).get("out") or []
                inputs[th].extend(vals)

            log(f"Run {nid} type={ntype}")
            run["node_results"][nid] = {"status": "running", "type": ntype}

            try:
                if ntype == "prompt":
                    text = (data.get("prompt") or data.get("text") or "").strip()
                    if not text and inputs.get("prompt"):
                        text = str(inputs["prompt"][0])
                    if not text:
                        raise ValueError("Prompt node empty")
                    outputs[nid]["prompt"] = [text]
                    run["node_results"][nid] = {
                        "status": "completed",
                        "type": ntype,
                        "prompt": text,
                    }

                elif ntype == "reference":
                    # data.image can be data URL or /api/files path
                    img = data.get("image") or data.get("file_url") or data.get("file_path")
                    if not img and inputs.get("image"):
                        img = inputs["image"][0]
                    if not img:
                        raise ValueError("Reference node missing image")
                    if not str(img).startswith("data:") and not str(img).startswith("http"):
                        # relative path under data/
                        try:
                            p = resolve_data_file(str(img))
                            img = file_url_from_path(p)
                        except Exception:
                            pass
                    outputs[nid]["image"] = [img]
                    run["node_results"][nid] = {
                        "status": "completed",
                        "type": ntype,
                        "image": img if isinstance(img, str) and len(img) < 200 else "(image)",
                    }

                elif ntype == "generate":
                    prompt = ""
                    if inputs.get("prompt"):
                        prompt = str(inputs["prompt"][0])
                    prompt = prompt or str(data.get("prompt") or "").strip()
                    if not prompt:
                        raise ValueError("Generate needs prompt")
                    refs = list(inputs.get("image") or [])
                    ref_data: list[str] = []
                    for r in refs[:3]:
                        if str(r).startswith("data:"):
                            ref_data.append(str(r))
                        else:
                            try:
                                ref_data.append(await _url_to_data_url(str(r)))
                            except Exception:
                                pass
                    params = {
                        "model": data.get("model") or "nano_banana_2_lite",
                        "aspect_ratio": data.get("aspect_ratio") or "1:1",
                        "count": int(data.get("count") or 1),
                        "save_mode": "task",
                        "output_folder": data.get("output_folder") or "G-Labs BW/image_output",
                    }
                    if ref_data:
                        params["reference_images"] = ref_data
                    out = await handle_batch_item(prompt, "image", params)
                    urls = out["urls"]
                    outputs[nid]["image"] = urls
                    run["node_results"][nid] = {
                        "status": "completed",
                        "type": ntype,
                        "results": urls,
                        "folder": out.get("folder"),
                    }

                elif ntype == "video_generate":
                    prompt = ""
                    if inputs.get("prompt"):
                        prompt = str(inputs["prompt"][0])
                    prompt = prompt or str(data.get("prompt") or "").strip()
                    if not prompt:
                        raise ValueError("Video needs prompt")
                    start_refs = list(inputs.get("start_image") or inputs.get("image") or [])
                    end_refs = list(inputs.get("end_image") or [])
                    mode = data.get("mode") or ("start_image" if start_refs else "text_to_video")
                    params: dict[str, Any] = {
                        "model": data.get("model") or "veo_31_fast",
                        "aspect_ratio": data.get("aspect_ratio") or "16:9",
                        "mode": mode,
                        "save_mode": "task",
                        "output_folder": data.get("output_folder") or "G-Labs BW/video_output",
                        "resolution": data.get("resolution") or ["720p"],
                    }
                    ref_list: list[str] = []
                    for r in start_refs[:1]:
                        if str(r).startswith("data:"):
                            ref_list.append(str(r))
                        else:
                            ref_list.append(await _url_to_data_url(str(r)))
                    for r in end_refs[:1]:
                        if str(r).startswith("data:"):
                            ref_list.append(str(r))
                        else:
                            ref_list.append(await _url_to_data_url(str(r)))
                    if ref_list:
                        params["reference_images"] = ref_list
                        if len(ref_list) >= 2:
                            params["mode"] = "start_end_image"
                        elif mode == "text_to_video":
                            params["mode"] = "start_image"
                    out = await handle_batch_item(prompt, "video", params)
                    urls = out["urls"]
                    outputs[nid]["video"] = urls
                    run["node_results"][nid] = {
                        "status": "completed",
                        "type": ntype,
                        "results": urls,
                        "folder": out.get("folder"),
                    }

                elif ntype == "frame_extract":
                    videos = list(inputs.get("video") or [])
                    if not videos:
                        raise ValueError("Frame extract needs video input")
                    vurl = str(videos[0])
                    if "/api/files/" in vurl:
                        rel = unquote(vurl.split("/api/files/", 1)[1].split("?", 1)[0])
                        vpath = resolve_data_file(rel)
                    else:
                        vpath = resolve_data_file(vurl)
                    positions = data.get("positions") or ["start", "end", "middle"]
                    if isinstance(positions, str):
                        positions = [p.strip() for p in positions.split(",") if p.strip()]
                    frames = extract_frames(vpath, positions=list(positions))
                    urls = [f["url"] for f in frames]
                    outputs[nid]["image"] = urls
                    # also map start/end for convenience
                    for f in frames:
                        if f["position"] in {"start", "first", "0"}:
                            outputs[nid]["start_image"] = [f["url"]]
                        if f["position"] in {"end", "last"}:
                            outputs[nid]["end_image"] = [f["url"]]
                    run["node_results"][nid] = {
                        "status": "completed",
                        "type": ntype,
                        "frames": frames,
                        "results": urls,
                    }

                else:
                    raise ValueError(f"Unknown node type: {ntype}")

            except Exception as exc:
                log(f"Node {nid} FAILED: {exc}")
                run["node_results"][nid] = {
                    "status": "failed",
                    "type": ntype,
                    "error": str(exc),
                }
                run["status"] = "failed"
                run["error"] = f"Node {nid} ({ntype}): {exc}"
                run["finished_at"] = time.time()
                return run

        run["status"] = "completed"
        run["finished_at"] = time.time()
        log("Workflow completed")
    except Exception as exc:
        logger.exception("Workflow run failed")
        run["status"] = "failed"
        run["error"] = str(exc)
        run["finished_at"] = time.time()

    return run
