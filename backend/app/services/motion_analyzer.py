"""Analyze motion from video frames using Gemini / Vision LLM to generate precise motion prompts."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx

from app.core.config import settings
from app.services.ai_settings_store import get_credentials
from app.services.frame_extract import extract_frames, video_duration_sec
from app.services.output_storage import resolve_data_file

logger = logging.getLogger(__name__)

_shared_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient()
    return _shared_client


def _resolve_video_file(video_input: str) -> Path | None:
    """Resolve local path from URL, relative path, or data URL."""
    if not video_input:
        return None
    raw = video_input.strip()

    # Handle data URLs by saving to temp file
    if raw.startswith("data:"):
        try:
            import re as _re
            m = _re.match(r"data:[^;]+;base64,(.*)", raw, _re.DOTALL)
            if m:
                video_bytes = base64.b64decode(m.group(1))
                temp_dir = settings.data_dir / "temp"
                temp_dir.mkdir(parents=True, exist_ok=True)
                import hashlib
                h = hashlib.sha256(video_bytes[:1024]).hexdigest()[:12]
                tmp_file = temp_dir / f"motion_input_{h}.mp4"
                tmp_file.write_bytes(video_bytes)
                return tmp_file
        except Exception as exc:
            logger.warning("Failed to decode data URL video: %s", exc)
            return None

    storage_path = None
    if "/api/files/" in raw:
        storage_path = unquote(raw.split("/api/files/", 1)[1].split("?", 1)[0])
    elif raw.startswith("http://") or raw.startswith("https://"):
        parsed = urlparse(raw)
        if parsed.path.startswith("/api/files/"):
            storage_path = unquote(parsed.path[len("/api/files/") :])
        else:
            return None
    else:
        storage_path = unquote(raw.split("?", 1)[0])

    if not storage_path:
        return None

    try:
        path = resolve_data_file(storage_path)
        if path.is_file():
            return path
    except Exception as exc:
        logger.warning("Failed to resolve video path %s: %s", storage_path, exc)
    return None


async def analyze_motion_from_video(video_input: str, base_prompt: str = "") -> str:
    """Extract sample frames from video and use Gemini Vision to produce an accurate choreography description."""
    video_path = _resolve_video_file(video_input)
    if not video_path:
        logger.warning("Motion analysis: could not resolve local video file for %s", str(video_input)[:80])
        return "dynamic dance choreography and fluid motion matching the reference video"

    # 1. Sample 4-5 key frames across the video duration
    duration = await asyncio.to_thread(video_duration_sec, video_path) or 4.0
    positions = ["start"]
    if duration > 1.5:
        p1 = round(duration * 0.25, 1)
        p2 = round(duration * 0.5, 1)
        p3 = round(duration * 0.75, 1)
        positions.extend([str(p1), str(p2), str(p3)])
    positions.append("end")

    try:
        extracted = await extract_frames(video_path, positions=positions)
    except Exception as exc:
        logger.warning("Frame extraction for motion analysis failed: %s", exc)
        return "dynamic dance choreography and fluid motion matching the reference video"

    if not extracted:
        return "dynamic dance choreography and fluid motion matching the reference video"

    # 2. Build image parts for Vision LLM
    image_parts: list[dict[str, Any]] = []
    for item in extracted:
        p_str = item.get("path")
        if not p_str:
            continue
        p = Path(p_str)
        if p.is_file():
            b64 = base64.b64encode(p.read_bytes()).decode("ascii")
            image_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })

    if not image_parts:
        return "dynamic dance choreography and fluid motion matching the reference video"

    # 3. Call Gemini / AI Vision endpoint
    creds = get_credentials()
    if not creds.get("enabled"):
        logger.info("AI settings disabled, using default motion description")
        return "dynamic dance choreography and fluid motion matching the reference video"

    key = str(creds.get("api_key") or "").strip()
    base = str(creds.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    model = str(creds.get("model") or "gemini").strip()

    if not key:
        return "dynamic dance choreography and fluid motion matching the reference video"

    system_instruction = (
        "You are an expert AI video choreographer and motion director for video generation models (Veo / Omni Flash). "
        "The user provides chronological sequence frames sampled from a dance/action video from beginning to end. "
        "Analyze the exact choreography, body postures, arm/leg movements, dance rhythm, and camera trajectory over time. "
        "Write a concise, vivid English motion generation prompt (max 50 words) describing the character performing this exact choreography in motion. "
        "Return ONLY the motion description text. No markdown, no intro/outro, no quotes."
    )

    user_content: list[dict[str, Any]] = [
        {"type": "text", "text": f"{system_instruction}\nExisting prompt context: {base_prompt}"}
    ]
    user_content.extend(image_parts)

    url = f"{base}/chat/completions"
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": 150,
        "messages": [
            {"role": "user", "content": user_content}
        ],
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    try:
        client = _get_client()
        logger.info("Calling Gemini Vision motion analysis with %d frames to %s (model=%s)", len(image_parts), url, model)
        res = await client.post(url, headers=headers, json=payload, timeout=60.0)
        if res.status_code == 200:
            data = res.json()
            choices = data.get("choices") or []
            if choices and isinstance(choices[0], dict):
                msg = choices[0].get("message", {}).get("content") or ""
                if isinstance(msg, str) and msg.strip():
                    cleaned = msg.strip().strip('"').strip("'").strip()
                    logger.info("Gemini Vision motion analysis result: %s", cleaned)
                    return cleaned
        else:
            logger.warning("Gemini Vision API returned HTTP %s: %s", res.status_code, res.text[:200])
    except Exception as exc:
        logger.warning("Gemini Vision motion analysis request failed: %s", exc)

    return "dynamic dance choreography and fluid motion matching the reference video"
