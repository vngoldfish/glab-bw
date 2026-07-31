"""Public API v1 — Versioned endpoints for external consumers.

All endpoints require authentication via API key (Bearer token or X-API-Key header).
Rate limiting and daily quotas are enforced per-key.

Usage:
    curl -X POST http://localhost:8765/v1/images/generate \\
         -H "Authorization: Bearer glbw_sk_..." \\
         -H "Content-Type: application/json" \\
         -d '{"prompt": "A cat in space", "provider": "auto"}'
"""

import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import check_rate_limit, verify_public_key
from app.core.rate_limiter import rate_limiter
from app.core.task_queue import TaskStatus, task_queue
from app.services.api_key_store import ApiKeyInfo, api_key_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["Public API v1"])


# ── Request / Response Models ─────────────────────────────────────────────────


class ImageGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000, description="Text prompt for image generation")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok, openai, meta")
    model: str | None = Field(default=None, description="Model name (provider-specific)")
    aspect_ratio: str | None = Field(default=None, description="Aspect ratio, e.g. '16:9', '1:1'")
    num_images: int = Field(default=1, ge=1, le=4, description="Number of images to generate")
    style: str | None = Field(default=None, description="Style hint, e.g. 'photographic', 'artistic'")
    negative_prompt: str | None = Field(default=None, description="What to avoid in the image")
    reference_image: str | None = Field(default=None, description="Reference image URL or path")


class VideoGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000, description="Text prompt for video generation")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok")
    model: str | None = Field(default=None, description="Model name (provider-specific)")
    aspect_ratio: str | None = Field(default=None, description="Aspect ratio")
    duration: int | None = Field(default=None, description="Video duration in seconds")
    reference_image: str | None = Field(default=None, description="Reference/input image for video generation")


class TaskResponse(BaseModel):
    task_id: str
    status: str
    poll_url: str
    result_url: str = ""
    estimated_wait_seconds: int = 30
    message: str = ""
    provider: str = ""
    model: str | None = None
    created_at: float = 0
    request_summary: dict[str, Any] = {}


class TaskResultItem(BaseModel):
    url: str
    type: str = "image/png"
    filename: str = ""
    size_bytes: int | None = None


class TaskResultResponse(BaseModel):
    task_id: str
    status: str
    results: list[TaskResultItem] = []
    error: str | None = None
    error_code: str | None = None
    error_hint: str | None = None
    usage: dict[str, Any] = {}


class ModelInfo(BaseModel):
    provider: str
    name: str
    type: str  # "image" or "video"
    available: bool


class UsageSummary(BaseModel):
    key_id: str
    name: str
    rate_limit: int
    daily_quota: int
    used_today: int
    remaining_today: int
    used_this_minute: int
    remaining_this_minute: int
    history: list[dict] = []


# ── Helper ────────────────────────────────────────────────────────────────────

_PROVIDER_MAP = {
    "flow": "image",
    "grok": "grok",
    "openai": "openai",
    "meta": "meta",
}


def _resolve_provider(provider: str, for_video: bool = False) -> str:
    """Resolve 'auto' to the best available provider."""
    if provider != "auto":
        return provider

    from app.providers.registry import (
        get_flow_provider,
        get_grok_provider,
        get_openai_provider,
    )

    media_type = "video" if for_video else "image"

    # For video, prefer flow then grok
    if for_video:
        if get_flow_provider(for_video=True):
            return "flow"
        if get_grok_provider(for_video=True):
            return "grok"
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"Không có provider nào sẵn sàng để tạo {media_type}",
                "hint": "Vào Settings → Tài khoản → thêm tài khoản Google Flow hoặc Grok (xAI)",
                "available_providers": [],
                "required_for": media_type,
            },
        )

    # For image, prefer flow -> grok -> openai
    if get_flow_provider(for_video=False):
        return "flow"
    if get_grok_provider(for_video=False):
        return "grok"
    if get_openai_provider():
        return "openai"

    raise HTTPException(
        status_code=503,
        detail={
            "error": f"Không có provider nào sẵn sàng để tạo {media_type}",
            "hint": "Vào Settings → Tài khoản → thêm tài khoản Google Flow, Grok (xAI), hoặc OpenAI",
            "available_providers": [],
            "required_for": media_type,
        },
    )


def _map_provider_to_task_type(provider: str) -> str:
    """Map user-facing provider name to internal task_queue type."""
    return _PROVIDER_MAP.get(provider, provider)


def _media_type_from_url(url: str) -> str:
    url_lower = url.lower()
    if url_lower.endswith(".mp4"):
        return "video/mp4"
    if url_lower.endswith(".webp"):
        return "image/webp"
    if url_lower.endswith(".jpg") or url_lower.endswith(".jpeg"):
        return "image/jpeg"
    return "image/png"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/images/generate", status_code=202, response_model=TaskResponse)
async def generate_image(
    body: ImageGenerateRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate images from a text prompt.

    Returns a task ID for polling. Use GET /v1/tasks/{task_id} to check status.
    """
    if "image" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={
            "error": "API key không có quyền tạo ảnh",
            "key_id": key_info.key_id,
            "permissions": key_info.permissions,
            "required": "image",
            "hint": "Tạo API key mới với permission 'image' hoặc cập nhật key hiện tại tại /v1/admin/keys",
        })

    provider = _resolve_provider(body.provider, for_video=False)
    task_type = _map_provider_to_task_type(provider)

    payload: dict[str, Any] = {
        "prompt": body.prompt,
        "provider": provider,
        "num_images": body.num_images,
        "_api_key_id": key_info.key_id,
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.style:
        payload["style"] = body.style
    if body.negative_prompt:
        payload["negative_prompt"] = body.negative_prompt
    if body.reference_image:
        payload["reference_image"] = body.reference_image

    task = task_queue.create_task(task_type, body.prompt, payload)

    # Record usage
    api_key_store.record_usage(
        key_id=key_info.key_id,
        endpoint="/v1/images/generate",
        provider=provider,
        task_type="image",
        status="pending",
        prompt=body.prompt,
        task_id=task.task_id,
    )

    logger.info(
        "Public API image request: key=%s provider=%s model=%s task=%s",
        key_info.key_id, provider, body.model or "default", task.task_id,
    )

    return TaskResponse(
        task_id=task.task_id,
        status="pending",
        poll_url=f"/v1/tasks/{task.task_id}",
        result_url=f"/v1/tasks/{task.task_id}/result",
        estimated_wait_seconds=30,
        provider=provider,
        model=body.model,
        created_at=task.created_at,
        message=f"✅ Đã nhận yêu cầu tạo {body.num_images} ảnh | provider: {provider} | model: {body.model or 'auto'} | ratio: {body.aspect_ratio or 'default'} | prompt: '{body.prompt[:80]}...'",
        request_summary={
            "endpoint": "/v1/images/generate",
            "provider": provider,
            "model": body.model,
            "num_images": body.num_images,
            "aspect_ratio": body.aspect_ratio,
            "prompt_length": len(body.prompt),
            "has_reference": body.reference_image is not None,
            "next_step": f"Poll GET /v1/tasks/{task.task_id} để kiểm tra tiến trình. Khi status='completed', lấy ảnh từ results[].url",
        },
    )


@router.post("/videos/generate", status_code=202, response_model=TaskResponse)
async def generate_video(
    body: VideoGenerateRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate a video from a text prompt.

    Returns a task ID for polling. Use GET /v1/tasks/{task_id} to check status.
    """
    if "video" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": "API key lacks 'video' permission"})

    provider = _resolve_provider(body.provider, for_video=True)

    # Video tasks use different task_type naming
    if provider == "flow":
        task_type = "video"
    elif provider == "grok":
        task_type = "grok"
    else:
        task_type = provider

    payload: dict[str, Any] = {
        "prompt": body.prompt,
        "provider": provider,
        "for_video": True,
        "_api_key_id": key_info.key_id,
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.duration:
        payload["duration"] = body.duration
    if body.reference_image:
        payload["reference_image"] = body.reference_image

    task = task_queue.create_task(task_type, body.prompt, payload)

    api_key_store.record_usage(
        key_id=key_info.key_id,
        endpoint="/v1/videos/generate",
        provider=provider,
        task_type="video",
        status="pending",
        prompt=body.prompt,
        task_id=task.task_id,
    )

    logger.info(
        "Public API video request: key=%s provider=%s task=%s",
        key_info.key_id, provider, task.task_id,
    )

    return TaskResponse(
        task_id=task.task_id,
        status="pending",
        poll_url=f"/v1/tasks/{task.task_id}",
        estimated_wait_seconds=60,
        message=f"Video generation queued (provider: {provider})",
    )


# ── Specialized Generation Endpoints ─────────────────────────────────────────


class ImageToVideoRequest(BaseModel):
    """Generate video from an input image (Image-to-Video / I2V)."""
    prompt: str = Field(..., min_length=1, max_length=2000, description="Motion/action prompt for the video")
    image: str = Field(..., description="Input image: URL path (e.g. /api/files/output/...) or base64 data URI")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok")
    model: str | None = Field(default=None, description="Model name (e.g. veo_2, veo_31_fast)")
    aspect_ratio: str | None = Field(default=None, description="Output aspect ratio")
    duration: int | None = Field(default=None, description="Video duration in seconds")


class StartEndVideoRequest(BaseModel):
    """Generate video with start frame and end frame images (interpolation)."""
    prompt: str = Field(default="", max_length=2000, description="Optional motion prompt between frames")
    start_image: str = Field(..., description="First frame image: URL path or base64 data URI")
    end_image: str = Field(..., description="Last frame image: URL path or base64 data URI")
    provider: str = Field(default="flow", description="Provider (currently only 'flow' supports start+end)")
    model: str | None = Field(default=None, description="Model name")
    aspect_ratio: str | None = Field(default=None)


class ReferenceImageRequest(BaseModel):
    """Generate image using reference/style images."""
    prompt: str = Field(..., min_length=1, max_length=2000, description="Text prompt for generation")
    reference_images: list[str] = Field(..., min_length=1, max_length=4, description="List of reference image URLs/paths or base64 data URIs")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok")
    model: str | None = Field(default=None)
    aspect_ratio: str | None = Field(default=None)
    num_images: int = Field(default=1, ge=1, le=4)
    style: str | None = Field(default=None, description="Style hint")


class ReferenceVideoRequest(BaseModel):
    """Generate video using reference/character images."""
    prompt: str = Field(..., min_length=1, max_length=2000, description="Video prompt")
    reference_images: list[str] = Field(..., min_length=1, max_length=4, description="Reference images for characters/style")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok")
    model: str | None = Field(default=None)
    aspect_ratio: str | None = Field(default=None)
    duration: int | None = Field(default=None)


class UnifiedGenerateRequest(BaseModel):
    """Unified generation endpoint — supports all modes via 'mode' parameter."""
    mode: str = Field(..., description="Generation mode: text_to_image, text_to_video, image_to_video, start_end_video, reference_image, reference_video")
    prompt: str = Field(default="", max_length=2000, description="Text prompt")
    provider: str = Field(default="auto", description="Provider: auto, flow, grok, openai, meta")
    model: str | None = Field(default=None)
    aspect_ratio: str | None = Field(default=None)
    num_images: int = Field(default=1, ge=1, le=4)
    style: str | None = Field(default=None)
    negative_prompt: str | None = Field(default=None)
    duration: int | None = Field(default=None)
    image: str | None = Field(default=None, description="Input image for I2V mode")
    start_image: str | None = Field(default=None, description="Start frame for start_end_video mode")
    end_image: str | None = Field(default=None, description="End frame for start_end_video mode")
    reference_images: list[str] | None = Field(default=None, description="Reference images for reference modes")


def _build_task(
    key_info: ApiKeyInfo,
    endpoint: str,
    provider: str,
    task_type: str,
    prompt: str,
    payload: dict[str, Any],
    for_video: bool = False,
) -> TaskResponse:
    """Shared helper to create task + record usage."""
    payload["_api_key_id"] = key_info.key_id
    task = task_queue.create_task(task_type, prompt, payload)

    media_type = "video" if for_video else "image"
    model = payload.get("model") or "auto"
    ratio = payload.get("aspect_ratio") or "default"
    mode = payload.get("mode") or "standard"

    api_key_store.record_usage(
        key_id=key_info.key_id,
        endpoint=endpoint,
        provider=provider,
        task_type=media_type,
        status="pending",
        prompt=prompt,
        task_id=task.task_id,
    )

    logger.info(
        "Public API %s: key=%s provider=%s model=%s task=%s",
        endpoint, key_info.key_id, provider, model, task.task_id,
    )

    return TaskResponse(
        task_id=task.task_id,
        status="pending",
        poll_url=f"/v1/tasks/{task.task_id}",
        result_url=f"/v1/tasks/{task.task_id}/result",
        estimated_wait_seconds=90 if for_video else 30,
        provider=provider,
        model=payload.get("model"),
        created_at=task.created_at,
        message=f"✅ Đã nhận yêu cầu tạo {media_type} | provider: {provider} | model: {model} | mode: {mode} | ratio: {ratio} | prompt: '{prompt[:60]}...'",
        request_summary={
            "endpoint": endpoint,
            "provider": provider,
            "model": model,
            "mode": mode,
            "aspect_ratio": ratio,
            "media_type": media_type,
            "prompt_length": len(prompt),
            "has_references": bool(payload.get("reference_images")),
            "next_step": f"Poll GET /v1/tasks/{task.task_id} để kiểm tra. Khi status='completed', lấy kết quả từ results[].url",
        },
    )


@router.post("/images/with-references", status_code=202, response_model=TaskResponse)
async def generate_image_with_references(
    body: ReferenceImageRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate images using reference/style images.

    Upload reference images as URLs or base64 data URIs. The AI will use them
    as style/composition guidance for generating the new image.
    """
    if "image" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": "API key lacks 'image' permission"})

    provider = _resolve_provider(body.provider, for_video=False)
    task_type = _map_provider_to_task_type(provider)

    payload: dict[str, Any] = {
        "prompt": body.prompt,
        "provider": provider,
        "num_images": body.num_images,
        "reference_images": body.reference_images,
        "mode": "components",
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.style:
        payload["style"] = body.style

    return _build_task(key_info, "/v1/images/with-references", provider, task_type, body.prompt, payload)


@router.post("/videos/from-image", status_code=202, response_model=TaskResponse)
async def generate_video_from_image(
    body: ImageToVideoRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate video from a single input image (Image-to-Video).

    The input image becomes the starting frame, and the AI animates it
    based on the prompt description.
    """
    if "video" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": "API key lacks 'video' permission"})

    provider = _resolve_provider(body.provider, for_video=True)
    task_type = "video" if provider == "flow" else provider

    payload: dict[str, Any] = {
        "prompt": body.prompt,
        "provider": provider,
        "for_video": True,
        "mode": "start_image",
        "reference_images": [body.image],
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.duration:
        payload["duration"] = body.duration

    return _build_task(key_info, "/v1/videos/from-image", provider, task_type, body.prompt, payload, for_video=True)


@router.post("/videos/start-end", status_code=202, response_model=TaskResponse)
async def generate_video_start_end(
    body: StartEndVideoRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate video with start frame and end frame (keyframe interpolation).

    The AI creates a smooth video transition from the start image to the end image,
    guided by the optional prompt.
    """
    if "video" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": "API key lacks 'video' permission"})

    provider = _resolve_provider(body.provider, for_video=True)
    task_type = "video" if provider == "flow" else provider

    prompt = body.prompt or "Smooth cinematic transition between frames"

    payload: dict[str, Any] = {
        "prompt": prompt,
        "provider": provider,
        "for_video": True,
        "mode": "start_end_image",
        "reference_images": [body.start_image, body.end_image],
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio

    return _build_task(key_info, "/v1/videos/start-end", provider, task_type, prompt, payload, for_video=True)


@router.post("/videos/with-references", status_code=202, response_model=TaskResponse)
async def generate_video_with_references(
    body: ReferenceVideoRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Generate video using reference/character images.

    Use reference images to define characters, objects, or style.
    The AI will incorporate them into the generated video.
    """
    if "video" not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": "API key lacks 'video' permission"})

    provider = _resolve_provider(body.provider, for_video=True)
    task_type = "video" if provider == "flow" else provider

    payload: dict[str, Any] = {
        "prompt": body.prompt,
        "provider": provider,
        "for_video": True,
        "mode": "components",
        "reference_images": body.reference_images,
    }
    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.duration:
        payload["duration"] = body.duration

    return _build_task(key_info, "/v1/videos/with-references", provider, task_type, body.prompt, payload, for_video=True)


@router.post("/generate", status_code=202, response_model=TaskResponse)
async def unified_generate(
    body: UnifiedGenerateRequest,
    key_info: ApiKeyInfo = Depends(verify_public_key),
    _rate: ApiKeyInfo = Depends(check_rate_limit),
):
    """Unified generation endpoint — supports all modes in a single call.

    Modes:
    - `text_to_image`: Generate image from text prompt
    - `text_to_video`: Generate video from text prompt
    - `image_to_video`: Animate an input image (requires `image` field)
    - `start_end_video`: Interpolate between start and end frames (requires `start_image` + `end_image`)
    - `reference_image`: Generate image with style/reference images (requires `reference_images`)
    - `reference_video`: Generate video with character/reference images (requires `reference_images`)
    """
    mode = body.mode.lower().replace("-", "_")
    is_video = mode in ("text_to_video", "image_to_video", "start_end_video", "reference_video")

    required_perm = "video" if is_video else "image"
    if required_perm not in key_info.permissions and "admin" not in key_info.permissions:
        raise HTTPException(status_code=403, detail={"error": f"API key lacks '{required_perm}' permission"})

    provider = _resolve_provider(body.provider, for_video=is_video)
    task_type = _map_provider_to_task_type(provider)
    if is_video and provider == "flow":
        task_type = "video"

    prompt = body.prompt
    payload: dict[str, Any] = {
        "prompt": prompt,
        "provider": provider,
    }

    if mode == "text_to_image":
        payload["num_images"] = body.num_images
        if body.style:
            payload["style"] = body.style
        if body.negative_prompt:
            payload["negative_prompt"] = body.negative_prompt

    elif mode == "text_to_video":
        payload["for_video"] = True
        payload["mode"] = "text_to_video"

    elif mode == "image_to_video":
        if not body.image:
            raise HTTPException(status_code=400, detail={"error": "image_to_video requires 'image' field"})
        payload["for_video"] = True
        payload["mode"] = "start_image"
        payload["reference_images"] = [body.image]

    elif mode == "start_end_video":
        if not body.start_image or not body.end_image:
            raise HTTPException(status_code=400, detail={"error": "start_end_video requires 'start_image' and 'end_image' fields"})
        payload["for_video"] = True
        payload["mode"] = "start_end_image"
        payload["reference_images"] = [body.start_image, body.end_image]
        if not prompt:
            prompt = "Smooth cinematic transition between frames"
            payload["prompt"] = prompt

    elif mode == "reference_image":
        if not body.reference_images:
            raise HTTPException(status_code=400, detail={"error": "reference_image requires 'reference_images' field"})
        payload["reference_images"] = body.reference_images
        payload["mode"] = "components"
        payload["num_images"] = body.num_images

    elif mode == "reference_video":
        if not body.reference_images:
            raise HTTPException(status_code=400, detail={"error": "reference_video requires 'reference_images' field"})
        payload["for_video"] = True
        payload["mode"] = "components"
        payload["reference_images"] = body.reference_images

    else:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Unknown mode: {mode}",
                "valid_modes": [
                    "text_to_image", "text_to_video", "image_to_video",
                    "start_end_video", "reference_image", "reference_video",
                ],
            },
        )

    if body.model:
        payload["model"] = body.model
    if body.aspect_ratio:
        payload["aspect_ratio"] = body.aspect_ratio
    if body.duration and is_video:
        payload["duration"] = body.duration

    return _build_task(key_info, f"/v1/generate/{mode}", provider, task_type, prompt, payload, for_video=is_video)


@router.get("/tasks/{task_id}")
async def get_task(
    task_id: str,
    key_info: ApiKeyInfo = Depends(verify_public_key),
):
    """Check the status of a generation task."""
    task = task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail={
            "error": f"Task '{task_id}' không tồn tại",
            "hint": "Kiểm tra lại task_id. Dùng GET /v1/tasks để xem danh sách tasks.",
            "task_id": task_id,
        })

    elapsed = time.time() - task.created_at
    response: dict[str, Any] = {
        "task_id": task.task_id,
        "type": task.task_type,
        "status": task.status.value,
        "prompt": task.prompt,
        "created_at": task.created_at,
        "elapsed_seconds": int(elapsed),
    }

    if task.status == TaskStatus.COMPLETED:
        results = []
        for url in task.results:
            filename = url.rsplit("/", 1)[-1] if "/" in url else url
            results.append({
                "url": url,
                "type": _media_type_from_url(url),
                "filename": filename,
                "download_url": url,
            })
        response["results"] = results
        response["result_count"] = len(results)
        response["completed_at"] = task.completed_at
        duration = int(task.completed_at - task.created_at) if task.completed_at else None
        response["duration_seconds"] = duration
        response["message"] = f"✅ Hoàn tất! {len(results)} kết quả trong {duration}s. Tải file qua results[].url"

        api_key_store.update_usage_status(task.task_id, "completed")

    elif task.status == TaskStatus.FAILED:
        error_msg = task.error or "Generation failed"
        response["error"] = error_msg
        response["error_detail"] = task.error_detail
        response["completed_at"] = task.completed_at
        # Parse error for user-friendly hint
        hint = "Thử lại với prompt/model/provider khác"
        if "quota" in error_msg.lower() or "429" in error_msg:
            hint = "Hết quota — đợi 1h hoặc đổi account"
        elif "UNAUTHENTICATED" in error_msg or "401" in error_msg:
            hint = "Token hết hạn — vào Settings đăng nhập lại"
        elif "INVALID_ARGUMENT" in error_msg:
            hint = "Tham số sai — đổi model/ratio hoặc kiểm tra ảnh reference"
        elif "UNSAFE" in error_msg:
            hint = "Prompt bị chặn — sửa nội dung prompt"
        elif "PERMISSION_DENIED" in error_msg:
            hint = "Cookie/session hết hạn — dán lại cookie trong Settings"
        response["error_hint"] = hint
        response["message"] = f"❌ Thất bại sau {int(elapsed)}s: {hint}"

        api_key_store.update_usage_status(task.task_id, "failed")

    elif task.status == TaskStatus.RUNNING:
        response["message"] = f"⏳ Đang xử lý... ({int(elapsed)}s đã trôi qua)"

    elif task.status == TaskStatus.PENDING:
        response["message"] = "🕐 Đang chờ trong hàng đợi..."

    return response


@router.get("/tasks/{task_id}/result")
async def get_task_result(
    task_id: str,
    key_info: ApiKeyInfo = Depends(verify_public_key),
):
    """Get the result of a completed task. Returns 202 if still processing."""
    task = task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail={
            "error": f"Task '{task_id}' không tồn tại",
            "hint": "Kiểm tra lại task_id. Dùng GET /v1/tasks để xem danh sách.",
        })

    if task.status in (TaskStatus.PENDING, TaskStatus.RUNNING):
        elapsed = int(time.time() - task.created_at)
        return TaskResultResponse(
            task_id=task.task_id,
            status=task.status.value,
            usage={
                "message": f"⏳ Task đang {'chờ' if task.status == TaskStatus.PENDING else 'xử lý'}... ({elapsed}s). Poll lại sau 5 giây.",
                "elapsed_seconds": elapsed,
                "next_poll": "Gọi lại endpoint này sau 5 giây",
            },
        )

    if task.status == TaskStatus.FAILED:
        error_msg = task.error or "Generation failed"
        hint = "Thử lại với prompt/model/provider khác"
        if "quota" in error_msg.lower():
            hint = "Hết quota — đợi reset hoặc đổi account"
        elif "INVALID_ARGUMENT" in error_msg:
            hint = "Tham số sai — đổi model, ratio, hoặc kiểm tra ảnh"
        return TaskResultResponse(
            task_id=task.task_id,
            status="failed",
            error=error_msg,
            error_hint=hint,
            usage={
                "provider": task.task_type,
                "created_at": task.created_at,
                "failed_at": task.completed_at,
                "duration_seconds": int(task.completed_at - task.created_at) if task.completed_at else None,
            },
        )

    duration = int(task.completed_at - task.created_at) if task.completed_at else None
    results = []
    for url in task.results:
        filename = url.rsplit("/", 1)[-1] if "/" in url else url
        results.append(TaskResultItem(
            url=url,
            type=_media_type_from_url(url),
            filename=filename,
        ))

    return TaskResultResponse(
        task_id=task.task_id,
        status="completed",
        results=results,
        usage={
            "provider": task.task_type,
            "created_at": task.created_at,
            "completed_at": task.completed_at,
            "duration_seconds": duration,
            "result_count": len(results),
            "message": f"✅ {len(results)} kết quả sẵn sàng tải về",
        },
    )


@router.get("/tasks")
async def list_tasks(
    limit: int = 20,
    key_info: ApiKeyInfo = Depends(verify_public_key),
):
    """List recent tasks. Admin keys see all; user keys see only their own."""
    all_tasks = task_queue.list_tasks(limit=100)

    # Filter to only tasks created by this API key (unless admin)
    if "admin" in key_info.permissions or key_info.key_id == "__server__":
        tasks = all_tasks[:limit]
    else:
        tasks = [
            t for t in all_tasks
            if t.payload.get("_api_key_id") == key_info.key_id
        ][:limit]

    return {
        "tasks": [
            {
                "task_id": t.task_id,
                "type": t.task_type,
                "status": t.status.value,
                "prompt": t.prompt[:80],
                "created_at": t.created_at,
                "completed_at": t.completed_at,
            }
            for t in tasks
        ],
        "count": len(tasks),
    }


@router.get("/models")
async def list_models(
    key_info: ApiKeyInfo = Depends(verify_public_key),
):
    """List available AI models and their capabilities."""
    from app.providers.registry import (
        get_flow_provider,
        get_grok_provider,
        get_meta_provider,
        get_openai_provider,
    )

    models: list[dict] = []

    # Flow (Imagen / Veo)
    flow_img = get_flow_provider(for_video=False)
    flow_vid = get_flow_provider(for_video=True)
    models.append({
        "provider": "flow",
        "name": "imagen-3",
        "type": "image",
        "available": flow_img is not None,
        "description": "Google Imagen 3 — high quality photorealistic images",
    })
    models.append({
        "provider": "flow",
        "name": "veo-2",
        "type": "video",
        "available": flow_vid is not None,
        "description": "Google Veo 2 — AI video generation",
    })

    # Grok
    grok_img = get_grok_provider(for_video=False)
    grok_vid = get_grok_provider(for_video=True)
    models.append({
        "provider": "grok",
        "name": "grok-aurora",
        "type": "image",
        "available": grok_img is not None,
        "description": "xAI Grok Aurora — fast image generation",
    })
    models.append({
        "provider": "grok",
        "name": "grok-video",
        "type": "video",
        "available": grok_vid is not None,
        "description": "xAI Grok — video generation",
    })

    # OpenAI
    openai_prov = get_openai_provider()
    models.append({
        "provider": "openai",
        "name": "dall-e-3",
        "type": "image",
        "available": openai_prov is not None,
        "description": "OpenAI DALL-E 3 — creative image generation",
    })

    # Meta
    meta_prov = get_meta_provider()
    models.append({
        "provider": "meta",
        "name": "meta-imagine",
        "type": "image",
        "available": meta_prov is not None,
        "description": "Meta AI — image generation",
    })

    return {"models": models}


@router.get("/usage")
async def get_usage(
    days: int = 30,
    key_info: ApiKeyInfo = Depends(verify_public_key),
):
    """Get API usage statistics for the authenticated key."""
    daily_count = api_key_store.get_daily_count(key_info.key_id)
    minute_count = api_key_store.get_minute_count(key_info.key_id)
    history = api_key_store.get_usage_summary(key_info.key_id, days=days)

    return UsageSummary(
        key_id=key_info.key_id,
        name=key_info.name,
        rate_limit=key_info.rate_limit,
        daily_quota=key_info.daily_quota,
        used_today=daily_count,
        remaining_today=max(0, key_info.daily_quota - daily_count),
        used_this_minute=minute_count,
        remaining_this_minute=max(0, key_info.rate_limit - minute_count),
        history=history,
    )


# ── Admin: API Key Management ────────────────────────────────────────────────

admin_router = APIRouter(prefix="/v1/admin", tags=["API Key Management"])


class CreateKeyRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Name for this API key")
    rate_limit: int = Field(default=30, ge=1, le=1000, description="Max requests per minute")
    daily_quota: int = Field(default=500, ge=1, le=100000, description="Max requests per day")
    permissions: list[str] = Field(
        default=["image", "video"],
        description="Permissions: image, video, workflow",
    )


class UpdateKeyRequest(BaseModel):
    name: str | None = None
    rate_limit: int | None = Field(default=None, ge=1, le=1000)
    daily_quota: int | None = Field(default=None, ge=1, le=100000)
    permissions: list[str] | None = None
    is_active: bool | None = None


@admin_router.post("/keys", dependencies=[Depends(verify_public_key)])
async def create_api_key(body: CreateKeyRequest):
    """Create a new API key. The raw key is shown only once — save it!"""
    key_id, raw_key = api_key_store.create_key(
        name=body.name,
        rate_limit=body.rate_limit,
        daily_quota=body.daily_quota,
        permissions=body.permissions,
    )
    return {
        "key_id": key_id,
        "raw_key": raw_key,
        "name": body.name,
        "rate_limit": body.rate_limit,
        "daily_quota": body.daily_quota,
        "permissions": body.permissions,
        "warning": "Save the raw_key now — it cannot be retrieved again!",
    }


@admin_router.get("/keys", dependencies=[Depends(verify_public_key)])
async def list_api_keys():
    """List all API keys (masked)."""
    return {"keys": api_key_store.list_keys()}


@admin_router.put("/keys/{key_id}", dependencies=[Depends(verify_public_key)])
async def update_api_key(key_id: str, body: UpdateKeyRequest):
    """Update an API key's settings."""
    updated = api_key_store.update_key(
        key_id=key_id,
        name=body.name,
        rate_limit=body.rate_limit,
        daily_quota=body.daily_quota,
        permissions=body.permissions,
        is_active=body.is_active,
    )
    if not updated:
        raise HTTPException(status_code=404, detail={"error": f"Key {key_id} not found"})
    return {"ok": True, "key_id": key_id}


@admin_router.delete("/keys/{key_id}", dependencies=[Depends(verify_public_key)])
async def delete_api_key(key_id: str):
    """Permanently delete an API key."""
    deleted = api_key_store.delete_key(key_id)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": f"Key {key_id} not found"})
    return {"ok": True, "key_id": key_id, "deleted": True}


@admin_router.get("/keys/{key_id}/usage", dependencies=[Depends(verify_public_key)])
async def get_key_usage(key_id: str, days: int = 30):
    """Get usage statistics for a specific API key."""
    summary = api_key_store.get_usage_summary(key_id, days=days)
    recent = api_key_store.get_usage_recent(key_id, limit=50)
    daily_count = api_key_store.get_daily_count(key_id)

    return {
        "key_id": key_id,
        "used_today": daily_count,
        "daily_summary": summary,
        "recent_requests": recent,
    }
