"""Smoke tests — no network, no Chrome."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


def test_settings_and_dirs(tmp_path, monkeypatch):
    from app.core.config import Settings

    s = Settings(data_dir=tmp_path / "data", output_dir=tmp_path / "data" / "output")
    s.ensure_dirs()
    assert s.data_dir.is_dir()
    assert s.output_dir.is_dir()


def test_task_store_roundtrip(tmp_path):
    from app.core.task_store import TaskStore

    store = TaskStore(tmp_path / "tasks.db")
    store.upsert(
        task_id="abcd",
        task_type="image",
        prompt="hello",
        payload={"model": "x"},
        status="completed",
        created_at=1.0,
        completed_at=2.0,
        results=["/api/files/a.png"],
    )
    rows = store.load_recent(10)
    assert len(rows) == 1
    assert rows[0]["task_id"] == "abcd"
    assert rows[0]["results"] == ["/api/files/a.png"]
    assert store.mark_interrupted_running() == 0


def test_retry_helpers():
    from app.core.retry import is_retryable_error, is_session_stale_error

    class E(Exception):
        def __init__(self, msg, code=0):
            super().__init__(msg)
            self.error_code = code

    assert is_retryable_error(E("503 UNAVAILABLE", 503))
    assert is_session_stale_error(E("PERMISSION_DENIED", 403))
    assert not is_session_stale_error(E("prompt unsafe", 400))


def test_atomic_ai_settings(tmp_path, monkeypatch):
    from app.services import ai_settings_store as store

    monkeypatch.setattr(store, "_FILE", tmp_path / "ai_settings.json")
    out = store.save_raw({"enabled": True, "api_key": "sk-test-1234567890", "model": "m"})
    assert out["api_key"] == "sk-test-1234567890"
    # empty key must not wipe
    out2 = store.save_raw({"api_key": ""})
    assert out2["api_key"] == "sk-test-1234567890"
    raw = json.loads((tmp_path / "ai_settings.json").read_text())
    assert raw["model"] == "m"


def test_health_import():
    """Import app factory pieces without binding ports (uvicorn not started)."""
    from app.core.retry import with_retries
    from app.services.session_health import session_health

    session_health.mark_flow_ok()
    p = session_health.payload()
    assert p["flow_session_ok"] is True
    assert callable(with_retries)


@pytest.mark.asyncio
async def test_with_retries_succeeds_second_try():
    from app.core.retry import with_retries

    state = {"n": 0}

    async def flaky():
        state["n"] += 1
        if state["n"] < 2:
            err = Exception("503 busy")
            err.error_code = 503  # type: ignore[attr-defined]
            raise err
        return "ok"

    assert await with_retries(flaky, attempts=3, base_delay=0.01) == "ok"
    assert state["n"] == 2
