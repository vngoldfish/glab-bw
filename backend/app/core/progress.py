"""
Real-time progress event bus using per-client asyncio queues.

Architecture:
- Services emit events via convenience functions (emit_task_status, emit_task_progress, etc.)
- ProgressBus fans out events to all connected SSE clients
- SSELogHandler captures Python log records and pipes them into the bus

Bandwidth optimizations:
- Log events are buffered 500ms before flushing to reduce event frequency
- Task progress is rate-limited at 300ms per task to prevent spam
- Client queues drop oldest events when full (backpressure)
"""

import asyncio
import time
import logging
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    TASK_STATUS = "task_status"
    TASK_PROGRESS = "task_progress"
    WORKFLOW_LOG = "workflow_log"
    SYSTEM_LOG = "system_log"
    HEARTBEAT = "heartbeat"


@dataclass
class ProgressEvent:
    type: EventType
    timestamp: float = field(default_factory=time.time)
    task_id: str = ""
    task_type: str = ""
    step: str = ""
    percent: int = -1          # 0-100, -1 = indeterminate
    status: str = ""
    message: str = ""
    level: str = "INFO"
    data: dict[str, Any] = field(default_factory=dict)


class ProgressBus:
    """Fan-out event bus: services produce events, SSE clients consume them."""

    def __init__(
        self,
        max_queue_size: int = 500,
        rate_limit_ms: int = 300,
        log_batch_ms: int = 500,
    ):
        self._clients: dict[str, asyncio.Queue[ProgressEvent | None]] = {}
        self._rate_limit = rate_limit_ms / 1000.0
        self._log_batch_sec = log_batch_ms / 1000.0
        self._last_progress: dict[str, float] = {}
        self._log_buffer: list[ProgressEvent] = []
        self._log_flush_task: asyncio.Task | None = None
        self._max_queue = max_queue_size

    # ── Client management ──────────────────────────────────────────

    def subscribe(self, client_id: str) -> asyncio.Queue:
        """Register a new SSE client. Returns a queue to read events from."""
        q: asyncio.Queue = asyncio.Queue(maxsize=self._max_queue)
        self._clients[client_id] = q
        logger.info(
            "SSE client connected: %s (total: %d)",
            client_id,
            len(self._clients),
        )
        return q

    def unsubscribe(self, client_id: str):
        """Remove an SSE client."""
        self._clients.pop(client_id, None)
        self._last_progress = {
            k: v for k, v in self._last_progress.items()
            if k in self._clients
        }
        logger.info(
            "SSE client disconnected: %s (total: %d)",
            client_id,
            len(self._clients),
        )

    @property
    def client_count(self) -> int:
        return len(self._clients)

    # ── Event emission ─────────────────────────────────────────────

    def emit(self, event: ProgressEvent):
        """Emit event to all connected clients (non-blocking, drops oldest if full)."""
        if not self._clients:
            return

        # Rate-limit per-task progress events to avoid flooding
        if event.type == EventType.TASK_PROGRESS and event.task_id:
            now = time.monotonic()
            last = self._last_progress.get(event.task_id, 0.0)
            if (now - last) < self._rate_limit and event.percent < 100:
                return
            self._last_progress[event.task_id] = now

        for q in self._clients.values():
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()          # drop oldest
                    q.put_nowait(event)
                except asyncio.QueueEmpty:
                    pass

    def emit_log_buffered(self, event: ProgressEvent):
        """Buffer log events and flush every `log_batch_ms` to reduce bandwidth."""
        self._log_buffer.append(event)
        if self._log_flush_task is None or self._log_flush_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._log_flush_task = loop.create_task(self._flush_logs())
            except RuntimeError:
                # No running loop yet (startup); emit immediately
                self.emit(event)
                self._log_buffer.clear()

    async def _flush_logs(self):
        await asyncio.sleep(self._log_batch_sec)
        batch = self._log_buffer[:]
        self._log_buffer.clear()
        for ev in batch:
            self.emit(ev)


# ── Singleton ──────────────────────────────────────────────────────
progress_bus = ProgressBus()


# ── Convenience emitters ───────────────────────────────────────────

def emit_task_status(
    task_id: str,
    task_type: str,
    status: str,
    *,
    message: str = "",
    **kwargs: Any,
):
    progress_bus.emit(ProgressEvent(
        type=EventType.TASK_STATUS,
        task_id=task_id,
        task_type=task_type,
        status=status,
        message=message,
        **kwargs,
    ))


def emit_task_progress(
    task_id: str,
    step: str,
    *,
    percent: int = -1,
    task_type: str = "",
    **kwargs: Any,
):
    progress_bus.emit(ProgressEvent(
        type=EventType.TASK_PROGRESS,
        task_id=task_id,
        task_type=task_type,
        step=step,
        percent=percent,
        **kwargs,
    ))


def emit_workflow_log(
    run_id: str,
    message: str,
    *,
    data: dict[str, Any] | None = None,
):
    progress_bus.emit(ProgressEvent(
        type=EventType.WORKFLOW_LOG,
        task_id=run_id,
        message=message,
        data=data or {},
    ))


# ── Logging handler ───────────────────────────────────────────────

class SSELogHandler(logging.Handler):
    """
    Python logging handler that pipes log records into the SSE event bus.
    Attached to the root logger so all app logs are streamed to connected clients.
    Uses buffered emission to batch log lines every 500ms.
    """

    def __init__(self, min_level: int = logging.INFO):
        super().__init__(level=min_level)

    def emit(self, record: logging.LogRecord):
        # Skip noisy loggers
        if record.name in ("httpx", "httpcore", "uvicorn.access"):
            return
        try:
            event = ProgressEvent(
                type=EventType.SYSTEM_LOG,
                message=self.format(record) if self.formatter else record.getMessage(),
                level=record.levelname,
                data={"logger": record.name},
            )
            progress_bus.emit_log_buffered(event)
        except Exception:
            pass  # Never break the logging chain
