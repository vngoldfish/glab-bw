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
_RUNS_MAX = 300         # Tối đa số runs lưu trong memory
_RUNS_TTL = 86_400      # Xóa runs cũ hơn 24 giờ


def _cleanup_runs() -> None:
    """Xóa runs cũ hơn TTL hoặc khi vượt giới hạn max."""
    now = time.time()
    # 1. Xóa theo TTL
    expired = [
        rid for rid, run in _runs.items()
        if run.get("status") in {"completed", "failed"}
        and now - (run.get("finished_at") or run.get("started_at") or now) > _RUNS_TTL
    ]
    for rid in expired:
        del _runs[rid]
    # 2. Nếu vẫn vượt giới hạn, xóa những run cũ nhất
    if len(_runs) > _RUNS_MAX:
        sorted_ids = sorted(
            _runs.keys(),
            key=lambda r: _runs[r].get("started_at") or 0,
        )
        for rid in sorted_ids[: len(_runs) - _RUNS_MAX]:
            del _runs[rid]


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
    if ntype == "video_reference":
        vid = prior.get("video")
        if vid == "(video)" or not vid:
            vid = (prior.get("results") or [None])[0] or node_data.get("video")
        if vid:
            outputs[nid]["video"] = [vid]
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


def _build_custom_filename_prefix(node_data: dict[str, Any], project_id: str | None) -> str | None:
    # 1. Extract prefix number from node title (e.g. "Prompt 001" -> "001")
    title = str(node_data.get("title") or "").strip()
    import re
    m = re.search(r"(\d+)", title)
    prefix_num = m.group(1) if m else ""

    # 2. Get project name and sanitize it
    from app.services.project_store import get_project
    project_name = "Project"
    if project_id:
        try:
            pdoc = get_project(project_id)
            if pdoc:
                project_name = pdoc.get("name") or "Project"
        except Exception:
            pass

    import unicodedata
    def remove_accents(input_str):
        nfkd_form = unicodedata.normalize('NFKD', input_str)
        return "".join([c for c in nfkd_form if not unicodedata.combining(c)])

    clean_name = remove_accents(project_name)
    clean_name = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in clean_name)
    clean_name = re.sub(r"_+", "_", clean_name).strip("_")
    if not clean_name:
        clean_name = "Project"

    # 3. Get current date
    import datetime
    date_str = datetime.datetime.now().strftime("%Y%m%d")

    # 4. Combine
    if prefix_num:
        return f"{prefix_num}_{clean_name}_{date_str}"
    return f"{clean_name}_{date_str}"


async def _execute_node(
    nid: str,
    ntype: str,
    data: dict[str, Any],
    inputs: dict[str, list[Any]],
    outputs: dict[str, dict[str, list[Any]]],
    *,
    project_id: str | None = None,
    workflow: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run one node; mutates outputs; returns node_results entry."""
    # Project-scoped output folders
    img_folder = data.get("output_folder")
    vid_folder = data.get("output_folder")
    if project_id:
        from app.services.project_outputs import project_output_folder

        img_folder = img_folder or project_output_folder(project_id, "images")
        vid_folder = vid_folder or project_output_folder(project_id, "videos")
    else:
        img_folder = img_folder or "G-Labs BW/image_output"
        vid_folder = vid_folder or "G-Labs BW/video_output"
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

    if ntype == "video_reference":
        vid = data.get("video") or data.get("file_url") or data.get("file_path")
        if not vid and inputs.get("video"):
            vid = inputs["video"][0]
        if not vid:
            raise ValueError("Video reference node missing video file")
        if not str(vid).startswith("data:") and not str(vid).startswith("http"):
            try:
                p = resolve_data_file(str(vid))
                vid = file_url_from_path(p)
            except Exception:
                pass
        outputs[nid]["video"] = [vid]
        return {
            "status": "completed",
            "type": ntype,
            "video": vid if isinstance(vid, str) and len(vid) < 200 else "(video)",
            "results": [vid] if isinstance(vid, str) and vid.startswith(("http", "data:", "/")) else [],
        }


    if ntype == "generate":
        prompt = ""
        if inputs.get("prompt"):
            prompt = str(inputs["prompt"][0])
        prompt = prompt or str(data.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("Generate needs prompt")
        # Edge inputs + optional images attached on the node itself
        refs = list(inputs.get("image") or [])
        for key in ("image", "ref_image", "reference_image"):
            val = data.get(key)
            if val and val not in refs:
                refs.append(val)
        extra = data.get("reference_images") or data.get("images") or []
        if isinstance(extra, list):
            for val in extra:
                if val and val not in refs:
                    refs.append(val)
        ref_data: list[str] = []
        for r in refs[:3]:
            if str(r).startswith("data:"):
                ref_data.append(str(r))
            else:
                try:
                    ref_data.append(await _url_to_data_url(str(r)))
                except Exception:
                    pass
        custom_prefix = _build_custom_filename_prefix(data, project_id)
        params = {
            "model": data.get("model") or "nano_banana_2_lite",
            "aspect_ratio": data.get("aspect_ratio") or "1:1",
            "count": int(data.get("count") or 1),
            "save_mode": "task",
            "output_folder": img_folder,
            "custom_prefix": custom_prefix,
        }
        if ref_data:
            params["reference_images"] = ref_data
        try:
            from app.services import reference_storage
            params["named_references"] = reference_storage.list_references().get("references", [])
        except Exception as e:
            logger.exception("Failed to inject named_references: %s", e)
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
        # VideoNode có thể lưu prompt vào 'prompt_hint' (ô inline) hoặc 'prompt' hoặc 'text'
        prompt = (
            prompt
            or str(data.get("prompt") or "").strip()
            or str(data.get("prompt_hint") or "").strip()
            or str(data.get("text") or "").strip()
        )
        if not prompt:
            raise ValueError("Video needs prompt")
        start_refs = list(inputs.get("start_image") or inputs.get("image") or [])
        end_refs = list(inputs.get("end_image") or [])
        
        # Look up Reference nodes connected to the "reference" handle of this node to preserve refNames
        connected_references = []
        if workflow:
            edges_list = list(workflow.get("edges") or [])
            nodes_list = list(workflow.get("nodes") or [])
            nodes_map = {str(n["id"]): n for n in nodes_list}
            for e in edges_list:
                if str(e.get("target")) == nid and str(e.get("targetHandle")) == "reference":
                    src_id = str(e.get("source"))
                    src_node = nodes_map.get(src_id)
                    if src_node and src_node.get("type") == "reference":
                        src_data = src_node.get("data") or {}
                        ref_name = src_data.get("refName")
                        img_val = outputs.get(src_id, {}).get("image")
                        img_url = img_val[0] if img_val else src_data.get("image")
                        if ref_name and img_url:
                            connected_references.append({
                                "name": ref_name,
                                "url": img_url
                            })

        # Node-attached images (pick from library / upload without edge)
        for key in ("start_image", "image", "startImage"):
            val = data.get(key)
            if val and val not in start_refs:
                start_refs.insert(0, val)
                break
        for key in ("end_image", "endImage"):
            val = data.get(key)
            if val and val not in end_refs:
                end_refs.insert(0, val)
                break
        
        # Default mode: components if we have reference edges, otherwise start_image if start_refs, otherwise text_to_video
        has_ref_conn = len(connected_references) > 0
        mode = data.get("mode") or ("components" if has_ref_conn else "start_image" if start_refs else "text_to_video")
        custom_prefix = _build_custom_filename_prefix(data, project_id)
        params: dict[str, Any] = {
            "model": data.get("model") or "veo_31_fast",
            "aspect_ratio": data.get("aspect_ratio") or "16:9",
            "mode": mode,
            "save_mode": "task",
            "output_folder": vid_folder,
            "resolution": data.get("resolution") or ["720p"],
            "custom_prefix": custom_prefix,
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
            if len(ref_list) >= 2 and not has_ref_conn:
                params["mode"] = "start_end_image"
            elif mode == "text_to_video" and not has_ref_conn:
                params["mode"] = "start_image"
        
        # Inject named references from library
        try:
            from app.services import reference_storage
            library_refs = reference_storage.list_references().get("references", [])
        except Exception as e:
            logger.exception("Failed to inject named_references: %s", e)
            library_refs = []

        # Convert connected Reference nodes to base64 data URLs and override/append to named_references
        active_named_refs = list(library_refs)
        for ref in connected_references:
            try:
                data_url = await _url_to_data_url(ref["url"])
                # Override if character with the same name exists
                active_named_refs = [r for r in active_named_refs if r.get("name") != ref["name"]]
                active_named_refs.append({
                    "name": ref["name"],
                    "data": data_url
                })
            except Exception as e:
                logger.error("Failed to convert connected reference %s to data URL: %s", ref["name"], e)
                
        params["named_references"] = active_named_refs
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
        # Accept full API URL, relative /api/files/, or data-relative path
        if "/api/files/" in vurl:
            rel = unquote(vurl.split("/api/files/", 1)[1].split("?", 1)[0])
            vpath = resolve_data_file(rel)
        elif vurl.startswith("http://") or vurl.startswith("https://"):
            # http://127.0.0.1:8765/api/files/...
            if "/api/files/" in vurl:
                rel = unquote(vurl.split("/api/files/", 1)[1].split("?", 1)[0])
                vpath = resolve_data_file(rel)
            else:
                raise ValueError(f"Unsupported video URL: {vurl[:120]}")
        else:
            vpath = resolve_data_file(unquote(vurl.lstrip("/")))
        positions = data.get("positions") or ["end"]
        if isinstance(positions, str):
            positions = [p.strip() for p in positions.split(",") if p.strip()]
        # default for continue-video pipelines: only end frame
        if not positions:
            positions = ["end"]
        frame_out = None
        if project_id:
            from app.services.project_outputs import project_root

            frame_out = project_root(project_id) / "frames"
        frames = extract_frames(vpath, positions=list(positions), output_dir=frame_out)
        urls = [f["url"] for f in frames]
        by_pos = {str(f.get("position")): f["url"] for f in frames if f.get("url")}
        # Prefer dedicated handles
        if "start" in by_pos:
            outputs[nid]["start_image"] = [by_pos["start"]]
        if "end" in by_pos:
            outputs[nid]["end_image"] = [by_pos["end"]]
        elif urls:
            # only one frame extracted (often "end") → treat as end
            if len(urls) == 1 and positions == ["end"]:
                outputs[nid]["end_image"] = [urls[0]]
            elif "middle" in by_pos and "end" not in by_pos:
                pass
        # image handle: if user wants "last frame for next video", put END first
        # so accidental wire image→start_image still prefers end when only end exists
        ordered: list[str] = []
        for key in ("end", "start", "middle"):
            if key in by_pos and by_pos[key] not in ordered:
                ordered.append(by_pos[key])
        for u in urls:
            if u not in ordered:
                ordered.append(u)
        outputs[nid]["image"] = ordered or urls
        return {
            "status": "completed",
            "type": ntype,
            "frames": frames,
            "results": ordered or urls,
        }

    raise ValueError(f"Unknown node type: {ntype}")


async def run_workflow(
    workflow: dict[str, Any],
    *,
    run_id: str | None = None,
    prior_results: dict[str, Any] | None = None,
    skip_completed: bool = False,
    only_node_ids: list[str] | None = None,
    project_id: str | None = None,
) -> dict[str, Any]:
    """
    Execute graph in parallel topological order.
    Executes independent nodes concurrently while keeping correct execution sequence for dependents.
    """
    rid = run_id or secrets.token_hex(5)
    nodes = list(workflow.get("nodes") or [])
    edges = list(workflow.get("edges") or [])
    prior = dict(prior_results or {})
    only_set = set(only_node_ids) if only_node_ids else None
    pid = project_id or workflow.get("project_id")

    run: dict[str, Any] = _runs.get(rid) or {
        "run_id": rid,
        "workflow_id": workflow.get("id"),
        "project_id": pid,
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "node_results": {},
        "logs": [],
        "error": None,
        "progress": {"done": 0, "total": len(nodes), "current": None},
    }
    run["project_id"] = pid
    run["status"] = "running"
    run["error"] = None
    run["finished_at"] = None
    if prior:
        run["node_results"] = {**prior, **run.get("node_results", {})}
    _runs[rid] = run

    def log(msg: str) -> None:
        run["logs"].append({"t": time.time(), "msg": msg})
        if len(run["logs"]) > 200:
            run["logs"] = run["logs"][-200:]
        logger.info("[wf %s] %s", rid, msg)

    try:
        nmap = _node_map(nodes)
        ids = {str(n["id"]) for n in nodes}
        run["progress"] = {"done": 0, "total": len(ids), "current": None}
        outputs: dict[str, dict[str, list[Any]]] = defaultdict(lambda: defaultdict(list))

        # Build dependency graph
        adj: dict[str, list[str]] = defaultdict(list)
        parents: dict[str, list[str]] = defaultdict(list)
        for e in edges:
            s, t = str(e.get("source")), str(e.get("target"))
            if s not in ids or t not in ids:
                continue
            adj[s].append(t)
            parents[t].append(s)

        completed_nodes = set()

        # 1. First Pass: Handle nodes that can be skipped or reused
        for nid in ids:
            node = nmap.get(nid)
            if not node:
                continue
            ntype = str(node.get("type") or "")
            data = dict(node.get("data") or {})
            prior_nr = prior.get(nid) if isinstance(prior.get(nid), dict) else None

            should_skip = False
            if data.get("disabled") or data.get("skipped"):
                should_skip = True
            elif only_set is not None:
                if nid not in only_set:
                    if prior_nr and prior_nr.get("status") == "completed":
                        should_skip = True
                    elif ntype in {"prompt", "reference", "video_reference"}:
                        should_skip = False

                    else:
                        should_skip = bool(prior_nr and prior_nr.get("status") == "completed")
            elif skip_completed and prior_nr and prior_nr.get("status") == "completed":
                should_skip = True

            if should_skip:
                if prior_nr and prior_nr.get("status") == "completed":
                    log(f"Reuse {nid} ({ntype})")
                    _restore_outputs_from_result(nid, ntype, prior_nr, data, outputs)
                    run["node_results"][nid] = {**prior_nr, "status": "completed", "reused": True}
                else:
                    log(f"Skip disabled {nid}")
                    run["node_results"][nid] = {"status": "skipped", "type": ntype}
                
                completed_nodes.add(nid)
                run["progress"]["done"] = int(run["progress"]["done"]) + 1

        # Track active incomplete parent counts
        active_parent_count = {}
        for nid in ids:
            if nid in completed_nodes:
                continue
            active_parent_count[nid] = sum(1 for p in parents[nid] if p not in completed_nodes)

        # Sort helper to order task launch priority logically
        def sort_nodes_key(nid_str: str) -> tuple[float, float, float]:
            node_item = nmap.get(nid_str)
            if not node_item:
                return (float('inf'), 0.0, 0.0)
            
            # Extract number from title (e.g. "Prompt 001" -> 1.0)
            title = str((node_item.get("data") or {}).get("title") or "")
            import re
            m = re.search(r"(\d+(?:\.\d+)?)", title)
            num = float(m.group(1)) if m else float('inf')
            
            pos = node_item.get("position") or {}
            y = float(pos.get("y") or 0.0)
            x = float(pos.get("x") or 0.0)
            return (num, y, x)

        # Nodes ready to execute (0 active parents)
        ready_queue = [nid for nid in ids if nid not in completed_nodes and active_parent_count.get(nid, 0) == 0]
        running_tasks: dict[str, asyncio.Task] = {}
        failed_node_error = None

        # 2. Parallel Event Loop
        while (ready_queue or running_tasks) and not failed_node_error:
            # Sort queue before launching so smaller prefix numbers or top nodes launch first
            ready_queue.sort(key=sort_nodes_key)

            # Launch all ready nodes
            while ready_queue and not failed_node_error:
                nid = ready_queue.pop(0)
                node = nmap.get(nid)
                if not node:
                    continue
                ntype = str(node.get("type") or "")
                data = dict(node.get("data") or {})

                # Gather inputs
                inputs: dict[str, list[Any]] = defaultdict(list)
                for e in _incoming(edges, nid):
                    src = str(e.get("source"))
                    sh = str(e.get("sourceHandle") or "out")
                    th = str(e.get("targetHandle") or "in")
                    vals = outputs.get(src, {}).get(sh) or outputs.get(src, {}).get("out") or []
                    inputs[th].extend(vals)

                log(f"Run {nid} type={ntype} (Parallel)")
                run["progress"]["current"] = nid
                run["node_results"][nid] = {"status": "running", "type": ntype}

                # Start node execution asynchronously
                task = asyncio.create_task(
                    _execute_node(
                        nid, ntype, data, inputs, outputs, 
                        project_id=str(pid) if pid else None,
                        workflow=workflow
                    )
                )
                running_tasks[nid] = task

            if not running_tasks:
                break

            # Wait for at least one node to finish
            done, _ = await asyncio.wait(
                list(running_tasks.values()),
                return_when=asyncio.FIRST_COMPLETED
            )

            # Process completed tasks
            for task in done:
                # Find corresponding node ID
                finished_nid = None
                for nid_key, t in running_tasks.items():
                    if t == task:
                        finished_nid = nid_key
                        break
                
                if not finished_nid:
                    continue

                del running_tasks[finished_nid]
                node = nmap.get(finished_nid)
                ntype = str(node.get("type") or "") if node else ""

                try:
                    result = task.result()
                    run["node_results"][finished_nid] = result
                    run["progress"]["done"] = int(run["progress"]["done"]) + 1
                    log(f"OK {finished_nid}")

                    completed_nodes.add(finished_nid)

                    # Trigger child nodes if all their parents are done
                    for child in adj[finished_nid]:
                        if child in completed_nodes:
                            continue
                        active_parent_count[child] -= 1
                        if active_parent_count[child] == 0:
                            ready_queue.append(child)

                except Exception as exc:
                    log(f"Node {finished_nid} FAILED: {exc}")
                    run["node_results"][finished_nid] = {
                        "status": "failed",
                        "type": ntype,
                        "error": str(exc),
                    }
                    failed_node_error = f"Node {finished_nid} ({ntype}): {exc}"
                    run["status"] = "failed"
                    run["error"] = failed_node_error
                    run["finished_at"] = time.time()
                    break

        if failed_node_error:
            # Cancel all other active tasks if one fails
            for t in running_tasks.values():
                t.cancel()
            run["progress"]["current"] = None
            return run

        run["status"] = "completed"
        run["finished_at"] = time.time()
        run["progress"]["current"] = None
        log("Workflow completed (Parallel)")
        _cleanup_runs()  # Dọn runs cũ để tránh memory leak

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
    project_id: str | None = None,
) -> dict[str, Any]:
    """Create run record and schedule execution; returns immediately."""
    rid = secrets.token_hex(5)
    nodes = list(workflow.get("nodes") or [])
    pid = project_id or workflow.get("project_id")
    if pid:
        from app.services.project_outputs import project_root

        project_root(str(pid))
    run: dict[str, Any] = {
        "run_id": rid,
        "workflow_id": workflow.get("id"),
        "project_id": pid,
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "node_results": dict(prior_results or {}),
        "logs": [{"t": time.time(), "msg": f"Queued (project={pid or '-'})"}],
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
            project_id=str(pid) if pid else None,
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
                project_id=str(pid) if pid else None,
            )
        )
    return run
