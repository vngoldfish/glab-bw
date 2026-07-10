import logging
import secrets

from app.core.config import settings
from app.core.task_queue import Task
from app.providers.base import ProviderError
from app.providers.registry import (
    get_flow_providers,
    get_grok_provider,
    get_meta_provider,
    get_openai_provider,
)
from app.services.account_store import account_store
from app.services.output_storage import file_url_from_path, resolve_task_output_dir
from app.services.upscale import upscale_service

logger = logging.getLogger(__name__)


def _save_outputs(
    data_list: list[bytes],
    task: Task,
    prefix: str,
    ext: str = "png",
) -> list[str]:
    output_dir = resolve_task_output_dir(task)
    urls: list[str] = []
    for index, data in enumerate(data_list, start=1):
        filename = f"{prefix}_{index:03d}.{ext}"
        saved = upscale_service.save_bytes(data, filename, output_dir)
        urls.append(file_url_from_path(saved))
    return urls


def _is_quota_or_rate_error(exc: BaseException) -> bool:
    """Detect Google Flow quota / rate-limit style failures for account rotation.

    Avoid matching the word "quota" inside our own advice text on INTERNAL errors.
    """
    msg = str(exc).lower()
    code = int(getattr(exc, "error_code", 0) or 0)
    if code == 429:
        return True
    # Specific Google phrases only — NOT bare "quota" (false-positive on advice strings)
    needles = (
        "resource_exhausted",
        "resource has been exhausted",
        "public_error_user_quota",
        "user_quota_reached",
        "hết quota",
        "het quota",
        "rate limit",
        "rate_limit",
        "ratelimit",
        "too many requests",
        "throttl",
        "daily limit",
        "per_model_daily",
        "out of credit",
        "hết credit",
        "het credit",
    )
    return any(n in msg for n in needles)


async def _run_flow_with_rotation(
    *,
    for_video: bool,
    prompt: str,
    params: dict,
) -> list[bytes]:
    """Try each eligible Flow account; on quota, cool it down and try the next."""
    candidates = get_flow_providers(for_video=for_video)
    if not candidates:
        kind = "video" if for_video else "image"
        raise ProviderError(
            f"Không còn tài khoản Flow khả dụng cho {kind}. "
            "Thêm cookie account khác trong Settings, hoặc đợi cooldown / bật lại account.",
            error_code=0,
        )

    last_error: BaseException | None = None
    tried: list[str] = []

    for account, provider in candidates:
        tried.append(account.label or account.id)
        try:
            logger.info(
                "Flow %s using account=%s (%s)",
                "video" if for_video else "image",
                account.label,
                account.id[:8],
            )
            if for_video:
                result = await provider.generate_video(prompt, params)
            else:
                result = await provider.generate_image(prompt, params)
            account_store.mark_used(account.id)
            return result
        except ProviderError as exc:
            last_error = exc
            if _is_quota_or_rate_error(exc):
                # Only cool down the modality that failed (video quota must not block image)
                account_store.mark_quota_exhausted(
                    account.id,
                    reason=str(exc)[:300],
                    cooldown_sec=3600,
                    for_video=for_video,
                )
                logger.warning(
                    "Account %s %s quota/rate-limited — cooldown 1h, try next. err=%s",
                    account.label,
                    "video" if for_video else "image",
                    exc,
                )
                continue
            # Non-quota errors: try next account (session / model INTERNAL / captcha)
            msg = str(exc).lower()
            soft = any(
                x in msg
                for x in (
                    "permission",
                    "unauthenticated",
                    "401",
                    "403",
                    "session",
                    "token",
                    "internal",
                    "recaptcha",
                    "captcha",
                )
            ) or int(getattr(exc, "error_code", 0) or 0) in {403, 500, 502, 503}
            if soft and len(candidates) > 1:
                logger.warning(
                    "Account %s failed (%s) — try next Flow account",
                    account.label,
                    exc,
                )
                continue
            raise

    detail = str(last_error) if last_error else "unknown"
    raise ProviderError(
        f"Tất cả tài khoản Flow đều lỗi (đã thử: {', '.join(tried)}). Cuối: {detail}",
        error_code=getattr(last_error, "error_code", 0) or 0,
    )


async def handle_image_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    params = task.payload
    try:
        images = await _run_flow_with_rotation(
            for_video=False,
            prompt=task.prompt,
            params=params,
        )
    except ProviderError:
        openai = get_openai_provider()
        if openai:
            images = await openai.generate_image(task.prompt, params)
            return _save_outputs(images, task, f"image_{task.task_id}")
        raise

    upscale_targets = params.get("upscale", [])
    if upscale_targets:
        upscaled_all: list[bytes] = []
        for image in images:
            upscaled_all.extend(upscale_service.upscale_image(image, upscale_targets))
        return _save_outputs(upscaled_all, task, f"image_{task.task_id}")
    return _save_outputs(images, task, f"image_{task.task_id}")


async def handle_video_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    videos = await _run_flow_with_rotation(
        for_video=True,
        prompt=task.prompt,
        params=task.payload,
    )
    return _save_outputs(videos, task, f"video_{task.task_id}", ext="mp4")


async def handle_grok_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    mode = str(task.payload.get("mode") or "t2v").lower()
    # t2i / i2i = image; everything else treated as video (t2v, i2v, …)
    for_video = mode not in {"t2i", "i2i", "image", "img"}
    provider = get_grok_provider(for_video=for_video)
    if provider is None:
        raise ProviderError(
            "Chưa có tài khoản Grok — Cài đặt → Grok AI → dán cookie sso+sso-rw từ grok.com "
            "(giống Flow), hoặc xAI API key",
            error_code=0,
        )

    if not for_video:
        images = await provider.generate_image(task.prompt, task.payload)
        return _save_outputs(images, task, f"grok_{task.task_id}")
    videos = await provider.generate_video(task.prompt, task.payload)
    return _save_outputs(videos, task, f"grok_{task.task_id}", ext="mp4")


async def handle_meta_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    mode = task.payload.get("mode", "t2i")
    for_video = mode in {"t2v", "i2v"}
    provider = get_meta_provider(for_video=for_video)
    if provider is None:
        raise ProviderError(
            f"No enabled Meta account for {'video' if for_video else 'image'}",
            error_code=0,
        )

    count = max(1, min(int(task.payload.get("count", 1)), 4))
    if for_video:
        outputs = await provider.generate_video(task.prompt, {**task.payload, "count": count})
        return _save_outputs(outputs, task, f"meta_{task.task_id}", ext="mp4")
    outputs = await provider.generate_image(task.prompt, {**task.payload, "count": count})
    return _save_outputs(outputs, task, f"meta_{task.task_id}")


async def handle_openai_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    provider = get_openai_provider()
    if provider is None:
        raise ProviderError("No active OpenAI account available", error_code=0)

    images = await provider.generate_image(task.prompt, task.payload)
    return _save_outputs(images, task, f"openai_{task.task_id}")


async def handle_batch_item(prompt: str, provider: str, params: dict) -> dict:
    task_id = secrets.token_hex(4)
    task = Task(task_id=task_id, task_type=provider, prompt=prompt, payload=params)
    handlers = {
        "image": handle_image_task,
        "video": handle_video_task,
        "grok": handle_grok_task,
        "meta": handle_meta_task,
        "openai": handle_openai_task,
    }
    handler = handlers.get(provider)
    if not handler:
        raise ProviderError(f"Unknown provider: {provider}", error_code=0)
    urls = await handler(task)
    folder = resolve_task_output_dir(task).relative_to(settings.data_dir.resolve()).as_posix()
    return {"urls": urls, "folder": folder}


def register_task_handlers(queue) -> None:
    queue.register_handler("image", handle_image_task)
    queue.register_handler("video", handle_video_task)
    queue.register_handler("grok", handle_grok_task)
    queue.register_handler("meta", handle_meta_task)
    queue.register_handler("openai", handle_openai_task)