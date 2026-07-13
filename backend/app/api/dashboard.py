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
    
    # Refresh live credits for Flow accounts concurrently (short timeout)
    from app.services.flow_client import google_flow_client
    import asyncio
    
    async def refresh_single_account(acc):
        if acc.provider == "flow" and acc.enabled:
            token = acc.credentials.get("session_token")
            proj_id = acc.credentials.get("project_id")
            if token and proj_id:
                credits = await google_flow_client.get_live_credits(token, proj_id)
                if credits is not None:
                    account_store.update(acc.id, credits_remaining=credits)

    flow_accs = [a for a in accounts if a.provider == "flow" and a.enabled]
    if flow_accs:
        try:
            await asyncio.wait_for(
                asyncio.gather(*(refresh_single_account(a) for a in flow_accs), return_exceptions=True),
                timeout=3.0
            )
        except asyncio.TimeoutError:
            pass

    # Re-fetch accounts to include updated credits
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
                "credits_remaining": a.credits_remaining,
            }
        )

    completed = by_status.get("completed", 0)
    failed = by_status.get("failed", 0)
    done = completed + failed
    success_rate = round(100.0 * completed / done, 1) if done else None

    ext = auth_bridge_state.status_payload()
    
    from app.services.workflow_runner import get_recent_runs
    recent_runs = await get_recent_runs()
    active_runs = [r for r in recent_runs if r.get("status") in {"running", "pending"}]
    finished_runs = [r for r in recent_runs if r.get("status") not in {"running", "pending"}]
    
    formatted_runs = []
    for r in (active_runs + finished_runs)[:10]:
        formatted_runs.append({
            "run_id": r.get("run_id"),
            "project_id": r.get("project_id"),
            "project_name": r.get("project_name") or "Workflow",
            "status": r.get("status"),
            "started_at": r.get("started_at"),
            "finished_at": r.get("finished_at"),
            "error": r.get("error"),
            "progress": r.get("progress"),
        })

    # Format recent standalone tasks (Flow Image, Flow Video)
    sorted_tasks = sorted(tasks, key=lambda t: t.created_at or 0, reverse=True)
    active_tasks = [t for t in sorted_tasks if t.status.value in {"running", "pending"}]
    finished_tasks = [t for t in sorted_tasks if t.status.value not in {"running", "pending"}]
    
    formatted_tasks = []
    for t in (active_tasks + finished_tasks)[:10]:
        formatted_tasks.append({
            "task_id": t.task_id,
            "task_type": t.task_type,
            "prompt": t.prompt,
            "status": t.status.value,
            "created_at": t.created_at,
            "completed_at": t.completed_at,
            "error": t.error,
            "model": t.payload.get("model") or t.payload.get("model_video") or t.payload.get("model_image") or "default",
        })

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
        "workflow_runs": formatted_runs,
        "standalone_tasks": formatted_tasks,
        "extension": ext,
        "session": session_health.payload(),
        "generated_at": time.time(),
    }


@router.post("/clear")
async def clear_dashboard_history(payload: dict = None) -> dict:
    """Clear completed/failed tasks from history.
    Payload: {"type": "all" | "completed" | "failed"}
    """
    p_type = (payload or {}).get("type", "all")
    if p_type == "failed":
        task_queue.clear_history(status="failed")
    elif p_type == "completed":
        task_queue.clear_history(status="completed")
    else:
        task_queue.clear_history(status=None)
    return {"status": "ok"}
