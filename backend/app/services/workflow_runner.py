"""Execute workflow graphs in topological order with progressive node updates."""

from __future__ import annotations

import asyncio
import base64
import datetime
import logging
import re
import secrets
import time
import unicodedata
from collections import defaultdict, deque
from typing import Any
from urllib.parse import unquote, urlparse

from app.core.config import settings
from app.services.frame_extract import extract_frames
from app.services.generation import handle_batch_item
from app.services.output_storage import file_url_from_path, resolve_data_file

logger = logging.getLogger(__name__)

_runs: dict[str, dict[str, Any]] = {}
_runs_lock = asyncio.Lock()
_RUNS_MAX = 300         # Tối đa số runs lưu trong memory
_RUNS_TTL = 86_400      # Xóa runs cũ hơn 24 giờ


async def _cleanup_runs() -> None:
    """Xóa runs cũ hơn TTL hoặc khi vượt giới hạn max."""
    async with _runs_lock:
        now = time.time()
        # 1. Xóa theo TTL
        expired = [
            rid for rid, run in _runs.items()
            if run.get("status") in {"completed", "failed"}
            and now - (run.get("finished_at") or run.get("started_at") or now) > _RUNS_TTL
        ]
        for rid in expired:
            del _runs[rid]
        # 2. Nếu vẫn vượt giới hạn, xóa những run cũ nhất (only completed/failed)
        if len(_runs) > _RUNS_MAX:
            trimmable = sorted(
                (rid for rid, run in _runs.items()
                 if run.get("status") in {"completed", "failed"}),
                key=lambda r: _runs[r].get("started_at") or 0,
            )
            excess = len(_runs) - _RUNS_MAX
            for rid in trimmable[:excess]:
                del _runs[rid]


def get_run(run_id: str) -> dict[str, Any] | None:
    return _runs.get(run_id)


def update_node_progress(run_id: str, node_id: str, percent: int, step: str) -> None:
    run = _runs.get(run_id)
    if run and "node_results" in run:
        if node_id not in run["node_results"]:
            run["node_results"][node_id] = {}
        run["node_results"][node_id]["percent"] = percent
        run["node_results"][node_id]["step"] = step


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
        raise ValueError("Workflow contains cycles (vòng lặp liên kết). Vui lòng kiểm tra lại sơ đồ nối node.")
    return order


def _node_map(nodes: list[dict]) -> dict[str, dict]:
    return {str(n["id"]): n for n in nodes}


def _incoming(edges: list[dict], target_id: str) -> list[dict]:
    return [e for e in edges if str(e.get("target")) == target_id]


async def _url_to_data_url(url: str) -> str:
    if url.startswith("data:"):
        return url
    raw = url.strip()
    storage_path = None
    if "/api/files/" in raw:
        storage_path = unquote(raw.split("/api/files/", 1)[1].split("?", 1)[0])
    elif raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        if parsed.path.startswith("/api/files/"):
            storage_path = unquote(parsed.path[len("/api/files/") :])
    else:
        storage_path = unquote(raw.split("?", 1)[0])

    if not storage_path:
        raise ValueError(f"Cannot parse storage path from url: {url[:100]}")

    path = resolve_data_file(storage_path)
    if not path.is_file():
        raise ValueError(f"File not found at path: {path}")

    data = path.read_bytes()
    mime = "image/png"
    suf = path.suffix.lower()
    if suf in {".jpg", ".jpeg"}:
        mime = "image/jpeg"
    elif suf == ".webp":
        mime = "image/webp"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _find_incoming_modifiers(nid: str, workflow: dict[str, Any] | None) -> list[str]:
    if not workflow:
        return []
    edges = list(workflow.get("edges") or [])
    nodes = list(workflow.get("nodes") or [])
    nmap = {str(n["id"]): n for n in nodes}
    modifiers = []
    for e in edges:
        if str(e.get("target")) == nid:
            src = str(e.get("source"))
            src_node = nmap.get(src)
            if src_node and src_node.get("type") in {"generate_plus", "video_generate_plus"}:
                src_data = src_node.get("data") or {}
                if src_node.get("type") == "generate_plus":
                    for fld in ("cameraAngle", "style", "lighting", "composition"):
                        val = src_data.get(fld)
                        if val:
                            modifiers.append(val)
                elif src_node.get("type") == "video_generate_plus":
                    for fld in ("cameraAngle", "style", "cameraMovement", "movementSpeed"):
                        val = src_data.get(fld)
                        if val:
                            modifiers.append(val)
    return modifiers


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
            outputs[nid]["video_motion"] = [vid]
        return
    if ntype == "audio_source":
        audio = prior.get("audio") or node_data.get("audio")
        if audio:
            outputs[nid]["audio"] = [audio]
        return

    results = list(prior.get("results") or [])
    if ntype in {"generate", "generate_plus"}:
        if results:
            outputs[nid]["image"] = results
        return
    if ntype in {"video_generate", "video_generate_plus"}:
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
    m = re.search(r"(\d+)", title)
    prefix_num = m.group(1) if m else ""

    # Unique node ID fallback so nodes with identical titles never overwrite each other's files
    raw_nid = str(node_data.get("id") or node_data.get("workflow_node_id") or "").split("_")[-1]
    node_tag = prefix_num if prefix_num else (raw_nid if raw_nid else secrets.token_hex(3))

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

    def remove_accents(input_str):
        nfkd_form = unicodedata.normalize('NFKD', input_str)
        return "".join([c for c in nfkd_form if not unicodedata.combining(c)])

    clean_name = remove_accents(project_name)
    clean_name = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in clean_name)
    clean_name = re.sub(r"_+", "_", clean_name).strip("_")
    if not clean_name:
        clean_name = "Project"

    # 3. Get current date
    date_str = datetime.datetime.now().strftime("%Y%m%d")

    # 4. Combine with unique node discriminator
    return f"{node_tag}_{clean_name}_{date_str}"


def _get_tag_context(prompt: str, tag: str, window: int = 5) -> str:
    """Extract words surrounding @tag in the prompt for context-based role detection.
    Returns a lowercase string of nearby words (within `window` words each side).
    """
    import re as _re
    words = _re.split(r"\s+", prompt.lower())
    tag_lower = f"@{tag.lower()}"
    context_words = []
    for i, w in enumerate(words):
        if tag_lower in w:
            start = max(0, i - window)
            end = min(len(words), i + window + 1)
            context_words.extend(words[start:end])
    return " ".join(context_words)


async def _execute_node(
    nid: str,
    ntype: str,
    data: dict[str, Any],
    inputs: dict[str, list[Any]],
    outputs: dict[str, dict[str, list[Any]]],
    *,
    project_id: str | None = None,
    workflow: dict[str, Any] | None = None,
    run_id: str | None = None,
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
        outputs[nid]["video_motion"] = [vid]
        return {
            "status": "completed",
            "type": ntype,
            "video": vid if isinstance(vid, str) and len(vid) < 200 else "(video)",
            "results": [vid] if isinstance(vid, str) and vid.startswith(("http", "data:", "/")) else [],
        }

    if ntype == "audio_source":
        audio = data.get("audio") or data.get("file_url") or data.get("file_path")
        if not audio and inputs.get("audio"):
            audio = inputs["audio"][0]
        if not audio:
            raise ValueError("Audio node chưa có file nhạc")
        outputs[nid]["audio"] = [audio]
        return {
            "status": "completed",
            "type": ntype,
            "audio": audio,
            "results": [],
        }

    if ntype in {"generate", "generate_plus"}:
        prompt = ""
        if inputs.get("prompt"):
            prompt = str(inputs["prompt"][0])
        prompt = prompt or str(data.get("prompt") or "").strip()

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

        if not prompt:
            if ntype == "generate_plus" and refs:
                pass
            else:
                node_title = data.get("title") or ("Tạo ảnh +" if ntype == "generate_plus" else "Tạo ảnh")
                raise ValueError(f"Node '{node_title}' chưa có prompt (vui lòng nhập prompt hoặc nối từ node Prompt)")

        # Append style/camera angle modifiers from connected generate_plus/video_generate_plus nodes
        modifiers = _find_incoming_modifiers(nid, workflow)
        # For generate_plus nodes, also inject own studio settings
        if ntype == "generate_plus":
            for field in ("cameraAngle", "style", "lighting", "composition"):
                val = data.get(field)
                if val:
                    modifiers.append(val)
        if modifiers:
            if prompt:
                prompt = f"{prompt}, {', '.join(modifiers)}"
            else:
                prompt = ", ".join(modifiers)
        ref_data: list[str] = []
        for r in refs[:3]:
            if str(r).startswith("data:"):
                ref_data.append(str(r))
            else:
                try:
                    ref_data.append(await _url_to_data_url(str(r)))
                except Exception:
                    pass
        engine = data.get("engine") or "flow"
        provider = "image"
        if engine == "grok":
            provider = "grok"
        elif engine == "meta":
            provider = "meta"
        elif engine == "openai":
            provider = "openai"

        custom_prefix = _build_custom_filename_prefix(data, project_id)
        params = {
            "model": data.get("model") or (
                "nano_banana_2_lite" if engine == "flow" else
                "grok-3" if engine == "grok" else
                "midjen-base" if engine == "meta" else
                "dall-e-3"
            ),
            "aspect_ratio": data.get("aspect_ratio") or data.get("aspectRatio") or "16:9",
            "count": int(data.get("count") or 1),
            "save_mode": "flat",
            "output_folder": img_folder,
            "custom_prefix": custom_prefix,
            "mode": "t2i",
        }
        if run_id:
            params["workflow_run_id"] = run_id
        params["workflow_node_id"] = nid
        if ref_data:
            params["reference_images"] = ref_data
        # Collect Reference nodes connected to the "image" handle of this node to preserve refNames
        connected_references = []
        if workflow:
            edges_list = list(workflow.get("edges") or [])
            nodes_list = list(workflow.get("nodes") or [])
            nodes_map = {str(n["id"]): n for n in nodes_list}
            for e in edges_list:
                if str(e.get("target")) == nid and str(e.get("targetHandle")) == "image":
                    src_id = str(e.get("source"))
                    src_node = nodes_map.get(src_id)
                    if src_node and src_node.get("type") in {"reference", "generate_plus"}:
                        src_data = src_node.get("data") or {}
                        ref_name = str(src_data.get("refName") or "").lstrip("@").strip()
                        img_val = outputs.get(src_id, {}).get("image") or outputs.get(src_id, {}).get("results")
                        img_url = img_val[0] if img_val else (
                            src_data.get("image")
                            or src_data.get("file_url")
                            or src_data.get("file_path")
                            or (src_data.get("resultUrls") and src_data.get("resultUrls")[0])
                        )
                        if ref_name and img_url:
                            connected_references.append({
                                "name": ref_name,
                                "url": img_url
                            })

        try:
            from app.services import reference_storage
            library_refs = reference_storage.list_references().get("references", [])
        except Exception as e:
            logger.exception("Failed to inject named_references: %s", e)
            library_refs = []

        active_named_refs = list(library_refs)

        # Convert connected Reference nodes to base64 data URLs and override/append to named_references
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

        inline_ref_img = data.get("image")
        inline_ref_name = data.get("refName")
        if inline_ref_img and inline_ref_name:
            try:
                data_url = await _url_to_data_url(inline_ref_img)
                # Override if name conflicts
                active_named_refs = [r for r in active_named_refs if r.get("name") != inline_ref_name]
                active_named_refs.append({
                    "name": inline_ref_name,
                    "data": data_url
                })
            except Exception as e:
                logger.error("Failed to convert inline reference image to data URL: %s", e)

        params["named_references"] = active_named_refs
        out = await handle_batch_item(prompt, provider, params)
        urls = out["urls"]
        outputs[nid]["image"] = urls
        return {
            "status": "completed",
            "type": ntype,
            "results": urls,
            "folder": out.get("folder"),
        }

    if ntype in {"video_generate", "video_generate_plus"}:
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

        start_refs = list(inputs.get("start_image") or inputs.get("image") or [])
        end_refs = list(inputs.get("end_image") or [])
        
        # Look up Reference nodes connected to the "reference" handle of this node to preserve refNames
        connected_references = []
        # Look up Reference nodes connected to the "scene_ref" handle for scenery/background
        connected_scenes = []
        if workflow:
            edges_list = list(workflow.get("edges") or [])
            nodes_list = list(workflow.get("nodes") or [])
            nodes_map = {str(n["id"]): n for n in nodes_list}
            for e in edges_list:
                target_handle = str(e.get("targetHandle") or "")
                if str(e.get("target")) != nid:
                    continue
                src_id = str(e.get("source"))
                src_node = nodes_map.get(src_id)
                if not src_node or src_node.get("type") not in {"reference", "generate_plus", "generate"}:
                    continue
                src_data = src_node.get("data") or {}
                ref_name = str(src_data.get("refName") or "").lstrip("@").strip()
                img_val = outputs.get(src_id, {}).get("image") or outputs.get(src_id, {}).get("results")
                img_url = img_val[0] if img_val else (
                    src_data.get("image")
                    or src_data.get("file_url")
                    or src_data.get("file_path")
                    or (src_data.get("resultUrls") and src_data.get("resultUrls")[0])
                )
                if not img_url:
                    continue
                if target_handle == "reference":
                    if ref_name:
                        connected_references.append({"name": ref_name, "url": img_url})
                elif target_handle == "scene_ref":
                    scene_name = ref_name or f"scene_{len(connected_scenes) + 1}"
                    connected_scenes.append({"name": scene_name, "url": img_url})

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

        motion_refs = list(inputs.get("video_motion") or inputs.get("video") or [])
        motion_video = data.get("video_motion") or data.get("motion_video") or (motion_refs[0] if motion_refs else None)
        has_motion = bool(motion_video)

        # ── Smart @Tag Prompt Parser ──────────────────────────────────────────
        # Scan ALL nodes in the workflow (not just directly connected ones) for
        # named assets. When the user writes @tag in their prompt, auto-assign
        # roles: character ref, scene ref, or motion video, based on context.
        if workflow and prompt:
            import re as _re_tags
            prompt_tags = _re_tags.findall(r"@([\w_]+)", prompt)
            if prompt_tags:
                all_nodes = list(workflow.get("nodes") or [])
                all_edges = list(workflow.get("edges") or [])
                # Build map: refName → (node_type, node_data, node_id)
                named_assets: dict[str, dict] = {}
                for wn in all_nodes:
                    wn_data = wn.get("data") or {}
                    wn_ref = str(wn_data.get("refName") or "").lstrip("@").strip()
                    if wn_ref:
                        wn_type = str(wn.get("type") or "")
                        named_assets[wn_ref.lower()] = {
                            "name": wn_ref,
                            "node_type": wn_type,
                            "node_id": str(wn.get("id")),
                            "data": wn_data,
                        }

                # Check which nodes are already directly connected to this node
                direct_source_ids = set()
                for e in all_edges:
                    if str(e.get("target")) == nid:
                        direct_source_ids.add(str(e.get("source")))

                # Keywords for role detection
                VIDEO_KEYWORDS = {"theo", "giống", "mẫu", "dựa", "follow", "like", "imitate", "mimic", "copy", "dance", "nhảy"}
                SCENE_KEYWORDS = {"ở", "tại", "cảnh", "background", "location", "bối cảnh", "nơi", "scene", "environment", "phong cảnh"}

                for tag in prompt_tags:
                    tag_lower = tag.lower()
                    asset = named_assets.get(tag_lower)
                    if not asset:
                        continue
                    # Skip if already connected directly
                    if asset["node_id"] in direct_source_ids:
                        continue
                    
                    node_type = asset["node_type"]
                    a_data = asset["data"]

                    if node_type == "video_reference":
                        # Video tag → check context for role
                        vid_url = (a_data.get("video")
                                   or (a_data.get("resultUrls") and a_data["resultUrls"][0]))
                        if vid_url and not has_motion:
                            # Find words near the @tag for context
                            tag_context = _get_tag_context(prompt, tag)
                            if any(kw in tag_context for kw in VIDEO_KEYWORDS):
                                # Motion/dance/follow → use as motion video
                                motion_video = vid_url
                                has_motion = True
                                # Auto-set motionMode based on context
                                if "inspire" not in (data.get("motionMode") or ""):
                                    # Default to transform if character refs exist, inspire otherwise
                                    if connected_references:
                                        data["motionMode"] = "transform"
                                    else:
                                        data["motionMode"] = "inspire"
                                logger.info("@tag parser: %s → motion_video (mode=%s)", tag, data.get("motionMode"))
                            else:
                                # No specific context → use as inspire reference
                                motion_video = vid_url
                                has_motion = True
                                data["motionMode"] = "inspire"
                                logger.info("@tag parser: %s → motion_video (inspire, no specific context)", tag)

                    elif node_type in {"reference", "generate", "generate_plus"}:
                        img_url = (a_data.get("image")
                                   or a_data.get("file_url")
                                   or (a_data.get("resultUrls") and a_data["resultUrls"][0]))
                        if not img_url:
                            continue
                        ref_name = asset["name"]
                        # Check if already in connected_references or connected_scenes
                        existing_names = {r["name"].lower() for r in connected_references + connected_scenes}
                        if ref_name.lower() in existing_names:
                            continue
                        # Detect role from context
                        tag_context = _get_tag_context(prompt, tag)
                        if any(kw in tag_context for kw in SCENE_KEYWORDS):
                            connected_scenes.append({"name": ref_name, "url": img_url})
                            logger.info("@tag parser: %s → scene reference", tag)
                        else:
                            connected_references.append({"name": ref_name, "url": img_url})
                            logger.info("@tag parser: %s → character reference", tag)

        has_any_ref = bool(start_refs or end_refs or connected_references or connected_scenes or has_motion)

        if not prompt:
            has_timeline = bool(data.get("cameraMovement") or data.get("timelineSegments"))
            if (ntype == "video_generate_plus" and (has_any_ref or has_timeline)) or has_motion:
                if not prompt and has_motion:
                    motion_mode = data.get("motionMode") or "transform"
                    if motion_mode == "inspire":
                        prompt = "A visually stunning cinematic video following the same style, movement, pacing, and composition as the reference video"
                    else:
                        prompt = "Character dynamically emulating and performing the dance movements and choreography from the reference motion video"
            else:
                node_title = data.get("title") or ("Tạo video +" if ntype == "video_generate_plus" else "Tạo video")
                raise ValueError(f"Node '{node_title}' chưa có prompt (vui lòng nhập prompt hoặc nối từ node Prompt)")

        # Append style/camera angle modifiers from connected generate_plus/video_generate_plus nodes
        modifiers = _find_incoming_modifiers(nid, workflow)
        # For video_generate_plus nodes, also inject own studio settings
        if ntype == "video_generate_plus":
            SPEED_PROMPT_MAP = {
                "slowmo": "Extreme slow motion, 0.25x speed, dramatic time dilation",
                "slow": "Slow deliberate pace, 0.5x speed, contemplative mood",
                "fast": "Fast energetic pace, 2x speed, dynamic movement",
                "timelapse": "Time-lapse accelerated speed, compressing hours into seconds",
            }
            for field in ("cameraAngle", "style", "cameraMovement"):
                val = data.get(field)
                if val:
                    modifiers.append(val)
            # movementSpeed uses id values → map to descriptive prompt text
            speed_val = data.get("movementSpeed") or ""
            speed_prompt = SPEED_PROMPT_MAP.get(speed_val, "")
            if speed_prompt:
                modifiers.append(speed_prompt)
        if modifiers:
            if prompt:
                prompt = f"{prompt}, {', '.join(modifiers)}"
            else:
                prompt = ", ".join(modifiers)

        motion_aspect: str | None = None
        if has_motion and motion_video:
            if run_id:
                update_node_progress(run_id, nid, 12, "Đang phân tích chuyển động từ Video mẫu...")
            try:
                import subprocess
                from app.services.output_storage import resolve_data_file
                p = resolve_data_file(str(motion_video))
                if p.is_file():
                    out = subprocess.check_output(
                        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(p)],
                        text=True,
                        timeout=10,
                    ).strip()
                    parts = out.split(",")
                    if len(parts) >= 2:
                        w, h = int(parts[0]), int(parts[1])
                        if h > w:
                            motion_aspect = "9:16"
                        else:
                            motion_aspect = "16:9"
            except Exception as exc:
                logger.debug("ffprobe aspect check failed: %s", exc)

            import re
            char_tags = re.findall(r"@[\w_]+", prompt)
            char_tag_str = char_tags[0] if char_tags else "@character"

            # Build enriched cinematic prompt based on connected references
            scene_tags = [f"@{s['name']}" for s in connected_scenes]
            scene_tag_str = ", ".join(scene_tags) if scene_tags else ""

            motion_mode = data.get("motionMode") or "transform"

            if motion_mode == "inspire":
                # "Học theo / Lấy cảm hứng" mode — user's prompt is the main creative input.
                # The reference video acts as a style/motion/composition guide, NOT a character swap.
                inspire_prefix = (
                    "Create a new video inspired by the reference video. "
                    "Follow the same overall movement flow, pacing, camera motion, visual rhythm, "
                    "and composition style from the reference. "
                )
                if connected_scenes and scene_tag_str:
                    inspire_prefix += (
                        f"Set the scene in the environment shown in {scene_tag_str} — "
                        f"use the exact background, lighting, color palette, and atmosphere "
                        f"from the scenery reference images. "
                    )
                if connected_references and char_tag_str:
                    inspire_prefix += (
                        f"Feature {char_tag_str} as the main character. "
                    )
                prompt = f"{inspire_prefix}{prompt}".strip()
                logger.info("Motion mode=inspire → prompt: %s...", prompt[:120])
            else:
                # Default "transform" mode — Transform character in video
                if "transform" not in prompt.lower() and "replace" not in prompt.lower():
                    base_motion = (
                        f"Transform the person in the video into {char_tag_str}, "
                        f"precisely replicating all dance movements, body motion, and choreography "
                        f"from the original video"
                    )
                    if connected_scenes:
                        scene_desc = (
                            f". Set the scene in the environment shown in {scene_tag_str} — "
                            f"use the exact background, lighting, color palette, and atmosphere "
                            f"from the scenery reference images. "
                            f"Cinematic quality, vivid colors, dynamic lighting that matches the beat"
                        )
                        prompt = f"{base_motion}{scene_desc}. {prompt}".strip()
                    else:
                        prompt = f"{base_motion}. {prompt}".strip()
                elif connected_scenes and scene_tag_str:
                    # User already has transform/replace in prompt, just append scenery
                    prompt = (
                        f"{prompt}. Set the scene using the background from {scene_tag_str}, "
                        f"cinematic lighting, vivid colors, atmospheric depth"
                    ).strip()
        
        # Default mode: components if we have reference edges, otherwise start_image if start_refs, otherwise text_to_video
        # Determine provider
        engine = data.get("engine") or "flow"
        provider = "video"
        if engine == "grok":
            provider = "grok"
        elif engine == "meta":
            provider = "meta"

        has_ref_conn = len(connected_references) > 0 or len(connected_scenes) > 0
        mode = data.get("mode") or ("components" if (has_ref_conn or has_motion) else "start_image" if start_refs else "text_to_video")
        custom_prefix = _build_custom_filename_prefix(data, project_id)
        user_aspect = data.get("aspect_ratio") or data.get("aspectRatio")
        chosen_aspect = user_aspect or motion_aspect or "16:9"
        params: dict[str, Any] = {
            "model": data.get("model") or (
                "veo_31_fast" if engine == "flow" else
                "grok-3" if engine == "grok" else
                "meta-video"
            ),
            "aspect_ratio": chosen_aspect,
            "mode": mode,
            "save_mode": "flat",
            "output_folder": vid_folder,
            "resolution": data.get("resolution") or "720p",
            "negative_prompt": data.get("negativePrompt") or data.get("negative_prompt"),
            "custom_prefix": custom_prefix,
            "motion_video": motion_video,
        }
        clip_dur = data.get("clipDuration") or data.get("duration") or data.get("studioDuration")
        if clip_dur:
            try:
                params["duration"] = int(clip_dur)
            except Exception:
                pass
        if data.get("count") or data.get("concurrency"):
            try:
                params["count"] = int(data.get("count") or data.get("concurrency"))
            except Exception:
                pass
        if run_id:
            params["workflow_run_id"] = run_id
        params["workflow_node_id"] = nid
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

        # Override mode for Grok and Meta to match their API expectations (t2v / i2v)
        if provider in {"grok", "meta"}:
            params["mode"] = "i2v" if (ref_list or has_ref_conn) else "t2v"
        
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

        # Collect studio character assets defined inside the node's custom settings
        studio_chars = data.get("characterAssets") or []
        for char in studio_chars:
            char_name = char.get("name", "").lstrip("@").strip()
            char_url = char.get("url")
            if char_name and char_url:
                try:
                    data_url = await _url_to_data_url(char_url)
                    active_named_refs = [r for r in active_named_refs if r.get("name") != char_name]
                    active_named_refs.append({
                        "name": char_name,
                        "data": data_url
                    })
                except Exception as e:
                    logger.error("Failed to convert studio reference %s to data URL: %s", char_name, e)

        # Inject connected scenery/background reference images as named_references
        for scene in connected_scenes:
            try:
                data_url = await _url_to_data_url(scene["url"])
                active_named_refs = [r for r in active_named_refs if r.get("name") != scene["name"]]
                active_named_refs.append({
                    "name": scene["name"],
                    "data": data_url
                })
                logger.info("Injected scenery reference: @%s", scene["name"])
            except Exception as e:
                logger.error("Failed to convert scene reference %s to data URL: %s", scene["name"], e)

        if connected_scenes:
            logger.info("Total named references (characters + scenes): %d", len(active_named_refs))

        params["named_references"] = active_named_refs

        # ── Multi-segment Motion Transfer ──────────────────────────────────
        # Google Flow only processes the first 8 seconds of a motion video.
        # If the source video is longer, we split it into 8-second chunks,
        # generate each chunk separately, concatenate the results, and then
        # remux the original audio onto the final video.
        # Segment duration configured by user (4s, 6s, 8s, 10s; default 8s)
        chosen_clip_dur = int(data.get("clipDuration") or 8)
        SEGMENT_DURATION = max(4, min(chosen_clip_dur, 10))

        def _resolve_motion_to_file(mv: str):
            """Resolve motion_video (data URL, HTTP URL, or relative path) to a real file on disk.
            If it's a data URL, decode and save to temp dir. Returns (Path, is_temp_file)."""
            from pathlib import Path as _P
            import tempfile as _tf

            mv_str = str(mv)

            # data:video/mp4;base64,...
            if mv_str.startswith("data:"):
                import re as _re, base64 as _b64
                m = _re.match(r"data:([^;]+);base64,(.*)", mv_str, _re.DOTALL)
                if m:
                    tmp = settings.data_dir / "temp" / f"motion_materialized_{secrets.token_hex(6)}.mp4"
                    tmp.parent.mkdir(parents=True, exist_ok=True)
                    tmp.write_bytes(_b64.b64decode(m.group(2)))
                    return tmp, True
                return None, False

            # http://127.0.0.1:8765/api/files/...
            if mv_str.startswith("http://") or mv_str.startswith("https://"):
                if "/api/files/" in mv_str:
                    rel = unquote(mv_str.split("/api/files/", 1)[1].split("?", 1)[0])
                    p = resolve_data_file(rel)
                    return (p, False) if p.is_file() else (None, False)
                return None, False

            # relative path
            try:
                p = resolve_data_file(mv_str)
                return (p, False) if p.is_file() else (None, False)
            except Exception:
                return None, False

        # Materialize motion video to a real file once (needed for duration check & splitting)
        _motion_file_path = None
        _motion_is_temp = False
        if has_motion and motion_video:
            _motion_file_path, _motion_is_temp = _resolve_motion_to_file(str(motion_video))
            if _motion_file_path:
                logger.info("Motion video materialized to: %s (temp=%s, size=%d)",
                            _motion_file_path.name, _motion_is_temp, _motion_file_path.stat().st_size)

        # ── INSPIRE MODE: extract key frames as reference images instead of sending video ──
        # Google EditVideo endpoint always transforms the source video. For "inspire" mode
        # we want a NEW video, so we extract representative frames from the reference video,
        # use them as start_image / reference, and generate via text_to_video or start_image endpoint.
        _inspire_mode = (data.get("motionMode") or "transform") == "inspire"
        if _inspire_mode and _motion_file_path and _motion_file_path.is_file():
            logger.info("Inspire mode: extracting key frames from video instead of EditVideo")
            if run_id:
                update_node_progress(run_id, nid, 10, "✨ Trích ảnh từ video mẫu để lấy cảm hứng...")
            try:
                import subprocess as _sp
                import base64 as _b64
                from pathlib import Path as _InspP

                # Extract first frame as start_image
                frame_tmp = settings.data_dir / "temp" / f"inspire_frame_{secrets.token_hex(6)}.png"
                frame_tmp.parent.mkdir(parents=True, exist_ok=True)
                _sp.run(
                    ["ffmpeg", "-y", "-i", str(_motion_file_path), "-vf",
                     "select=eq(n\\,0)", "-frames:v", "1", "-q:v", "2", str(frame_tmp)],
                    stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, check=True, timeout=30,
                )
                if frame_tmp.is_file() and frame_tmp.stat().st_size > 100:
                    frame_data_url = f"data:image/png;base64,{_b64.b64encode(frame_tmp.read_bytes()).decode('ascii')}"
                    # Add as start_image reference
                    if not start_refs:
                        start_refs = [frame_data_url]
                    else:
                        start_refs.insert(0, frame_data_url)
                    logger.info("Inspire: extracted first frame as start_image (%.1f KB)", frame_tmp.stat().st_size / 1024)
                    frame_tmp.unlink(missing_ok=True)

                # Extract a mid-frame as additional style reference
                mid_frame_tmp = settings.data_dir / "temp" / f"inspire_mid_{secrets.token_hex(6)}.png"
                _sp.run(
                    ["ffmpeg", "-y", "-i", str(_motion_file_path), "-vf",
                     "select=eq(n\\,48)", "-frames:v", "1", "-q:v", "2", str(mid_frame_tmp)],
                    stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, check=True, timeout=30,
                )
                if mid_frame_tmp.is_file() and mid_frame_tmp.stat().st_size > 100:
                    mid_data_url = f"data:image/png;base64,{_b64.b64encode(mid_frame_tmp.read_bytes()).decode('ascii')}"
                    active_named_refs.append({
                        "name": "video_style_ref",
                        "data": mid_data_url,
                    })
                    logger.info("Inspire: extracted mid-frame as style reference")
                    mid_frame_tmp.unlink(missing_ok=True)

            except Exception as exc:
                logger.warning("Inspire frame extraction failed: %s", exc)

            # CRITICAL: clear motion_video so provider does NOT use EditVideo endpoint
            params["motion_video"] = None
            motion_video = None
            has_motion = False
            # Switch mode: use start_image if we got frames, or components if we have character refs
            if start_refs:
                ref_list = []
                for r in start_refs[:1]:
                    if str(r).startswith("data:"):
                        ref_list.append(str(r))
                    else:
                        ref_list.append(await _url_to_data_url(str(r)))
                params["reference_images"] = ref_list
                if has_ref_conn:
                    params["mode"] = "components"
                else:
                    params["mode"] = "start_image"
                logger.info("Inspire: using mode=%s with %d start_refs + %d named_refs",
                            params["mode"], len(ref_list), len(active_named_refs))
            params["named_references"] = active_named_refs

        def _get_motion_duration_from_file(fpath) -> float:
            """Return the duration in seconds of a video file."""
            import subprocess as _sp
            try:
                if not fpath or not fpath.is_file():
                    return 0.0
                out = _sp.check_output(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(fpath)],
                    text=True, timeout=10,
                ).strip()
                return float(out)
            except Exception:
                return 0.0

        def _split_video_segments_from_file(fpath, seg_dur: int) -> list[str]:
            """Split video file into segments of seg_dur seconds, return list of data-relative paths."""
            import subprocess as _sp
            duration = _get_motion_duration_from_file(fpath)
            if duration <= 0:
                return []
            segments: list[str] = []
            start = 0.0
            idx = 0
            while start < duration:
                seg_file = settings.data_dir / "temp" / f"motion_seg_{secrets.token_hex(4)}_{idx:03d}.mp4"
                seg_file.parent.mkdir(parents=True, exist_ok=True)
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(start),
                    "-i", str(fpath),
                    "-t", str(seg_dur),
                    "-c:v", "copy",
                    "-an",  # strip audio for upload
                    str(seg_file),
                ]
                _sp.run(cmd, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, timeout=30)
                if seg_file.is_file() and seg_file.stat().st_size > 100:
                    segments.append(str(seg_file.relative_to(settings.data_dir.resolve())))
                else:
                    break
                start += seg_dur
                idx += 1
            return segments

        def _resolve_url_to_path(url_str: str):
            """Resolve an HTTP or relative URL to an absolute Path."""
            if url_str.startswith("http://") or url_str.startswith("https://"):
                if "/api/files/" in url_str:
                    rel = unquote(url_str.split("/api/files/", 1)[1].split("?", 1)[0])
                    return resolve_data_file(rel)
            return resolve_data_file(url_str)

        def _resolve_custom_audio(inputs_dict: dict, node_data: dict):
            """Resolve custom audio from audio_in input handle or node data.
            Returns a Path to the audio file, or None.
            """
            from pathlib import Path as _P
            audio_inputs = list(inputs_dict.get("audio_in") or inputs_dict.get("audio") or [])
            audio_url = audio_inputs[0] if audio_inputs else node_data.get("custom_audio")
            if not audio_url:
                return None

            audio_str = str(audio_url)

            # data URL → materialize to temp file
            if audio_str.startswith("data:"):
                import re as _re, base64 as _b64
                m = _re.match(r"data:([^;]+);base64,(.*)", audio_str, _re.DOTALL)
                if m:
                    ext = ".mp3" if "mp3" in m.group(1) else ".m4a" if "m4a" in m.group(1) else ".wav" if "wav" in m.group(1) else ".mp3"
                    tmp = settings.data_dir / "temp" / f"audio_{secrets.token_hex(6)}{ext}"
                    tmp.parent.mkdir(parents=True, exist_ok=True)
                    tmp.write_bytes(_b64.b64decode(m.group(2)))
                    logger.info("Materialized custom audio to: %s (%.1f KB)", tmp.name, tmp.stat().st_size / 1024)
                    return tmp
                return None

            # HTTP URL → resolve to path
            try:
                p = _resolve_url_to_path(audio_str)
                if p.is_file():
                    logger.info("Custom audio resolved to: %s", p.name)
                    return p
            except Exception:
                pass
            return None

        def _apply_speed_filter(video_path, node_data: dict):
            """Apply speed adjustment (slow-mo / fast-forward) via ffmpeg setpts filter.
            Returns the new path (or original if no speed change).
            """
            import subprocess as _sp
            from pathlib import Path as _P

            speed_id = node_data.get("movementSpeed") or "normal"
            SPEED_FACTORS = {
                "slowmo": 4.0,    # 0.25x speed → setpts=4*PTS
                "slow": 2.0,      # 0.5x speed → setpts=2*PTS
                "normal": 1.0,    # 1x (no change)
                "fast": 0.5,      # 2x speed → setpts=0.5*PTS
                "timelapse": 0.25, # 4x speed → setpts=0.25*PTS
            }
            factor = SPEED_FACTORS.get(speed_id, 1.0)
            if factor == 1.0:
                return video_path

            logger.info("Applying speed filter: %s (factor=%.2f) to %s", speed_id, factor, video_path.name)
            speed_output = video_path.with_name(f"{video_path.stem}_speed{video_path.suffix}")

            # Build filter: setpts for video, atempo for audio
            vf = f"setpts={factor}*PTS"

            # Probe for audio stream
            probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(video_path)]
            probe_res = _sp.run(probe_cmd, capture_output=True, text=True, timeout=10)
            has_audio_stream = "audio" in (probe_res.stdout or "")

            cmd = [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-filter:v", vf,
            ]
            if has_audio_stream:
                # atempo only accepts 0.5-2.0 range, chain if needed
                audio_filter_parts: list[str] = []
                remaining = 1.0 / factor  # atempo is inverse of video PTS factor
                while remaining > 2.0:
                    audio_filter_parts.append("atempo=2.0")
                    remaining /= 2.0
                while remaining < 0.5:
                    audio_filter_parts.append("atempo=0.5")
                    remaining *= 2.0
                audio_filter_parts.append(f"atempo={remaining:.4f}")
                af = ",".join(audio_filter_parts)
                cmd.extend(["-filter:a", af, "-c:a", "aac", "-b:a", "192k"])
            else:
                cmd.append("-an")

            cmd.extend(["-c:v", "libx264", "-preset", "fast", "-crf", "18", str(speed_output)])
            res = _sp.run(cmd, capture_output=True, text=True, timeout=300)
            if res.returncode == 0 and speed_output.is_file() and speed_output.stat().st_size > 100:
                speed_output.replace(video_path)
                logger.info("✅ Applied %s speed to %s", speed_id, video_path.name)
                return video_path
            else:
                logger.warning("Speed filter failed (rc=%d): %s", res.returncode, res.stderr[:300] if res.stderr else "")
                if speed_output.is_file():
                    speed_output.unlink(missing_ok=True)
                return video_path

        if _motion_file_path:
            motion_duration = _get_motion_duration_from_file(_motion_file_path)
            logger.info("Motion video duration: %.1fs", motion_duration)
        else:
            motion_duration = 0.0

        def _normalize_segments_for_concat(seg_paths: list) -> list:
            """Re-encode segments to identical resolution, fps, and pixel format for seamless concat.
            Returns list of normalized file paths (may be same or new temp files)."""
            import subprocess as _sp_norm
            if len(seg_paths) <= 1:
                return list(seg_paths)
            # Probe first segment to get target resolution
            target_w, target_h, target_fps = 0, 0, 24
            try:
                probe_out = _sp_norm.check_output(
                    ["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries", "stream=width,height,r_frame_rate",
                     "-of", "csv=p=0", str(seg_paths[0])],
                    text=True, timeout=10,
                ).strip()
                parts = probe_out.split(",")
                if len(parts) >= 2:
                    target_w, target_h = int(parts[0]), int(parts[1])
                if len(parts) >= 3 and "/" in parts[2]:
                    num, den = parts[2].split("/")
                    target_fps = round(int(num) / max(int(den), 1))
            except Exception:
                pass
            if target_w == 0 or target_h == 0:
                return list(seg_paths)  # Can't probe, skip normalization

            logger.info("Normalizing %d segments to %dx%d @ %dfps", len(seg_paths), target_w, target_h, target_fps)
            normalized: list = []
            for sp in seg_paths:
                norm_out = sp.with_name(f"{sp.stem}_norm{sp.suffix}")
                cmd = [
                    "ffmpeg", "-y", "-i", str(sp),
                    "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2,fps={target_fps}",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-an",
                    str(norm_out),
                ]
                result = _sp_norm.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode == 0 and norm_out.is_file() and norm_out.stat().st_size > 100:
                    normalized.append(norm_out)
                else:
                    logger.warning("Normalize failed for %s, using original", sp.name)
                    normalized.append(sp)
            return normalized

        if has_motion and motion_video and motion_duration > SEGMENT_DURATION + 0.5:
            # ── LONG VIDEO: split → process each segment → concatenate ──
            num_segments = int(motion_duration / SEGMENT_DURATION) + (1 if motion_duration % SEGMENT_DURATION > 0.5 else 0)
            logger.info("Motion video %.1fs > %ds → splitting into %d segments", motion_duration, SEGMENT_DURATION, num_segments)
            if run_id:
                update_node_progress(run_id, nid, 15, f"Video mẫu dài {motion_duration:.0f}s → chia thành {num_segments} đoạn để xử lý...")

            segments = _split_video_segments_from_file(_motion_file_path, SEGMENT_DURATION)
            if not segments:
                raise ValueError("Không thể chia Video mẫu thành từng đoạn")

            logger.info("Split motion video into %d segments: %s", len(segments), [s.split("/")[-1] for s in segments])

            generated_segment_paths: list[Path] = []
            import subprocess
            from pathlib import Path
            prev_end_frame_data_url: str | None = None

            for seg_idx, seg_path in enumerate(segments):
                seg_prefix = f"{custom_prefix}_seg{seg_idx + 1}" if custom_prefix else f"seg{seg_idx + 1}_{secrets.token_hex(4)}"
                seg_named_refs = list(active_named_refs)
                seg_prompt = prompt

                # ── Continuity: inject end frame from previous segment ──
                seg_extra_refs: list[str] = []
                if prev_end_frame_data_url:
                    # 1. Add as named reference for @tag matching
                    seg_named_refs.append({
                        "name": "prior_scene_frame",
                        "data": prev_end_frame_data_url,
                    })
                    # 2. Also add as start_image reference so API uses it as visual anchor
                    seg_extra_refs.append(prev_end_frame_data_url)
                    # 3. Enhance prompt with continuity instruction
                    seg_prompt = (
                        f"{prompt}. "
                        f"IMPORTANT: This is a continuation — seamlessly continue from the exact scene, "
                        f"pose, position, and visual state shown in @prior_scene_frame. "
                        f"Maintain the same character appearance, clothing, lighting, camera angle, "
                        f"and background. The transition must be invisible and perfectly smooth."
                    )
                    logger.info("Segment %d: injecting continuity frame + prompt enhancement", seg_idx + 1)

                seg_params = {
                    **params,
                    "motion_video": seg_path,
                    "custom_prefix": seg_prefix,
                    "named_references": seg_named_refs,
                }
                # Inject end frame as additional reference_images for visual continuity
                if seg_extra_refs:
                    existing_refs = list(seg_params.get("reference_images") or [])
                    seg_params["reference_images"] = seg_extra_refs + existing_refs

                seg_label = f"đoạn {seg_idx + 1}/{len(segments)}"
                pct = 20 + int(60 * seg_idx / len(segments))
                if run_id:
                    update_node_progress(run_id, nid, pct, f"🎬 Đang tạo {seg_label}...")
                logger.info("Processing segment %d/%d (prefix=%s): %s", seg_idx + 1, len(segments), seg_prefix, seg_path.split("/")[-1])

                seg_out = await handle_batch_item(seg_prompt, provider, seg_params)
                seg_urls = seg_out["urls"]

                if seg_urls:
                    try:
                        p = _resolve_url_to_path(seg_urls[0])
                        if p.is_file():
                            generated_segment_paths.append(p)
                            logger.info("Segment %d generated: %s (%.1f KB)", seg_idx + 1, p.name, p.stat().st_size / 1024)
                            # Extract end frame of this segment to preserve continuity in the next segment
                            try:
                                end_frame_tmp = p.with_name(f"{p.stem}_endframe.png")
                                subprocess.run(
                                    ["ffmpeg", "-y", "-sseof", "-0.1", "-i", str(p),
                                     "-frames:v", "1", "-q:v", "2", str(end_frame_tmp)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    check=True, timeout=15,
                                )
                                if end_frame_tmp.is_file() and end_frame_tmp.stat().st_size > 100:
                                    f_bytes = end_frame_tmp.read_bytes()
                                    prev_end_frame_data_url = f"data:image/png;base64,{base64.b64encode(f_bytes).decode('ascii')}"
                                    logger.info("✅ Extracted end frame from segment %d for continuity (%.1f KB)", seg_idx + 1, len(f_bytes) / 1024)
                                    end_frame_tmp.unlink(missing_ok=True)
                                else:
                                    logger.warning("End frame extraction produced empty file for segment %d", seg_idx + 1)
                            except Exception as e_fe:
                                logger.warning("Failed to extract end frame of segment %d: %s", seg_idx + 1, e_fe)
                    except Exception as e:
                        logger.warning("Failed to resolve segment %d output: %s", seg_idx + 1, e)

                # Clean up segment temp file
                try:
                    seg_full = resolve_data_file(seg_path)
                    seg_full.unlink(missing_ok=True)
                except Exception:
                    pass

            if not generated_segment_paths:
                raise ValueError("Không tạo được đoạn video nào")

            if run_id:
                update_node_progress(run_id, nid, 85, f"🔗 Đang ghép {len(generated_segment_paths)} đoạn video lại...")

            # ── Concatenate all segments (with optional transitions) ──
            transition_type = data.get("transition") or "none"
            # Auto-apply crossfade for multi-segment to hide visual discontinuities
            if transition_type == "none" and len(generated_segment_paths) >= 2:
                transition_type = "crossfade"
                logger.info("Auto-applying crossfade transition for %d segments (smoother joins)", len(generated_segment_paths))
            concat_list_file = settings.data_dir / "temp" / f"concat_{secrets.token_hex(4)}.txt"
            concat_list_file.parent.mkdir(parents=True, exist_ok=True)

            # Final concatenated output path
            final_output = generated_segment_paths[0].with_name(
                f"{custom_prefix or secrets.token_hex(4)}_full.mp4"
            )
            raw_concat_output = generated_segment_paths[0].with_name(
                f"{custom_prefix or secrets.token_hex(4)}_concat_raw.mp4"
            )

            if transition_type != "none" and len(generated_segment_paths) >= 2:
                # Use xfade filter for transitions between segments
                XFADE_DURATION = 0.5  # seconds of overlap
                XFADE_MAP = {
                    "crossfade": "fade", "fade_black": "fadeblack", "fade_white": "fadewhite",
                    "wipe_left": "wipeleft", "wipe_right": "wiperight",
                    "slide_up": "slideup", "zoom_in": "smoothup",
                }
                xfade_name = XFADE_MAP.get(transition_type, "fade")
                logger.info("Applying %s transition between %d segments", xfade_name, len(generated_segment_paths))

                # Build filter_complex chain for N segments
                inputs_args: list[str] = []
                for sp in generated_segment_paths:
                    inputs_args.extend(["-i", str(sp.resolve())])

                # Chain xfade filters: [0][1]xfade -> [v01], [v01][2]xfade -> [v012], etc.
                filter_parts: list[str] = []
                # Get each segment duration via ffprobe
                seg_durations: list[float] = []
                for sp in generated_segment_paths:
                    dur = _get_motion_duration_from_file(sp)
                    seg_durations.append(dur if dur > 0 else 8.0)

                # Safety: skip xfade if any segment is shorter than xfade duration
                min_seg = min(seg_durations) if seg_durations else 0
                can_xfade = min_seg >= XFADE_DURATION + 0.1
                if not can_xfade:
                    logger.warning("Segment too short (%.1fs < %.1fs) for xfade, falling back to simple concat", min_seg, XFADE_DURATION)

                if can_xfade:
                    prev_label = "[0:v]"
                    cumulative_offset = 0.0
                    for i in range(1, len(generated_segment_paths)):
                        cumulative_offset += seg_durations[i - 1] - XFADE_DURATION
                        out_label = f"[v{i}]"
                        filter_parts.append(
                            f"{prev_label}[{i}:v]xfade=transition={xfade_name}:duration={XFADE_DURATION}:offset={cumulative_offset:.3f}{out_label}"
                        )
                        prev_label = out_label

                    filter_complex = ";".join(filter_parts)
                    xfade_cmd = [
                        "ffmpeg", "-y",
                        *inputs_args,
                        "-filter_complex", filter_complex,
                        "-map", prev_label,
                        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
                        "-an",
                        str(raw_concat_output),
                    ]
                    res = subprocess.run(xfade_cmd, capture_output=True, text=True, timeout=300)
                    if res.returncode != 0:
                        logger.warning("xfade transition failed, falling back to simple concat: %s", res.stderr[:300] if res.stderr else "")
                        can_xfade = False  # trigger fallback below
                    else:
                        logger.info("✅ Applied %s transition between segments", xfade_name)

                if not can_xfade:
                    # Fallback: normalize + simple concat
                    norm_paths = _normalize_segments_for_concat(generated_segment_paths)
                    with open(concat_list_file, "w") as f:
                        for sp in norm_paths:
                            f.write(f"file '{sp.resolve().as_posix()}'\n")
                    concat_cmd = [
                        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list_file),
                        "-c", "copy", "-an",
                        str(raw_concat_output),
                    ]
                    res = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=180)
                    concat_list_file.unlink(missing_ok=True)
                    # Clean up normalized temp files
                    for np in norm_paths:
                        if np not in generated_segment_paths:
                            np.unlink(missing_ok=True)
            else:
                # Simple concat (no transitions) — normalize first
                norm_paths = _normalize_segments_for_concat(generated_segment_paths)
                with open(concat_list_file, "w") as f:
                    for sp in norm_paths:
                        f.write(f"file '{sp.resolve().as_posix()}'\n")
                concat_cmd = [
                    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list_file),
                    "-c", "copy", "-an",
                    str(raw_concat_output),
                ]
                res = subprocess.run(concat_cmd, capture_output=True, text=True, timeout=180)
                concat_list_file.unlink(missing_ok=True)
                for np in norm_paths:
                    if np not in generated_segment_paths:
                        np.unlink(missing_ok=True)

            if res.returncode != 0 or not raw_concat_output.is_file():
                logger.error("Concat failed (rc=%d): %s", res.returncode, res.stderr[:500] if res.stderr else "")
                raise ValueError("Ghép video thất bại")

            logger.info("Concatenated %d segments → %s (%.1f KB)", len(generated_segment_paths), raw_concat_output.name, raw_concat_output.stat().st_size / 1024)

            # ── Resolve audio source: custom audio > motion video audio ──
            audio_source_path = _resolve_custom_audio(inputs, data)
            if not audio_source_path:
                audio_source_path = _motion_file_path  # fallback to motion video audio

            # ── Remux audio onto concatenated video ──
            if run_id:
                update_node_progress(run_id, nid, 90, "🎵 Đang ghép nhạc vào video...")

            if audio_source_path and audio_source_path.is_file():
                probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "a",
                             "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                             str(audio_source_path)]
                probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                has_audio = "audio" in (probe_res.stdout or "")

                if has_audio:
                    remux_cmd = [
                        "ffmpeg", "-y",
                        "-i", str(raw_concat_output),
                        "-i", str(audio_source_path),
                        "-map", "0:v:0",
                        "-map", "1:a:0",
                        "-c:v", "copy",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-shortest",
                        str(final_output),
                    ]
                    res = subprocess.run(remux_cmd, capture_output=True, text=True, timeout=120)
                    if res.returncode == 0 and final_output.is_file() and final_output.stat().st_size > 100:
                        logger.info("✅ Remuxed audio onto final video %s", final_output.name)
                        raw_concat_output.unlink(missing_ok=True)
                    else:
                        logger.warning("Audio remux failed: %s", res.stderr[:300] if res.stderr else "")
                        raw_concat_output.replace(final_output)
                else:
                    raw_concat_output.replace(final_output)
            else:
                raw_concat_output.replace(final_output)

            # ── Apply speed adjustment ──
            final_output = _apply_speed_filter(final_output, data)

            # Copy to central dir
            from app.services.output_storage import copy_to_central_dir
            copy_to_central_dir(final_output, "workflow", "video")

            # Clean up individual segment files (keep the final)
            for sp in generated_segment_paths:
                if sp != final_output:
                    try:
                        sp.unlink(missing_ok=True)
                        sp.with_suffix(".meta.json").unlink(missing_ok=True)
                    except Exception:
                        pass

            urls = [file_url_from_path(final_output)]

        else:
            # ── NORMAL / SHORT VIDEO (≤8s): single generation ──
            out = await handle_batch_item(prompt, provider, params)
            urls = out["urls"]

            # Resolve audio source: custom audio > motion video audio
            audio_source_path = _resolve_custom_audio(inputs, data)
            if not audio_source_path and has_motion and _motion_file_path and _motion_file_path.is_file():
                audio_source_path = _motion_file_path

            # Remux audio for short videos
            if audio_source_path and audio_source_path.is_file() and urls:
                try:
                    import subprocess
                    from pathlib import Path

                    probe_cmd = ["ffprobe", "-v", "error", "-select_streams", "a",
                                 "-show_entries", "stream=codec_type", "-of", "csv=p=0",
                                 str(audio_source_path)]
                    probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
                    has_orig_audio = "audio" in (probe_res.stdout or "")

                    if has_orig_audio:
                        for vurl_str in urls:
                            try:
                                gen_path = _resolve_url_to_path(vurl_str)
                            except Exception:
                                continue
                            if gen_path and gen_path.is_file():
                                tmp_out = gen_path.with_name(f"{gen_path.stem}_remux{gen_path.suffix}")
                                cmd = [
                                    "ffmpeg", "-y",
                                    "-i", str(gen_path),
                                    "-i", str(audio_source_path),
                                    "-map", "0:v:0",
                                    "-map", "1:a:0",
                                    "-c:v", "copy",
                                    "-c:a", "aac",
                                    "-b:a", "192k",
                                    "-shortest",
                                    str(tmp_out),
                                ]
                                logger.info("Remuxing audio from %s onto %s", audio_source_path.name, gen_path.name)
                                res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                                if res.returncode == 0 and tmp_out.is_file() and tmp_out.stat().st_size > 100:
                                    tmp_out.replace(gen_path)
                                    logger.info("✅ Merged audio onto %s", gen_path.name)
                                    central = settings.data_dir / "workflow" / "video" / gen_path.name
                                    if central.is_file() and central != gen_path:
                                        import shutil
                                        shutil.copy2(str(gen_path), str(central))
                                else:
                                    logger.warning("Audio remux failed (rc=%s): %s", res.returncode, res.stderr[:500] if res.stderr else "")
                                    if tmp_out.is_file():
                                        tmp_out.unlink(missing_ok=True)
                except Exception as e_audio:
                    logger.warning("Failed to remux audio: %s", e_audio, exc_info=True)

            # ── Apply speed adjustment to short videos ──
            if urls:
                for i, vurl_str in enumerate(urls):
                    try:
                        gen_path = _resolve_url_to_path(vurl_str)
                        if gen_path and gen_path.is_file():
                            new_path = _apply_speed_filter(gen_path, data)
                            if new_path != gen_path:
                                urls[i] = file_url_from_path(new_path)
                    except Exception:
                        pass

        # Cleanup temp materialized motion file
        if _motion_is_temp and _motion_file_path:
            try:
                _motion_file_path.unlink(missing_ok=True)
            except Exception:
                pass

        outputs[nid]["video"] = urls
        return {
            "status": "completed",
            "type": ntype,
            "results": urls,
            "folder": out.get("folder") if "out" in dir() else None,
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
        frames = await extract_frames(vpath, positions=list(positions), output_dir=frame_out)
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

    async with _runs_lock:
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
            from app.core.progress import emit_workflow_log
            emit_workflow_log(run.get("run_id", ""), msg, data=run.get("progress"))
        except Exception:
            pass

    running_tasks: dict[str, asyncio.Task] = {}
    try:
        # Cycle detection validation (C6)
        try:
            _topo_order(nodes, edges)
        except ValueError as exc:
            run["status"] = "failed"
            run["error"] = str(exc)
            log(f"Lỗi khởi chạy: {exc}")
            raise

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
                    elif ntype in {"prompt", "reference", "video_reference", "audio_source"}:
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
                try:
                    from app.core.progress import emit_task_progress
                    p = run.get("progress", {})
                    total = max(p.get("total", 1), 1)
                    pct = int(p.get("done", 0) / total * 100)
                    emit_task_progress(run["run_id"], f"Node {nid} hoàn thành", percent=pct, task_type="workflow")
                except Exception:
                    pass

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
            m = re.search(r"(\d+(?:\.\d+)?)", title)
            num = float(m.group(1)) if m else float('inf')
            
            pos = node_item.get("position") or {}
            y = float(pos.get("y") or 0.0)
            x = float(pos.get("x") or 0.0)
            return (num, y, x)

        # Nodes ready to execute (0 active parents)
        ready_queue = [nid for nid in ids if nid not in completed_nodes and active_parent_count.get(nid, 0) == 0]
        running_tasks.clear()
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
                        workflow=workflow,
                        run_id=rid
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
                    try:
                        from app.core.progress import emit_task_progress
                        p = run.get("progress", {})
                        total = max(p.get("total", 1), 1)
                        pct = int(p.get("done", 0) / total * 100)
                        emit_task_progress(run["run_id"], f"Node {finished_nid} hoàn thành", percent=pct, task_type="workflow")
                    except Exception:
                        pass
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
                    # Build detailed context for the error
                    prompt_preview = ""
                    model_info = ""
                    if isinstance(data, dict):
                        p = data.get("prompt") or data.get("prompts") or ""
                        if isinstance(p, list):
                            p = p[0] if p else ""
                        prompt_preview = str(p)[:120]
                        m = data.get("model") or data.get("model_image") or data.get("model_video") or ""
                        if m:
                            model_info = f", model={m}"
                        ar = data.get("aspect_ratio") or ""
                        if ar:
                            model_info += f", ratio={ar}"

                    error_detail = str(exc)
                    context_parts = [f"Node {finished_nid} ({ntype})"]
                    if prompt_preview:
                        context_parts.append(f"prompt=\"{prompt_preview}...\"" if len(str(data.get("prompt", ""))) > 120 else f"prompt=\"{prompt_preview}\"")
                    if model_info:
                        context_parts.append(model_info.lstrip(", "))

                    log(f"Node {finished_nid} FAILED: {exc}")
                    run["node_results"][finished_nid] = {
                        "status": "failed",
                        "type": ntype,
                        "error": error_detail,
                        "prompt": prompt_preview,
                    }
                    failed_node_error = f"{' | '.join(context_parts)}\n{error_detail}"
                    run["status"] = "failed"
                    run["error"] = failed_node_error
                    run["finished_at"] = time.time()
                    break

        if failed_node_error:
            run["progress"]["current"] = None
            return run

        run["status"] = "completed"
        run["finished_at"] = time.time()
        run["progress"]["current"] = None
        log("Workflow completed (Parallel)")

    except Exception as exc:
        logger.exception("Workflow run failed")
        run["status"] = "failed"
        run["error"] = str(exc)
        run["finished_at"] = time.time()
        run["progress"]["current"] = None
    finally:
        # Mark uncompleted nodes as failed if the run is failing (C7)
        if run.get("status") == "failed":
            for unfinished_id in ids:
                if unfinished_id not in completed_nodes and unfinished_id not in run.get("node_results", {}):
                    node = nmap.get(unfinished_id)
                    ntype = str(node.get("type") or "") if node else "unknown"
                    run["node_results"][unfinished_id] = {
                        "status": "failed",
                        "type": ntype,
                        "error": "Skipped or cancelled due to workflow/parent node failure",
                    }
        # Await cancelled/active tasks to prevent resource leaks and warnings
        if running_tasks:
            for t in list(running_tasks.values()):
                if not t.done():
                    t.cancel()
            await asyncio.gather(*running_tasks.values(), return_exceptions=True)
            running_tasks.clear()
        if pid:
            _save_project_results(str(pid), run)
        # Always enforce old run cleanups on run termination
        await _cleanup_runs()

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
    project_name = "Workflow"
    if pid:
        try:
            from app.services import project_store
            p_obj = project_store.get_project(str(pid))
            if p_obj:
                project_name = p_obj.get("name") or project_name
        except Exception:
            pass

    if pid:
        from app.services.project_outputs import project_root

        project_root(str(pid))
    run: dict[str, Any] = {
        "run_id": rid,
        "workflow_id": workflow.get("id"),
        "project_id": pid,
        "project_name": project_name,
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


async def get_active_run_for_project(project_id: str) -> dict[str, Any] | None:
    """Tìm run đang chạy/pending cho project_id trong memory _runs."""
    async with _runs_lock:
        for run in _runs.values():
            if run.get("project_id") == project_id and run.get("status") in {"running", "pending"}:
                return run
    return None


async def get_recent_runs() -> list[dict[str, Any]]:
    """Lấy danh sách các run gần đây, sắp xếp mới nhất lên đầu."""
    async with _runs_lock:
        return sorted(
            list(_runs.values()),
            key=lambda r: r.get("started_at") or 0,
            reverse=True
        )


def _save_project_results(project_id: str, run: dict[str, Any]) -> None:
    """Tự động merge kết quả từ run vào file cấu trúc dự án và lưu lại."""
    from app.services import project_store
    try:
        project = project_store.get_project(project_id)
        if not project:
            return

        nr = run.get("node_results") or {}
        nodes = project.get("nodes") or []
        updated = False

        for node in nodes:
            nid = str(node.get("id"))
            if nid not in nr:
                continue

            raw = nr[nid]
            if not isinstance(raw, dict):
                continue

            status = raw.get("status") or "idle"
            error = raw.get("error")
            reused = bool(raw.get("reused"))
            folder = raw.get("folder")

            # extract urls
            seen = set()
            urls = []
            def push(u):
                if not u or not isinstance(u, str):
                    return
                if u not in seen:
                    seen.add(u)
                    urls.append(u)

            for u in raw.get("results") or []:
                push(u)
            for f in raw.get("frames") or []:
                if isinstance(f, dict) and f.get("url"):
                    push(f["url"])
            if raw.get("image") and raw.get("image") != "(image)":
                push(raw["image"])

            # normalize frames
            frames = []
            for f in raw.get("frames") or []:
                if isinstance(f, dict) and f.get("url"):
                    frames.append({
                        "position": str(f.get("position") or ""),
                        "url": f["url"],
                        "path": f.get("path")
                    })

            data = node.get("data") or {}
            data["runStatus"] = status
            if error:
                data["runError"] = error
            else:
                data.pop("runError", None)
            data["reused"] = reused
            if folder:
                data["folder"] = folder
            if urls:
                data["resultUrls"] = urls
            if frames:
                data["frames"] = frames
            if node.get("type") == "reference" and urls:
                data["image"] = urls[0]

            node["data"] = data
            updated = True

        if updated:
            project_store.save_project(project, project_id)
            logger.info("Auto-saved workflow results to project %s", project_id)
    except Exception as e:
        logger.exception("Failed to auto-save project results: %s", e)

