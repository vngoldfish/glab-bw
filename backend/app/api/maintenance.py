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
