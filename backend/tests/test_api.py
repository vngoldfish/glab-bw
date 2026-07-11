"""API-level tests via FastAPI TestClient (no external network)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    # lifespan starts auth bridge if port free — OK if already in use
    with TestClient(app) as c:
        yield c


def test_health_endpoint(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert "ready_to_generate" in data
    assert "flow_session_ok" in data
    assert "readiness_reasons" in data
    assert "max_concurrent" in data


def test_info_endpoint(client):
    r = client.get("/api/info")
    assert r.status_code == 200
    data = r.json()
    assert "name" in data
    assert "api_key" in data


def test_accounts_list_and_export(client):
    r = client.get("/api/accounts")
    assert r.status_code == 200
    assert "accounts" in r.json()

    r2 = client.get("/api/accounts/export/backup")
    assert r2.status_code == 200
    body = r2.json()
    assert "accounts" in body
    assert body.get("include_secrets") is False
    # no credentials by default
    for a in body["accounts"]:
        assert "credentials" not in a


def test_disk_maintenance(client):
    r = client.get("/api/maintenance/disk")
    assert r.status_code == 200
    data = r.json()
    assert "disk_free_gb" in data
    assert "folders" in data

    r2 = client.post("/api/maintenance/cleanup-outputs?older_than_days=30&dry_run=true")
    assert r2.status_code == 200
    assert r2.json()["dry_run"] is True


def test_extension_status(client):
    r = client.get("/api/extension/status")
    assert r.status_code == 200
    data = r.json()
    assert "connected" in data


def test_batch_async_empty_rejected(client):
    r = client.post("/api/batch/submit-async", json={"items": [], "concurrency": 1})
    assert r.status_code == 400


def test_run_tests_endpoint_self(client):
    """run-tests endpoint should execute subset quickly."""
    # Only smoke file to keep CI/local fast when invoked from full suite
    # (avoid recursive infinite: this test calls endpoint which runs ALL tests)
    # So we unit-test the runner service directly instead — see test_runner_unit.
    from app.services.test_runner import run_tests

    result = run_tests(path="backend/tests/test_smoke.py", quiet=True, timeout_sec=60)
    assert "ok" in result
    assert "summary" in result
    assert result["exit_code"] in (0, 1)  # 0 pass, 1 fail
    if result["ok"]:
        assert result["passed"] >= 1


def test_run_bulk_api(client):
    payload = {
        "project_name": "Test Bulk Project API",
        "boxes": [
            {
                "type": "generate",
                "prompts": "001 cô gái xinh đẹp @char\n002 cô gái đi bộ @char"
            },
            {
                "type": "video_generate",
                "prompts": "001 cô gái ngoảnh lại cười @char"
            }
        ],
        "references": [
            {
                "name": "char",
                "image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            }
        ],
        "model_image": "nano_banana_2_lite",
        "model_video": "veo_31_fast",
        "aspect_ratio": "16:9"
    }
    r = client.post("/api/workflows/run-bulk", json=payload)
    assert r.status_code == 201
    data = r.json()
    assert "run_id" in data
    assert "project_id" in data
    assert data["project_name"] == "Test Bulk Project API"
    assert data["status"] == "running"

