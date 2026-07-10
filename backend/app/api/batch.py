import asyncio

from fastapi import APIRouter

from app.core.task_queue import task_queue
from app.models.schemas import BatchSubmitRequest
from app.services.generation import handle_batch_item

router = APIRouter(prefix="/batch", tags=["batch"])


@router.post("/submit")
async def submit_batch(body: BatchSubmitRequest) -> dict:
    # Cap lower by default — high concurrency hammers Google Flow / captcha
    concurrency = max(1, min(body.concurrency, 10))
    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async def run_item(index: int, item) -> None:
        async with semaphore:
            try:
                output = await handle_batch_item(item.prompt, item.provider, item.params)
                results.append(
                    {
                        "index": index,
                        "prompt": item.prompt,
                        "provider": item.provider,
                        "status": "completed",
                        "results": output["urls"],
                        "saved_folder": output["folder"],
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "index": index,
                        "prompt": item.prompt,
                        "provider": item.provider,
                        "status": "failed",
                        "error": str(exc),
                        "error_detail": getattr(exc, "error_detail", str(exc)),
                    }
                )

    await asyncio.gather(*(run_item(i, item) for i, item in enumerate(body.items)))
    results.sort(key=lambda r: r["index"])
    completed = sum(1 for r in results if r["status"] == "completed")
    failed = len(results) - completed
    return {
        "total": len(results),
        "completed": completed,
        "failed": failed,
        "queue": {
            "pending": task_queue.pending_count(),
            "running": task_queue.running_count(),
        },
        "results": results,
    }