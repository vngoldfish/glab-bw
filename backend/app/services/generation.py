import logging
import secrets

from app.core.config import settings
from app.core.retry import is_retryable_error, is_session_stale_error, with_retries
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
from app.services.session_health import session_health
from app.services.upscale import upscale_service

logger = logging.getLogger(__name__)


def _validate_prompt(task: Task) -> None:
    """Raise ProviderError if prompt is empty."""
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)


def _track(provider_name: str, kind: str, **kwargs) -> None:
    """Track model usage; swallow import/runtime errors."""
    try:
        from app.services.credit_store import track_run
        track_run(provider_name, kind=kind, **kwargs)
    except Exception:
        logger.exception("Failed to track %s %s run", provider_name, kind)


def _save_outputs(
    data_list: list[bytes],
    task: Task,
    prefix: str,
    ext: str = "png",
) -> list[str]:
    output_dir = resolve_task_output_dir(task)
    urls: list[str] = []
    from app.services.output_storage import copy_to_central_dir
    for index, data in enumerate(data_list, start=1):
        filename = f"{prefix}_{index:03d}.{ext}"
        saved = upscale_service.save_bytes(data, filename, output_dir)
        urls.append(file_url_from_path(saved))
        
        # Copy to central directory
        file_type = "video" if ext == "mp4" else "anh"
        copy_to_central_dir(saved, "workflow", file_type)
        
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

            # Bind provider in default arg to avoid loop-closure bugs
            async def _once(p=provider) -> list[bytes]:
                if for_video:
                    return await p.generate_video(prompt, params)
                return await p.generate_image(prompt, params)

            # Same-account soft retry (503 / network) before rotating
            result = await with_retries(
                _once,
                attempts=2,
                base_delay=2.0,
                retry_if=lambda e: is_retryable_error(e) and not _is_quota_or_rate_error(e),
                label=f"flow:{account.label or account.id[:6]}",
            )
            account_store.mark_used(account.id)
            session_health.mark_flow_ok()
            return result
        except ProviderError as exc:
            last_error = exc
            if is_session_stale_error(exc):
                session_health.mark_flow_stale(str(exc), account.id)
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
    if last_error and is_session_stale_error(last_error):
        session_health.mark_flow_stale(detail)
    raise ProviderError(
        f"Tất cả tài khoản Flow đều lỗi (đã thử: {', '.join(tried)}). Cuối: {detail}",
        error_code=getattr(last_error, "error_code", 0) or 0,
    )


async def handle_image_task(task: Task) -> list[str]:
    _validate_prompt(task)

    params = task.payload
    custom_prefix = params.get("custom_prefix")
    file_prefix = custom_prefix if custom_prefix else f"image_{task.task_id}"
    row_id = params.get("row_id")
    event_data = {"row_id": row_id} if row_id else {}

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang chọn tài khoản...", percent=10, task_type=task.task_type, data=event_data)
    except Exception:
        pass

    # Simulated progress task for synchronous image generation
    async def simulate_progress(tid: str, start: int, end: int, duration: float, msg: str, ttype: str):
        try:
            steps = 10
            delay = duration / steps
            step_pct = (end - start) / steps
            curr = start
            for _ in range(steps):
                await asyncio.sleep(delay)
                curr += step_pct
                try:
                    from app.core.progress import emit_task_progress
                    emit_task_progress(tid, msg, percent=int(curr), task_type=ttype, data=event_data)
                except Exception:
                    pass
        except asyncio.CancelledError:
            pass

    progress_sim = asyncio.create_task(
        simulate_progress(task.task_id, 30, 80, 7.0, "Đang tạo ảnh...", task.task_type)
    )

    try:
        try:
            from app.core.progress import emit_task_progress
            emit_task_progress(task.task_id, "Đang gửi prompt tạo ảnh...", percent=30, task_type=task.task_type, data=event_data)
        except Exception:
            pass
        images = await _run_flow_with_rotation(
            for_video=False,
            prompt=task.prompt,
            params=params,
        )
    except ProviderError:
        progress_sim.cancel()
        openai = get_openai_provider()
        if openai:
            images = await openai.generate_image(task.prompt, params)
            _track("openai", "image")
            return _save_outputs(images, task, file_prefix)
        raise
    finally:
        progress_sim.cancel()

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang lưu kết quả...", percent=85, task_type=task.task_type, data=event_data)
    except Exception:
        pass

    upscale_targets = params.get("upscale", [])
    if upscale_targets:
        upscaled_all: list[bytes] = []
        for image in images:
            upscaled_all.extend(upscale_service.upscale_image(image, upscale_targets))
        return _save_outputs(upscaled_all, task, file_prefix)
    return _save_outputs(images, task, file_prefix)


async def handle_video_task(task: Task) -> list[str]:
    _validate_prompt(task)
    row_id = task.payload.get("row_id")
    event_data = {"row_id": row_id} if row_id else {}

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang chọn tài khoản...", percent=5, task_type=task.task_type, data=event_data)
    except Exception:
        pass

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang gửi prompt tạo video...", percent=15, task_type=task.task_type, data=event_data)
    except Exception:
        pass

    # Simulated progress task in case live polling returns no percentage
    async def simulate_progress(tid: str, start: int, end: int, duration: float, msg: str, ttype: str):
        try:
            steps = 40
            delay = duration / steps
            step_pct = (end - start) / steps
            curr = start
            for _ in range(steps):
                await asyncio.sleep(delay)
                curr += step_pct
                try:
                    from app.core.progress import emit_task_progress
                    emit_task_progress(tid, msg, percent=int(curr), task_type=ttype, data=event_data)
                except Exception:
                    pass
        except asyncio.CancelledError:
            pass

    progress_sim = asyncio.create_task(
        simulate_progress(task.task_id, 15, 80, 45.0, "Đang tạo video...", task.task_type)
    )

    try:
        videos = await _run_flow_with_rotation(
            for_video=True,
            prompt=task.prompt,
            params={**task.payload, "task_id": task.task_id},
        )
    finally:
        progress_sim.cancel()

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang lưu video...", percent=85, task_type=task.task_type, data=event_data)
    except Exception:
        pass

    custom_prefix = task.payload.get("custom_prefix")
    file_prefix = custom_prefix if custom_prefix else f"video_{task.task_id}"
    return _save_outputs(videos, task, file_prefix, ext="mp4")


async def handle_grok_task(task: Task) -> list[str]:
    _validate_prompt(task)

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

    try:
        from app.core.progress import emit_task_progress
        emit_task_progress(task.task_id, "Đang kết nối Grok...", percent=20, task_type=task.task_type)
    except Exception:
        pass

    custom_prefix = task.payload.get("custom_prefix")
    try:
        if not for_video:
            images = await provider.generate_image(task.prompt, task.payload)
            _track("grok", "image")
            session_health.mark_grok_ok()
            try:
                from app.core.progress import emit_task_progress
                emit_task_progress(task.task_id, "Đang lưu kết quả...", percent=85, task_type=task.task_type)
            except Exception:
                pass
            file_prefix = custom_prefix if custom_prefix else f"grok_{task.task_id}"
            return _save_outputs(images, task, file_prefix)
        videos = await provider.generate_video(task.prompt, task.payload)
        _track("grok", "video")
        session_health.mark_grok_ok()
        try:
            from app.core.progress import emit_task_progress
            emit_task_progress(task.task_id, "Đang lưu kết quả...", percent=85, task_type=task.task_type)
        except Exception:
            pass
        file_prefix = custom_prefix if custom_prefix else f"grok_{task.task_id}"
        return _save_outputs(videos, task, file_prefix, ext="mp4")
    except ProviderError as exc:
        if is_session_stale_error(exc):
            session_health.mark_grok_stale(str(exc))
        raise


async def handle_meta_task(task: Task) -> list[str]:
    _validate_prompt(task)

    mode = task.payload.get("mode", "t2i")
    for_video = mode in {"t2v", "i2v"}
    provider = get_meta_provider(for_video=for_video)
    if provider is None:
        raise ProviderError(
            f"No enabled Meta account for {'video' if for_video else 'image'}",
            error_code=0,
        )

    count = max(1, min(int(task.payload.get("count", 1)), 4))
    custom_prefix = task.payload.get("custom_prefix")
    if for_video:
        outputs = await provider.generate_video(task.prompt, {**task.payload, "count": count})
        _track("meta", "video")
        file_prefix = custom_prefix if custom_prefix else f"meta_{task.task_id}"
        return _save_outputs(outputs, task, file_prefix, ext="mp4")
    outputs = await provider.generate_image(task.prompt, {**task.payload, "count": count})
    _track("meta", "image")
    file_prefix = custom_prefix if custom_prefix else f"meta_{task.task_id}"
    return _save_outputs(outputs, task, file_prefix)


async def handle_openai_task(task: Task) -> list[str]:
    _validate_prompt(task)

    provider = get_openai_provider()
    if provider is None:
        raise ProviderError("No active OpenAI account available", error_code=0)

    images = await provider.generate_image(task.prompt, task.payload)
    _track("openai", "image")
    custom_prefix = task.payload.get("custom_prefix")
    file_prefix = custom_prefix if custom_prefix else f"openai_{task.task_id}"
    return _save_outputs(images, task, file_prefix)


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