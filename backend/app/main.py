import logging
import secrets
import socket
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import (
    accounts,
    ai,
    auth_bridge,
    batch,
    dashboard,
    maintenance,
    media,
    pipeline,
    projects,
    prompts,
    references,
    video_editor,
    webhook,
    workflows,
)
from app.core.config import PROJECT_ROOT, RESOURCES_ROOT, settings
from app.core.logging_setup import setup_logging
from app.core.task_queue import task_queue
from app.services.auth_bridge import auth_bridge as auth_bridge_state
from app.services.generation import register_task_handlers

settings.ensure_dirs()
setup_logging(settings.log_level)
logger = logging.getLogger(__name__)

# Stable API key across restarts (webhook / n8n integrations)
if not settings.api_key:
    persisted = settings.load_persisted_api_key()
    if persisted:
        settings.api_key = persisted
        logger.info("Loaded API key from data/api_key.txt")
    else:
        settings.api_key = secrets.token_urlsafe(32)
        settings.persist_api_key(settings.api_key)
        logger.info("Generated new API key → data/api_key.txt")
else:
    # Keep .env key durable too if file missing
    if not settings.load_persisted_api_key():
        try:
            settings.persist_api_key(settings.api_key)
        except OSError:
            logger.warning("Could not persist API key to disk")

task_queue.set_max_concurrent(settings.max_concurrent_tasks)
task_queue.timeout_seconds = settings.task_timeout_seconds
register_task_handlers(task_queue)
task_queue.hydrate_from_disk()

# Chrome Auth Helper always polls this port
AUTH_BRIDGE_PORT = 18923


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _build_bridge_app() -> FastAPI:
    """Separate app instance so lifespan is NOT re-entered on the main API app."""
    bridge = FastAPI(title="G-Labs BW Auth Bridge", version="0.1.0")
    bridge.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    bridge.include_router(auth_bridge.router)

    @bridge.get("/")
    async def bridge_root() -> dict:
        return {"name": "G-Labs BW Auth Bridge", **auth_bridge_state.status_payload()}

    return bridge


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """API :8765 + Auth Helper :18923 share one Python process (one dies ⇒ both die together)."""
    import uvicorn

    bridge_server = None
    if not _port_free(AUTH_BRIDGE_PORT):
        logger.warning(
            "Port %s already in use — Auth Bridge not started here. "
            "Kill the old process or ignore if another bridge is intentional.",
            AUTH_BRIDGE_PORT,
        )
    else:
        bridge_app = _build_bridge_app()
        bridge_config = uvicorn.Config(
            bridge_app,
            host="127.0.0.1",
            port=AUTH_BRIDGE_PORT,
            log_level="warning",
            access_log=False,
        )
        bridge_server = uvicorn.Server(bridge_config)

        def _run_bridge() -> None:
            try:
                bridge_server.run()
            except Exception:
                logger.exception("Auth Bridge (:%s) crashed", AUTH_BRIDGE_PORT)

        threading.Thread(
            target=_run_bridge,
            name="auth-bridge-18923",
            daemon=True,
        ).start()
        # Wait briefly so extension can connect immediately
        for _ in range(20):
            if not _port_free(AUTH_BRIDGE_PORT):
                break
            time.sleep(0.05)
        logger.info(
            "Auth Bridge embedded on http://127.0.0.1:%s (same process as API)",
            AUTH_BRIDGE_PORT,
        )

    # Log CORS config khi khởi động để dễ debug
    _cors = settings.cors_origins
    if "*" in _cors:
        logger.warning(
            "CORS: allow_all=TRUE — mọi origin được phép. CHỈ dùng cho debug/nội bộ!"
        )
    else:
        logger.info("CORS origins (%s): %s", len(_cors), ", ".join(_cors))
    logger.info(
        "G-Labs BW ready — API http://%s:%s  max_concurrent=%s",
        settings.host,
        settings.port,
        settings.max_concurrent_tasks,
    )
    try:
        yield
    finally:
        if bridge_server is not None:
            bridge_server.should_exit = True
        try:
            from app.services.flow_client import google_flow_client
            await google_flow_client.close()
        except Exception:
            logger.exception("Error closing Google Flow client")
        logger.info("G-Labs BW shutting down")


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
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
app.include_router(ai.router, prefix="/api")
app.include_router(maintenance.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(workflows.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(video_editor.router, prefix="/api")
# Also expose /sync/* on :8765 (same in-memory state as :18923)
app.include_router(auth_bridge.router)

# Production UI: frontend/dist (vite build). Dev still uses Vite :5173.
FRONTEND_DIST = RESOURCES_ROOT / "frontend" / "dist"
_HAS_STATIC = (FRONTEND_DIST / "index.html").is_file()


@app.get("/api/info")
async def app_info() -> dict:
    # Chỉ hiển thị 4 ký tự cuối của api_key để user nhận biết mà không lộ toàn bộ
    masked_key = ("*" * 8 + settings.api_key[-4:]) if settings.api_key else ""
    return {
        "name": settings.app_name,
        "webhook": f"http://{settings.host}:{settings.port}/api/health",
        "auth_bridge": settings.auth_bridge_url,
        "extension_connected": auth_bridge_state.is_connected(),
        "api_key": masked_key,
        "docs": f"http://{settings.host}:{settings.port}/docs",
        "static_ui": _HAS_STATIC,
        "ui_url": (
            f"http://{settings.host}:{settings.port}/"
            if _HAS_STATIC
            else "http://127.0.0.1:5173/"
        ),
    }


@app.get("/api/extension/status")
async def extension_status() -> dict:
    # Read in-process state (extension talks to :18923 in the same process)
    return auth_bridge_state.status_payload()


@app.get("/api/cors-status")
async def cors_status() -> dict:
    """Xem cấu hình CORS hiện tại — hữu ích khi debug VPS.
    Truy cập: http://your-vps:8765/api/cors-status
    """
    origins = settings.cors_origins
    is_open = "*" in origins
    return {
        "cors_allow_all": settings.cors_allow_all,
        "is_open_to_all": is_open,
        "vps_domain": settings.vps_domain or None,
        "allowed_origins": origins,
        "origin_count": len(origins),
        "warning": "CORS mở toàn bộ! Chỉ dùng nội bộ." if is_open else None,
        "tip": "Đặt VPS_DOMAIN=yourdomain.com trong .env để thêm domain VPS tự động",
    }


if _HAS_STATIC:
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/")
    async def spa_index() -> FileResponse:
        return FileResponse(FRONTEND_DIST / "index.html")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str) -> FileResponse:
        # Do not swallow API / docs / sync
        if full_path.startswith(("api/", "docs", "openapi", "redoc", "sync/")):
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Not found")
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/")
    async def root() -> dict:
        return {
            "name": settings.app_name,
            "webhook": f"http://{settings.host}:{settings.port}/api/health",
            "auth_bridge": f"http://127.0.0.1:{AUTH_BRIDGE_PORT}/sync/status",
            "extension_connected": auth_bridge_state.is_connected(),
            "docs": f"http://{settings.host}:{settings.port}/docs",
            "ui": "http://127.0.0.1:5173 (dev) — run npm run build for single-process UI",
            "static_ui": False,
        }