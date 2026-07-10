"""Simple pipelines: image → video (G-Labs workflow lite)."""

from __future__ import annotations

import base64
import logging
import secrets
import time
from typing import Any

from app.core.config import settings
from app.services.generation import handle_batch_item
from app.services.output_storage import resolve_data_file

logger = logging.getLogger(__name__)

_jobs: dict[str, dict[str, Any]] = {}


def get_pipeline_job(job_id: str) -> dict[str, Any] | None:
    return _jobs.get(job_id)


async def run_image_then_video(
    *,
    prompt: str,
    image_params: dict[str, Any] | None = None,
    video_params: dict[str, Any] | None = None,
    video_prompt: str | None = None,
) -> dict[str, Any]:
    """Generate image, then video using first image as start frame."""
    job_id = secrets.token_hex(5)
    job: dict[str, Any] = {
        "job_id": job_id,
        "type": "image_then_video",
        "status": "running",
        "step": "image",
        "prompt": prompt,
        "created_at": time.time(),
        "finished_at": None,
        "image_urls": [],
        "video_urls": [],
        "image_folder": None,
        "video_folder": None,
        "error": None,
    }
    _jobs[job_id] = job

    try:
        img_params = dict(image_params or {})
        img_params.setdefault("output_folder", "G-Labs BW/image_output")
        img_params.setdefault("save_mode", "task")
        img_out = await handle_batch_item(prompt, "image", img_params)
        job["image_urls"] = img_out["urls"]
        job["image_folder"] = img_out["folder"]
        if not img_out["urls"]:
            raise RuntimeError("Image step produced no results")

        job["step"] = "video"
        first_url = img_out["urls"][0]
        # Load image bytes for reference / start frame
        start_b64 = await _url_to_data_url(first_url)

        v_params = dict(video_params or {})
        v_params.setdefault("model", "veo_31_fast")
        v_params.setdefault("aspect_ratio", "16:9")
        v_params.setdefault("mode", "start_image")
        v_params.setdefault("output_folder", "G-Labs BW/video_output")
        v_params.setdefault("save_mode", "task")
        v_params["reference_images"] = [start_b64]
        v_params["start_image"] = start_b64

        v_prompt = (video_prompt or prompt).strip()
        vid_out = await handle_batch_item(v_prompt, "video", v_params)
        job["video_urls"] = vid_out["urls"]
        job["video_folder"] = vid_out["folder"]
        job["status"] = "completed"
        job["step"] = "done"
        job["finished_at"] = time.time()
    except Exception as exc:
        logger.exception("Pipeline image_then_video failed")
        job["status"] = "failed"
        job["error"] = str(exc)
        job["finished_at"] = time.time()

    return job


async def _url_to_data_url(url: str) -> str:
    """Convert /api/files/... or http URL under data dir to data URL."""
    path_part = url
    if "/api/files/" in url:
        path_part = url.split("/api/files/", 1)[1].split("?", 1)[0]
        # percent-decode light
        from urllib.parse import unquote

        path_part = unquote(path_part)
        file_path = resolve_data_file(path_part)
        data = file_path.read_bytes()
        mime = "image/png"
        if file_path.suffix.lower() in {".jpg", ".jpeg"}:
            mime = "image/jpeg"
        elif file_path.suffix.lower() == ".webp":
            mime = "image/webp"
        b64 = base64.b64encode(data).decode("ascii")
        return f"data:{mime};base64,{b64}"
    if url.startswith("data:"):
        return url
    raise ValueError(f"Cannot load image URL: {url[:80]}")
