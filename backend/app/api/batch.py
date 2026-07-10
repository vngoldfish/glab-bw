import asyncio
import secrets
import time
from typing import Any

from fastapi import APIRouter, HTTPException

from app.core.task_queue import task_queue
from app.models.schemas import BatchSubmitRequest
from app.services.generation import handle_batch_item

router = APIRouter(prefix="/batch", tags=["batch"])

# In-memory async batch jobs (also fine for n8n poll); survives until process restart
_batches: dict[str, dict[str, Any]] = {}


async def _run_batch_items(
    batch_id: str,
    items: list,
    concurrency: int,
) -> None:
    job = _batches[batch_id]
    job["status"] = "running"
    semaphore = asyncio.Semaphore(concurrency)
    results: list[dict] = []

    async def run_item(index: int, item) -> None:
        async with semaphore:
            try:
                output = await handle_batch_item(item.prompt, item.provider, item.params)
                row = {
                    "index": index,
                    "prompt": item.prompt,
                    "provider": item.provider,
                    "status": "completed",
                    "results": output["urls"],
                    "saved_folder": output["folder"],
                }
            except Exception as exc:
                row = {
                    "index": index,
                    "prompt": item.prompt,
                    "provider": item.provider,
                    "status": "failed",
                    "error": str(exc),
                    "error_detail": getattr(exc, "error_detail", str(exc)),
                }
            results.append(row)
            job["results"] = sorted(results, key=lambda r: r["index"])
            job["completed"] = sum(1 for r in results if r["status"] == "completed")
            job["failed"] = sum(1 for r in results if r["status"] == "failed")
            job["done"] = len(results)

    await asyncio.gather(*(run_item(i, item) for i, item in enumerate(items)))
    results.sort(key=lambda r: r["index"])
    job["results"] = results
    job["completed"] = sum(1 for r in results if r["status"] == "completed")
    job["failed"] = len(results) - job["completed"]
    job["done"] = len(results)
    job["status"] = "completed"
    job["finished_at"] = time.time()


def _sync_result(body: BatchSubmitRequest, results: list[dict]) -> dict:
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


@router.post("/submit")
async def submit_batch(body: BatchSubmitRequest) -> dict:
    """Sync batch (UI path) — waits for all items."""
    concurrency = max(1, min(body.concurrency, 10))
    results: list[dict] = []
    semaphore = asyncio.Semaphore(concurrency)

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
    return _sync_result(body, results)


@router.post("/submit-async", status_code=202)
async def submit_batch_async(body: BatchSubmitRequest) -> dict:
    """Async batch for n8n / large jobs — poll GET /api/batch/{batch_id}."""
    if not body.items:
        raise HTTPException(status_code=400, detail={"error": "No items"})
    concurrency = max(1, min(body.concurrency, 10))
    batch_id = secrets.token_hex(6)
    _batches[batch_id] = {
        "batch_id": batch_id,
        "status": "pending",
        "total": len(body.items),
        "done": 0,
        "completed": 0,
        "failed": 0,
        "results": [],
        "created_at": time.time(),
        "finished_at": None,
        "poll_url": f"/api/batch/{batch_id}",
    }
    asyncio.create_task(_run_batch_items(batch_id, list(body.items), concurrency))
    return {
        "batch_id": batch_id,
        "status": "pending",
        "total": len(body.items),
        "poll_url": f"/api/batch/{batch_id}",
        "message": "Batch queued — poll poll_url until status=completed",
    }


@router.get("/{batch_id}")
async def get_batch(batch_id: str) -> dict:
    job = _batches.get(batch_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": f"Batch {batch_id} not found"})
    return {
        "batch_id": job["batch_id"],
        "status": job["status"],
        "total": job["total"],
        "done": job["done"],
        "completed": job["completed"],
        "failed": job["failed"],
        "results": job["results"],
        "created_at": job["created_at"],
        "finished_at": job["finished_at"],
        "queue": {
            "pending": task_queue.pending_count(),
            "running": task_queue.running_count(),
        },
    }
