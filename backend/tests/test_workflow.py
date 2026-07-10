"""Workflow store + topo runner unit tests (no external gen)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


def test_workflow_store_and_sample(tmp_path, monkeypatch):
    from app.core import config as cfg
    from app.services import workflow_store as store
    from app.services.workflow_runner import _topo_order

    monkeypatch.setattr(cfg.settings, "data_dir", tmp_path)
    sample = store.default_sample()
    doc = store.save_workflow(sample)
    assert doc["id"]
    loaded = store.get_workflow(doc["id"])
    assert loaded and loaded["name"] == sample["name"]
    listed = store.list_workflows()
    assert any(w["id"] == doc["id"] for w in listed)

    order = _topo_order(sample["nodes"], sample["edges"])
    # prompt before generate before video
    assert order.index("n_prompt") < order.index("n_gen")
    assert order.index("n_gen") < order.index("n_video")


def test_workflows_api_list_sample():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        r = client.get("/api/workflows/sample/default")
        assert r.status_code == 200
        wf = r.json()["workflow"]
        assert len(wf["nodes"]) >= 2
        r2 = client.get("/api/workflows")
        assert r2.status_code == 200
