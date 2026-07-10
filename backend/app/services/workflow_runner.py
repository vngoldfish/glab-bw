"""Execute workflow graphs in topological order with progressive node updates."""

from __future__ import annotations

import asyncio
import base64
import logging
import secrets
import time
from collections import defaultdict, deque
from typing import Any
from urllib.parse import unquote

from app.services.frame_extract import extract_frames
from app.services.generation import handle_batch_item
from app.services.output_storage import file_url_from_path, resolve_data_file

logger = logging.getLogger(__name__)

_runs: dict[str, dict[str, Any]] = {}


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


def _restore_outputs_from_result(
    nid: str,
    ntype: str,
    prior: dict[str, Any],
    node_data: dict[str, Any],
    outputs: dict[str, dict[str, list[Any]]],
) -> None:
    """Rebuild edge outputs for a completed node so downstream can use it."""
    if ntype == "prompt":
        text = prior.get("prompt") or node_data.get("prompt") or node_data.get("text") or ""
        if text:
            outputs[nid]["prompt"] = [str(text)]
        return
    if ntype == "reference":
        img = prior.get("image")
        if img == "(image)" or not img:
            img = (prior.get("results") or [None])[0] or node_data.get("image")
        if img:
            outputs[nid]["image"] = [img]
        return
    results = list(prior.get("results") or [])
    if ntype == "generate":
        if results:
            outputs[nid]["image"] = results
        return
    if ntype == "video_generate":
        if results:
            outputs[nid]["video"] = results
        return
    if ntype == "frame_extract":
        frames = prior.get("frames") or []
        urls = results or [f.get("url") for f in frames if f.get("url")]
        if urls:
            outputs[nid]["image"] = urls
        for f in frames:
            pos = str(f.get("position") or "")
            url = f.get("url")
            if not url:
                continue
            if pos in {"start", "first", "0"}:
                outputs[nid]["start_image"] = [url]
            if pos in {"end", "last"}:
                outputs[nid]["end_image"] = [url]
        # fallback: single result as end
        if "end_image" not in outputs[nid] and urls:
            outputs[nid]["end_image"] = [urls[-1]]
            outputs[nid]["start_image"] = outputs[nid].get("start_image") or [urls[0]]


async def _execute_node(
    nid: str,
    ntype: str,
    data: dict[str, Any],
    inputs: dict[str, list[Any]],
    outputs: dict[str, dict[str, list[Any]]],
) -> dict[str, Any]:
    """Run one node; mutates outputs; returns node_results entry."""
    if ntype == "prompt":
        text = (data.get("prompt") or data.get("text") or "").strip()
        if not text and inputs.get("prompt"):
            text = str(inputs["prompt"][0])
        if not text:
            raise ValueError("Prompt node empty")
        outputs[nid]["prompt"] = [text]
        return {"status": "completed", "type": ntype, "prompt": text}

    if ntype == "reference":
        img = data.get("image") or data.get("file_url") or data.get("file_path")
        if not img and inputs.get("image"):
            img = inputs["image"][0]
        if not img:
            raise ValueError("Reference node missing image")
        if not str(img).startswith("data:") and not str(img).startswith("http"):
            try:
                p = resolve_data_file(str(img))
                img = file_url_from_path(p)
            except Exception:
                pass
        outputs[nid]["image"] = [img]
        return {
            "status": "completed",
            "type": ntype,
            "image": img if isinstance(img, str) and len(img) < 200 else "(image)",
            "results": [img] if isinstance(img, str) and img.startswith(("http", "data:", "/")) else [],
        }

    if ntype == "generate":
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
        return {
            "status": "completed",
            "type": ntype,
            "results": urls,
            "folder": out.get("folder"),
        }

    if ntype == "video_generate":
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
        return {
            "status": "completed",
            "type": ntype,
            "results": urls,
            "folder": out.get("folder"),
        }

    if ntype == "frame_extract":
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
        for f in frames:
            if f["position"] in {"start", "first", "0"}:
                outputs[nid]["start_image"] = [f["url"]]
            if f["position"] in {"end", "last"}:
                outputs[nid]["end_image"] = [f["url"]]
        return {
            "status": "completed",
            "type": ntype,
            "frames": frames,
            "results": urls,
        }

    raise ValueError(f"Unknown node type: {ntype}")


async def run_workflow(
    workflow: dict[str, Any],
    *,
    run_id: str | None = None,
    prior_results: dict[str, Any] | None = None,
    skip_completed: bool = False,
    only_node_ids: list[str] | None = None,
) -> dict[str, Any]:
    """
    Execute graph. Updates run["node_results"] after each node (poll-friendly).

    skip_completed + prior_results: reuse completed nodes' outputs.
    only_node_ids: only re-run these nodes (others treated as skip_completed if prior exists).
    """
    rid = run_id or secrets.token_hex(5)
    nodes = list(workflow.get("nodes") or [])
    edges = list(workflow.get("edges") or [])
    prior = dict(prior_results or {})
    only_set = set(only_node_ids) if only_node_ids else None

    run: dict[str, Any] = _runs.get(rid) or {
        "run_id": rid,
        "workflow_id": workflow.get("id"),
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "node_results": {},
        "logs": [],
        "error": None,
        "progress": {"done": 0, "total": 0, "current": None},
    }
    run["status"] = "running"
    run["error"] = None
    run["finished_at"] = None
    # seed with prior for progressive UI
    if prior:
        run["node_results"] = {**prior, **run.get("node_results", {})}
    _runs[rid] = run

    def log(msg: str) -> None:
        run["logs"].append({"t": time.time(), "msg": msg})
        # keep last 200 logs
        if len(run["logs"]) > 200:
            run["logs"] = run["logs"][-200:]
        logger.info("[wf %s] %s", rid, msg)

    try:
        order = _topo_order(nodes, edges)
        nmap = _node_map(nodes)
        run["progress"] = {"done": 0, "total": len(order), "current": None}
        outputs: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))

        for nid in order:
            node = nmap.get(nid)
            if not node:
                continue
            ntype = str(node.get("type") or "")
            data = dict(node.get("data") or {})
            prior_nr = prior.get(nid) if isinstance(prior.get(nid), dict) else None

            # Decide skip
            should_skip = False
            if data.get("disabled") or data.get("skipped"):
                should_skip = True
            elif only_set is not None:
                # Re-run only listed nodes; restore others from prior_results
                if nid not in only_set:
                    if prior_nr and prior_nr.get("status") == "completed":
                        should_skip = True
                    elif ntype in {"prompt", "reference"}:
                        should_skip = False  # re-emit from node data
                    else:
                        should_skip = bool(
                            prior_nr and prior_nr.get("status") == "completed"
                        )
                # nid in only_set → always re-run
            elif skip_completed and prior_nr and prior_nr.get("status") == "completed":
                should_skip = True

            if should_skip and prior_nr and prior_nr.get("status") == "completed":
                log(f"Reuse {nid} ({ntype})")
                _restore_outputs_from_result(nid, ntype, prior_nr, data, outputs)
                run["node_results"][nid] = {**prior_nr, "status": "completed", "reused": True}
                run["progress"]["done"] = int(run["progress"]["done"]) + 1
                continue

            if should_skip and (data.get("disabled") or data.get("skipped")):
                log(f"Skip disabled {nid}")
                run["node_results"][nid] = {"status": "skipped", "type": ntype}
                run["progress"]["done"] = int(run["progress"]["done"]) + 1
                continue

            # gather inputs
            inputs: dict[str, list[Any]] = defaultdict(list)
            for e in _incoming(edges, nid):
                src = str(e.get("source"))
                sh = str(e.get("sourceHandle") or "out")
                th = str(e.get("targetHandle") or "in")
                vals = outputs.get(src, {}).get(sh) or outputs.get(src, {}).get("out") or []
                inputs[th].extend(vals)

            log(f"Run {nid} type={ntype}")
            run["progress"]["current"] = nid
            run["node_results"][nid] = {"status": "running", "type": ntype}

            try:
                result = await _execute_node(nid, ntype, data, inputs, outputs)
                run["node_results"][nid] = result
                run["progress"]["done"] = int(run["progress"]["done"]) + 1
                log(f"OK {nid}")
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
                run["progress"]["current"] = None
                return run

        run["status"] = "completed"
        run["finished_at"] = time.time()
        run["progress"]["current"] = None
        log("Workflow completed")
    except Exception as exc:
        logger.exception("Workflow run failed")
        run["status"] = "failed"
        run["error"] = str(exc)
        run["finished_at"] = time.time()
        run["progress"]["current"] = None

    return run


def start_workflow_background(
    workflow: dict[str, Any],
    *,
    prior_results: dict[str, Any] | None = None,
    skip_completed: bool = False,
    only_node_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Create run record and schedule execution; returns immediately."""
    rid = secrets.token_hex(5)
    nodes = list(workflow.get("nodes") or [])
    run: dict[str, Any] = {
        "run_id": rid,
        "workflow_id": workflow.get("id"),
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "node_results": dict(prior_results or {}),
        "logs": [{"t": time.time(), "msg": "Queued"}],
        "error": None,
        "progress": {"done": 0, "total": len(nodes), "current": None},
        "mode": {
            "skip_completed": skip_completed,
            "only_node_ids": only_node_ids,
        },
    }
    _runs[rid] = run

    async def _task() -> None:
        await run_workflow(
            workflow,
            run_id=rid,
            prior_results=prior_results,
            skip_completed=skip_completed,
            only_node_ids=only_node_ids,
        )

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_task())
    except RuntimeError:
        # no loop — run sync fallback
        asyncio.run(
            run_workflow(
                workflow,
                run_id=rid,
                prior_results=prior_results,
                skip_completed=skip_completed,
                only_node_ids=only_node_ids,
            )
        )
    return run
