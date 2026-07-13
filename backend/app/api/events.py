"""
Server-Sent Events endpoint for real-time progress streaming.

Clients connect to GET /api/events/stream and receive a continuous stream of
ProgressEvent objects as SSE data frames. Connection is kept alive with
periodic heartbeats (every 30s).
"""

import asyncio
import json
import secrets
from dataclasses import asdict

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.core.progress import progress_bus, ProgressEvent

router = APIRouter(prefix="/events", tags=["events"])

_HEARTBEAT_INTERVAL = 30  # seconds


@router.get("/stream")
async def event_stream(request: Request):
    """SSE endpoint — streams progress events to connected clients."""
    client_id = secrets.token_hex(8)
    queue = progress_bus.subscribe(client_id)

    async def generate():
        try:
            # Initial connection acknowledgement
            yield _format_sse({"type": "connected", "client_id": client_id})

            while True:
                try:
                    event: ProgressEvent = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_INTERVAL
                    )
                    yield _format_sse(_serialize_event(event))
                except asyncio.TimeoutError:
                    # Heartbeat keeps the connection alive through proxies
                    yield _format_sse({"type": "heartbeat"})

                # Graceful disconnect detection
                if await request.is_disconnected():
                    break
        except asyncio.CancelledError:
            pass
        finally:
            progress_bus.unsubscribe(client_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",      # Disable nginx buffering
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/clients")
async def connected_clients():
    """Debug endpoint: how many SSE clients are connected."""
    return {"connected": progress_bus.client_count}


def _serialize_event(event: ProgressEvent) -> dict:
    """Convert ProgressEvent to a JSON-serializable dict."""
    d = asdict(event)
    # Convert enum to string
    d["type"] = event.type.value if hasattr(event.type, "value") else str(event.type)
    return d


def _format_sse(data: dict) -> str:
    """Format a dict as an SSE data frame."""
    payload = json.dumps(data, ensure_ascii=False, default=str)
    return f"data: {payload}\n\n"
