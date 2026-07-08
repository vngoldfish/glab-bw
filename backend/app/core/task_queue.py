import asyncio
import secrets
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable


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
    def __init__(self, max_concurrent: int = 10, timeout_seconds: int = 600) -> None:
        self.max_concurrent = max_concurrent
        self.timeout_seconds = timeout_seconds
        self._tasks: dict[str, Task] = {}
        self._handlers: dict[str, TaskHandler] = {}
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._started_at = time.time()

    @property
    def uptime(self) -> int:
        return int(time.time() - self._started_at)

    def register_handler(self, task_type: str, handler: TaskHandler) -> None:
        self._handlers[task_type] = handler

    def create_task(self, task_type: str, prompt: str, payload: dict[str, Any]) -> Task:
        task_id = secrets.token_hex(4)
        task = Task(task_id=task_id, task_type=task_type, prompt=prompt, payload=payload)
        self._tasks[task_id] = task
        asyncio.create_task(self._process(task))
        return task

    def get_task(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def list_tasks(self, limit: int = 50) -> list[Task]:
        tasks = sorted(self._tasks.values(), key=lambda t: t.created_at, reverse=True)
        return tasks[:limit]

    def pending_count(self) -> int:
        return sum(1 for t in self._tasks.values() if t.status == TaskStatus.PENDING)

    def running_count(self) -> int:
        return sum(1 for t in self._tasks.values() if t.status == TaskStatus.RUNNING)

    async def _process(self, task: Task) -> None:
        handler = self._handlers.get(task.task_type)
        if handler is None:
            task.status = TaskStatus.FAILED
            task.error_code = 0
            task.error = f"No handler for task type: {task.task_type}"
            task.error_detail = task.error
            task.completed_at = time.time()
            return

        async with self._semaphore:
            task.status = TaskStatus.RUNNING
            try:
                results = await asyncio.wait_for(handler(task), timeout=self.timeout_seconds)
                task.results = results
                task.status = TaskStatus.COMPLETED
            except asyncio.TimeoutError:
                task.status = TaskStatus.FAILED
                task.error_code = 0
                task.error = "Timeout: no result generated"
                task.error_detail = task.error
            except Exception as exc:
                task.status = TaskStatus.FAILED
                task.error_code = getattr(exc, "error_code", 0)
                task.error = getattr(exc, "error", str(exc))
                task.error_detail = getattr(exc, "error_detail", str(exc))
            finally:
                task.completed_at = time.time()


task_queue = TaskQueue()