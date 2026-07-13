import asyncio
import logging
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable

from app.core.config import settings
from app.core.task_store import TaskStore

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Task:
    task_id: str
    task_type: str
    prompt: str
    payload: dict[str, Any]
    status: TaskStatus = TaskStatus.PENDING
    created_at: float = field(default_factory=time.time)
    completed_at: float | None = None
    results: list[str] = field(default_factory=list)
    error_code: int = 0
    error: str = ""
    error_detail: str = ""


TaskHandler = Callable[[Task], Awaitable[list[str]]]


class TaskQueue:
    def __init__(self, max_concurrent: int = 5, timeout_seconds: int = 600) -> None:
        self.max_concurrent = max_concurrent
        self._max_concurrent = max_concurrent
        self.timeout_seconds = timeout_seconds
        self._tasks: dict[str, Task] = {}
        self._handlers: dict[str, TaskHandler] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._started_at = time.time()
        self._store = TaskStore(settings.data_dir / "tasks.db")
        self._hydrated = False
        self._task_refs: set[asyncio.Task] = set()
        self._pending_count = 0
        self._running_count = 0
        self._MAX_COMPLETED = 500

    @property
    def uptime(self) -> int:
        return int(time.time() - self._started_at)

    def register_handler(self, task_type: str, handler: TaskHandler) -> None:
        self._handlers[task_type] = handler

    def hydrate_from_disk(self) -> None:
        """Load recent tasks into memory; mark interrupted running as failed."""
        if self._hydrated:
            return
        interrupted = self._store.mark_interrupted_running()
        if interrupted:
            logger.warning("Marked %s interrupted running task(s) as failed", interrupted)
        for row in self._store.load_recent(limit=200):
            try:
                status = TaskStatus(row["status"])
            except ValueError:
                status = TaskStatus.FAILED
            # Do not auto-resume pending — handlers may not be ready mid-boot;
            # leave as failed-ish history. Pending from prior crash → failed.
            if status == TaskStatus.PENDING:
                status = TaskStatus.FAILED
                row["error"] = row["error"] or "Backend restarted before task started"
                row["error_detail"] = row["error_detail"] or "Interrupted while pending"
                row["completed_at"] = row["completed_at"] or time.time()
                self._store.upsert(
                    task_id=row["task_id"],
                    task_type=row["task_type"],
                    prompt=row["prompt"],
                    payload=row["payload"],
                    status=status.value,
                    created_at=row["created_at"],
                    completed_at=row["completed_at"],
                    results=row.get("results") or [],
                    error_code=row.get("error_code") or 0,
                    error=row.get("error") or "",
                    error_detail=row.get("error_detail") or "",
                )
            task = Task(
                task_id=row["task_id"],
                task_type=row["task_type"],
                prompt=row["prompt"],
                payload=row.get("payload") or {},
                status=status,
                created_at=float(row["created_at"] or time.time()),
                completed_at=row.get("completed_at"),
                results=list(row.get("results") or []),
                error_code=int(row.get("error_code") or 0),
                error=str(row.get("error") or ""),
                error_detail=str(row.get("error_detail") or ""),
            )
            self._tasks[task.task_id] = task
        self._hydrated = True
        logger.info("Task history loaded: %s task(s)", len(self._tasks))

    def _persist(self, task: Task) -> None:
        try:
            self._store.upsert(
                task_id=task.task_id,
                task_type=task.task_type,
                prompt=task.prompt,
                payload=task.payload,
                status=task.status.value,
                created_at=task.created_at,
                completed_at=task.completed_at,
                results=task.results,
                error_code=task.error_code,
                error=task.error,
                error_detail=task.error_detail,
            )
        except Exception:
            logger.exception("Failed to persist task %s", task.task_id)

    def set_max_concurrent(self, value: int) -> None:
        value = max(1, min(int(value), 20))
        self.max_concurrent = value
        self._max_concurrent = value
        self._semaphore = asyncio.Semaphore(value)

    def create_task(self, task_type: str, prompt: str, payload: dict[str, Any]) -> Task:
        task_id = secrets.token_hex(8)
        task = Task(task_id=task_id, task_type=task_type, prompt=prompt, payload=payload)
        self._tasks[task_id] = task
        self._persist(task)
        self._pending_count += 1
        bg = asyncio.create_task(self._process(task))
        self._task_refs.add(bg)
        bg.add_done_callback(self._task_refs.discard)
        return task

    def get_task(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def list_tasks(self, limit: int = 50) -> list[Task]:
        tasks = sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]

    def pending_count(self) -> int:
        return self._pending_count

    def running_count(self) -> int:
        return self._running_count

    def _evict_old_tasks(self) -> None:
        """Remove oldest completed/failed tasks when count exceeds _MAX_COMPLETED."""
        terminal = [
            t for t in self._tasks.values()
            if t.status in (TaskStatus.COMPLETED, TaskStatus.FAILED)
        ]
        if len(terminal) <= self._MAX_COMPLETED:
            return
        terminal.sort(key=lambda t: t.created_at)
        excess = len(terminal) - self._MAX_COMPLETED
        for t in terminal[:excess]:
            self._tasks.pop(t.task_id, None)

    async def _process(self, task: Task) -> None:
        handler = self._handlers.get(task.task_type)
        if handler is None:
            self._pending_count -= 1
            task.status = TaskStatus.FAILED
            task.error_code = 0
            task.error = f"No handler for task type: {task.task_type}"
            task.error_detail = task.error
            task.completed_at = time.time()
            self._persist(task)
            row_id = task.payload.get("row_id")
            event_data = {"row_id": row_id} if row_id else {}
            try:
                from app.core.progress import emit_task_status
                emit_task_status(task.task_id, task.task_type, "failed", message=task.error[:200] if task.error else "Lỗi không xác định", data=event_data)
            except Exception:
                pass
            self._evict_old_tasks()
            return

        async with self._semaphore:
            self._pending_count -= 1
            self._running_count += 1
            task.status = TaskStatus.RUNNING
            self._persist(task)
            row_id = task.payload.get("row_id")
            event_data = {"row_id": row_id} if row_id else {}
            try:
                from app.core.progress import emit_task_status
                emit_task_status(task.task_id, task.task_type, "running", message=f"Bắt đầu: {task.prompt[:80]}", data=event_data)
            except Exception:
                pass
            try:
                results = await asyncio.wait_for(handler(task), timeout=self.timeout_seconds)
                task.results = results
                task.status = TaskStatus.COMPLETED
                try:
                    from app.core.progress import emit_task_status
                    emit_task_status(task.task_id, task.task_type, "completed", message=f"Hoàn thành ({len(task.results)} kết quả)", data=event_data)
                except Exception:
                    pass
            except asyncio.TimeoutError:
                task.status = TaskStatus.FAILED
                task.error_code = 0
                task.error = "Timeout: no result generated"
                task.error_detail = task.error
                try:
                    from app.core.progress import emit_task_status
                    emit_task_status(task.task_id, task.task_type, "failed", message=task.error[:200] if task.error else "Lỗi không xác định", data=event_data)
                except Exception:
                    pass
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error_code = getattr(exc, "error_code", 0) or 0
                task.error = getattr(exc, "error", str(exc))
                task.error_detail = getattr(exc, "error_detail", str(exc))
                try:
                    from app.core.progress import emit_task_status
                    emit_task_status(task.task_id, task.task_type, "failed", message=task.error[:200] if task.error else "Lỗi không xác định", data=event_data)
                except Exception:
                    pass
            finally:
                self._running_count -= 1
                task.completed_at = time.time()
                self._persist(task)
                self._evict_old_tasks()
                logger.info(
                    "Task %s type=%s status=%s",
                    task.task_id,
                    task.task_type,
                    task.status.value,
                )


task_queue = TaskQueue()
