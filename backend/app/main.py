import secrets

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import accounts, auth_bridge, batch, references, webhook
from app.services.auth_bridge_access import auth_bridge_access
from app.core.config import settings
from app.core.task_queue import task_queue
from app.services.generation import register_task_handlers

settings.ensure_dirs()
if not settings.api_key:
    settings.api_key = secrets.token_urlsafe(32)

task_queue.max_concurrent = settings.max_concurrent_tasks
task_queue.timeout_seconds = settings.task_timeout_seconds
register_task_handlers(task_queue)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(batch.router, prefix="/api")
app.include_router(references.router, prefix="/api")
app.include_router(auth_bridge.router)


@app.get("/")
async def root() -> dict:
    return {
        "name": settings.app_name,
        "webhook": f"http://{settings.host}:{settings.port}/api/health",
        "auth_bridge": "http://127.0.0.1:18923/sync/status",
        "extension_connected": auth_bridge_access.is_connected(),
        "api_key": settings.api_key,
        "docs": f"http://{settings.host}:{settings.port}/docs",
    }


@app.get("/api/info")
async def app_info() -> dict:
    return {
        "name": settings.app_name,
        "webhook": f"http://{settings.host}:{settings.port}/api/health",
        "auth_bridge": settings.auth_bridge_url,
        "extension_connected": auth_bridge_access.is_connected(),
        "api_key": settings.api_key,
        "docs": f"http://{settings.host}:{settings.port}/docs",
    }


@app.get("/api/extension/status")
async def extension_status() -> dict:
    return auth_bridge_access.status_payload()