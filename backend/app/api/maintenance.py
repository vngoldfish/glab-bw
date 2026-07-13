"""Disk / ops maintenance endpoints."""

from __future__ import annotations

import shutil
import time
from typing import Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.services.test_runner import run_tests

router = APIRouter(prefix="/maintenance", tags=["maintenance"])

_OUTPUT_GLOBS = (
    "G-Labs BW/image_output",
    "G-Labs BW/video_output",
    "G-Labs BW/grok_output",
    "output",
)


@router.get("/disk")
async def disk_info() -> dict:
    data = settings.data_dir
    usage = shutil.disk_usage(str(data))
    folders: list[dict] = []
    total_bytes = 0
    for rel in _OUTPUT_GLOBS:
        path = data / rel
        size = 0
        files = 0
        if path.is_dir():
            for p in path.rglob("*"):
                if p.is_file():
                    try:
                        size += p.stat().st_size
                        files += 1
                    except OSError:
                        pass
        total_bytes += size
        folders.append(
            {
                "path": rel,
                "bytes": size,
                "mb": round(size / (1024 * 1024), 2),
                "files": files,
            }
        )
    free_gb = round(usage.free / (1024**3), 2)
    return {
        "disk_free_gb": free_gb,
        "disk_total_gb": round(usage.total / (1024**3), 2),
        "output_total_mb": round(total_bytes / (1024 * 1024), 2),
        "folders": folders,
        "warn_low_disk": free_gb < 2.0,
    }


@router.post("/cleanup-outputs")
async def cleanup_outputs(
    older_than_days: int = Query(default=30, ge=1, le=365),
    dry_run: bool = Query(default=True),
) -> dict:
    """Delete output files older than N days (dry_run=true by default)."""
    cutoff = time.time() - older_than_days * 86400
    removed = 0
    freed = 0
    candidates: list[str] = []
    for rel in _OUTPUT_GLOBS:
        root = settings.data_dir / rel
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.name == ".gitkeep":
                continue
            try:
                st = path.stat()
            except OSError:
                continue
            if st.st_mtime >= cutoff:
                continue
            rel_path = str(path.relative_to(settings.data_dir))
            candidates.append(rel_path)
            if not dry_run:
                try:
                    size = st.st_size
                    path.unlink()
                    removed += 1
                    freed += size
                except OSError:
                    pass
    # prune empty dirs (bottom-up)
    if not dry_run:
        for rel in _OUTPUT_GLOBS:
            root = settings.data_dir / rel
            if not root.is_dir():
                continue
            for d in sorted(root.rglob("*"), reverse=True):
                if d.is_dir():
                    try:
                        next(d.iterdir())
                    except StopIteration:
                        try:
                            d.rmdir()
                        except OSError:
                            pass

    return {
        "dry_run": dry_run,
        "older_than_days": older_than_days,
        "matched_files": len(candidates),
        "removed_files": removed if not dry_run else 0,
        "freed_mb": round(freed / (1024 * 1024), 2) if not dry_run else 0,
        "sample": candidates[:30],
        "hint": "Gọi lại với dry_run=false để xóa thật",
    }


class RunTestsRequest(BaseModel):
    suite: Literal["all", "smoke", "api"] = "all"
    verbose: bool = False


@router.post("/run-tests")
async def run_project_tests(body: RunTestsRequest | None = None) -> dict:
    """Chạy pytest suite (local). Dùng từ Settings UI hoặc curl."""
    req = body or RunTestsRequest()
    path_map = {
        "all": "backend/tests",
        "smoke": "backend/tests/test_smoke.py",
        "api": "backend/tests/test_api.py",
    }
    path = path_map.get(req.suite, "backend/tests")
    result = run_tests(path=path, quiet=not req.verbose, timeout_sec=180)
    result["suite"] = req.suite
    return result


@router.get("/run-tests")
async def run_project_tests_get(
    suite: Literal["all", "smoke", "api"] = Query(default="smoke"),
) -> dict:
    """GET convenience — default suite=smoke (nhanh)."""
    path_map = {
        "all": "backend/tests",
        "smoke": "backend/tests/test_smoke.py",
        "api": "backend/tests/test_api.py",
    }
    result = run_tests(path=path_map[suite], quiet=True, timeout_sec=180)
    result["suite"] = suite
    return result


class PortsConfig(BaseModel):
    port: int = Field(default=8765, ge=1024, le=65535)
    auth_bridge_port: int = Field(default=18923, ge=1024, le=65535)
    restart: bool = False


@router.get("/ports")
async def get_ports() -> dict:
    """Lấy cấu hình cổng API và cổng Auth Bridge hiện tại."""
    from urllib.parse import urlparse
    api_port = settings.port
    auth_port = 18923
    try:
        parsed = urlparse(settings.auth_bridge_url)
        if parsed.port:
            auth_port = parsed.port
    except Exception:
        pass
    return {"port": api_port, "auth_bridge_port": auth_port}


@router.post("/ports")
async def update_ports(body: PortsConfig) -> dict:
    """Cập nhật cấu hình cổng vào file .env và tự động restart backend."""
    import os
    import sys
    import asyncio
    from app.core.config import PROJECT_ROOT

    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        # Sao chép từ file .env.example
        example_path = PROJECT_ROOT / ".env.example"
        if example_path.exists():
            shutil.copy(str(example_path), str(env_path))
        else:
            env_path.write_text(f"PORT={body.port}\nAUTH_BRIDGE_URL=http://127.0.0.1:{body.auth_bridge_port}\n", encoding="utf-8")

    # Đọc và cập nhật các dòng
    lines = env_path.read_text(encoding="utf-8").splitlines()
    port_found = False
    bridge_found = False

    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("PORT="):
            new_lines.append(f"PORT={body.port}")
            port_found = True
        elif stripped.startswith("AUTH_BRIDGE_URL="):
            new_lines.append(f"AUTH_BRIDGE_URL=http://127.0.0.1:{body.auth_bridge_port}")
            bridge_found = True
        else:
            new_lines.append(line)

    if not port_found:
        new_lines.append(f"PORT={body.port}")
    if not bridge_found:
        new_lines.append(f"AUTH_BRIDGE_URL=http://127.0.0.1:{body.auth_bridge_port}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

    if body.restart:
        async def do_restart():
            await asyncio.sleep(1.0)
            os._exit(0)
        asyncio.create_task(do_restart())
        return {"success": True, "message": "Cấu hình cổng đã được lưu. Hệ thống đang khởi động lại..."}

    return {"success": True, "message": "Cấu hình cổng đã được lưu thành công. Cần khởi động lại máy chủ để áp dụng."}

