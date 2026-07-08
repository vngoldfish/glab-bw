import secrets

from app.core.task_queue import Task
from app.providers.base import ProviderError
from app.providers.registry import (
    get_flow_provider,
    get_grok_provider,
    get_meta_provider,
    get_openai_provider,
)
from app.core.config import settings
from app.services.output_storage import file_url_from_path, resolve_task_output_dir
from app.services.upscale import upscale_service


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


async def handle_image_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    params = task.payload
    provider = get_flow_provider(for_video=False)
    if provider is None:
        openai = get_openai_provider()
        if openai:
            images = await openai.generate_image(task.prompt, params)
            return _save_outputs(images, task, f"image_{task.task_id}")

        raise ProviderError("No active accounts available", error_code=0)

    images = await provider.generate_image(task.prompt, params)
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

    provider = get_flow_provider(for_video=True)
    if provider is None:
        raise ProviderError("No active Veo account available", error_code=0)

    videos = await provider.generate_video(task.prompt, task.payload)
    return _save_outputs(videos, task, f"video_{task.task_id}", ext="mp4")


async def handle_grok_task(task: Task) -> list[str]:
    if not task.prompt.strip():
        raise ProviderError("Missing required field: prompt", error_code=0)

    mode = task.payload.get("mode", "t2v")
    provider = get_grok_provider()
    if provider is None:
        raise ProviderError("No active Grok session available", error_code=0)

    if mode in {"t2i", "i2i"}:
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