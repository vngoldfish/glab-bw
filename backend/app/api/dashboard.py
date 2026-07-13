"""Dashboard aggregates — task stats, accounts, readiness."""

from __future__ import annotations

import time

from fastapi import APIRouter

from app.core.task_queue import TaskStatus, task_queue
from app.services.account_store import account_store
from app.services.auth_bridge import auth_bridge as auth_bridge_state
from app.services.session_health import session_health

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def dashboard() -> dict:
    tasks = task_queue.list_tasks(limit=200)
    by_status = {s.value: 0 for s in TaskStatus}
    by_type: dict[str, int] = {}
    recent_failed: list[dict] = []
    for t in tasks:
        by_status[t.status.value] = by_status.get(t.status.value, 0) + 1
        by_type[t.task_type] = by_type.get(t.task_type, 0) + 1
        if t.status == TaskStatus.FAILED and len(recent_failed) < 10:
            recent_failed.append(
                {
                    "task_id": t.task_id,
                    "type": t.task_type,
                    "prompt": (t.prompt or "")[:80],
                    "error": t.error,
                    "completed_at": t.completed_at,
                }
            )

    accounts = account_store.list_accounts()
    from app.services.credit_store import get_usage
    credits_data = get_usage()
    acc_credits = credits_data.get("accounts", {})

    acc_summary = []
    for a in accounts:
        ac_stats = acc_credits.get(a.id, {})
        acc_summary.append(
            {
                "id": a.id,
                "label": a.label,
                "provider": a.provider,
                "enabled": a.enabled,
                "image_enabled": a.image_enabled,
                "video_enabled": a.video_enabled,
                "in_cooldown": account_store._in_cooldown(a),  # noqa: SLF001
                "last_error": a.last_error,
                "total_runs": ac_stats.get("total_runs", 0),
                "total_credits": ac_stats.get("total_credits", 0),
            }
        )

    completed = by_status.get("completed", 0)
    failed = by_status.get("failed", 0)
    done = completed + failed
    success_rate = round(100.0 * completed / done, 1) if done else None

    ext = auth_bridge_state.status_payload()
    return {
        "uptime": task_queue.uptime,
        "queue": {
            "pending": task_queue.pending_count(),
            "running": task_queue.running_count(),
            "max_concurrent": task_queue.max_concurrent,
        },
        "tasks": {
            "total_tracked": len(tasks),
            "by_status": by_status,
            "by_type": by_type,
            "success_rate_pct": success_rate,
            "recent_failed": recent_failed,
        },
        "accounts": {
            "total": len(accounts),
            "enabled": sum(1 for a in accounts if a.enabled),
            "flow_image_ready": len(account_store.list_eligible("flow", for_video=False)),
            "flow_video_ready": len(account_store.list_eligible("flow", for_video=True)),
            "items": acc_summary,
        },
        "credits": credits_data,
        "extension": ext,
        "session": session_health.payload(),
        "generated_at": time.time(),
    }
