"""Tests for G-Labs parity features (prompt hub, frame extract, dashboard bits)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def test_prompt_hub_crud(tmp_path, monkeypatch):
    from app.core import config as cfg
    from app.services import prompt_hub_store as hub

    monkeypatch.setattr(cfg.settings, "data_dir", tmp_path)
    item = hub.create_prompt(title="T1", text="a cat", kind="image", tags=["x"])
    assert item["id"]
    listed = hub.list_prompts(kind="image")
    assert any(p["id"] == item["id"] for p in listed)
    updated = hub.update_prompt(item["id"], {"title": "T2"})
    assert updated and updated["title"] == "T2"
    hub.touch_use(item["id"])
    assert hub.get_prompt(item["id"])["use_count"] == 1
    assert hub.delete_prompt(item["id"]) is True


def test_frame_extract_if_sample_exists():
    import asyncio
    from app.services.frame_extract import extract_frames

    samples = list((ROOT / "data").rglob("*.mp4"))
    if not samples:
        pytest.skip("no sample mp4 in data/")
    frames = asyncio.run(extract_frames(samples[0], positions=["start", "end"]))
    assert len(frames) >= 1
    assert "url" in frames[0]


def test_dashboard_and_prompts_api():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.get("/api/dashboard")
        assert r.status_code == 200
        body = r.json()
        assert "queue" in body
        assert "accounts" in body
        assert "tasks" in body

        r2 = client.post(
            "/api/prompts",
            json={"title": "api", "text": "hello world prompt", "kind": "any"},
        )
        assert r2.status_code == 201
        pid = r2.json()["prompt"]["id"]
        r3 = client.get("/api/prompts")
        assert r3.status_code == 200
        assert any(p["id"] == pid for p in r3.json()["prompts"])
        client.delete(f"/api/prompts/{pid}")


def test_parse_login_job_dict():
    from app.services.login_browser import LoginJob, login_browser_service

    job = LoginJob(job_id="ab12", status="pending", message="x")
    d = login_browser_service.to_dict(job)
    assert d["job_id"] == "ab12"
