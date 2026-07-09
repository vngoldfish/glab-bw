import logging
import secrets
import socket
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import accounts, ai, auth_bridge, batch, references, webhook
from app.core.config import settings
from app.core.task_queue import task_queue
from app.services.auth_bridge import auth_bridge as auth_bridge_state
from app.services.generation import register_task_handlers

logger = logging.getLogger(__name__)

settings.ensure_dirs()
if not settings.api_key:
    settings.api_key = secrets.token_urlsafe(32)

task_queue.max_concurrent = settings.max_concurrent_tasks
task_queue.timeout_seconds = settings.task_timeout_seconds
register_task_handlers(task_queue)

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

    try:
        yield
    finally:
        if bridge_server is not None:
            bridge_server.should_exit = True


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
# Also expose /sync/* on :8765 (same in-memory state as :18923)
app.include_router(auth_bridge.router)


@app.get("/")
async def root() -> dict:
    return {
        "name": settings.app_name,
        "webhook": f"http://{settings.host}:{settings.port}/api/health",
        "auth_bridge": f"http://127.0.0.1:{AUTH_BRIDGE_PORT}/sync/status",
        "extension_connected": auth_bridge_state.is_connected(),
        "api_key": settings.api_key,
        "docs": f"http://{settings.host}:{settings.port}/docs",
    }


@app.get("/api/info")
async def app_info() -> dict:
    return {
        "name": settings.app_name,
        "webhook": f"http://{settings.host}:{settings.port}/api/health",
        "auth_bridge": settings.auth_bridge_url,
        "extension_connected": auth_bridge_state.is_connected(),
        "api_key": settings.api_key,
        "docs": f"http://{settings.host}:{settings.port}/docs",
    }


@app.get("/api/extension/status")
async def extension_status() -> dict:
    # Read in-process state (extension talks to :18923 in the same process)
    return auth_bridge_state.status_payload()