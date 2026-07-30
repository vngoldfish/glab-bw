"""Pytest-compatible tests for Public API v1.

Uses FastAPI TestClient to test authentication, rate limiting,
permissions, and endpoint validation WITHOUT the heavy lifespan
(Auth Bridge, browser pool).
"""
import time
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# Build a minimal app that only mounts v1 routers (no lifespan)
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.api.v1 import router as v1_router, admin_router
from app.services.api_key_store import ApiKeyStore, api_key_store
from app.core.rate_limiter import RateLimiter, rate_limiter


# ── Unit Tests ────────────────────────────────────────────────────────────────

class TestApiKeyStore:
    def setup_method(self):
        self.tmp = Path(tempfile.mkdtemp()) / "test.db"
        self.store = ApiKeyStore(db_path=self.tmp)

    def test_create_and_verify(self):
        kid, rk = self.store.create_key("App", rate_limit=10, daily_quota=100, permissions=["image", "video"])
        assert kid.startswith("glbw_")
        assert rk.startswith("glbw_sk_")
        info = self.store.verify_key(rk)
        assert info is not None
        assert info.name == "App"
        assert info.rate_limit == 10
        assert info.permissions == ["image", "video"]

    def test_invalid_key(self):
        assert self.store.verify_key("glbw_sk_wrong") is None
        assert self.store.verify_key("random") is None
        assert self.store.verify_key("") is None

    def test_update_key(self):
        kid, rk = self.store.create_key("Old")
        self.store.update_key(kid, name="New", rate_limit=99)
        info = self.store.verify_key(rk)
        assert info.name == "New"
        assert info.rate_limit == 99

    def test_revoke_key(self):
        kid, rk = self.store.create_key("Rev")
        self.store.revoke_key(kid)
        assert self.store.verify_key(rk) is None

    def test_delete_key(self):
        kid, rk = self.store.create_key("Del")
        self.store.delete_key(kid)
        assert len(self.store.list_keys()) == 0

    def test_expired_key(self):
        _, rk = self.store.create_key("Exp", expires_at=time.time() - 3600)
        assert self.store.verify_key(rk) is None

    def test_future_key(self):
        _, rk = self.store.create_key("Fut", expires_at=time.time() + 3600)
        assert self.store.verify_key(rk) is not None

    def test_usage_tracking(self):
        kid, _ = self.store.create_key("Usage")
        for i in range(5):
            self.store.record_usage(kid, "/v1/images/generate", "flow", "image",
                                   "completed" if i < 3 else "failed", f"p{i}", f"t{i}")
        assert self.store.get_daily_count(kid) == 5
        assert self.store.get_minute_count(kid) == 5
        sm = self.store.get_usage_summary(kid, 30)
        assert sm[0]["total"] == 5
        assert sm[0]["completed"] == 3


class TestRateLimiter:
    def test_per_minute_limit(self):
        lim = RateLimiter()
        for i in range(3):
            assert lim.check_and_consume("k", 3, 100).allowed
        r = lim.check_and_consume("k", 3, 100)
        assert not r.allowed
        assert r.retry_after > 0
        assert "X-RateLimit-Limit" in r.headers()

    def test_daily_quota(self):
        lim = RateLimiter()
        for i in range(5):
            lim.check_and_consume("k2", 999, 5)
        r = lim.check_and_consume("k2", 999, 5)
        assert not r.allowed
        assert "Daily quota" in r.reason


# ── Endpoint Tests ────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def test_app():
    """Create a minimal FastAPI app with only v1 routers (no lifespan overhead)."""
    from app.core.config import settings
    from fastapi.middleware.cors import CORSMiddleware

    app = FastAPI(title="Test")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.include_router(v1_router)
    app.include_router(admin_router)
    return app


@pytest.fixture(scope="module")
def client(test_app):
    return TestClient(test_app)


@pytest.fixture(scope="module")
def auth_key():
    """Create a test API key and return (key_id, raw_key, headers)."""
    kid, rk = api_key_store.create_key("Test", rate_limit=30, daily_quota=500, permissions=["image", "video", "admin"])
    yield kid, rk, {"Authorization": f"Bearer {rk}"}
    api_key_store.delete_key(kid)


class TestAuth:
    def test_no_auth_401(self, client):
        assert client.get("/v1/models").status_code == 401

    def test_no_auth_post_401(self, client):
        assert client.post("/v1/images/generate", json={"prompt": "x"}).status_code == 401

    def test_wrong_key_401(self, client):
        assert client.get("/v1/models", headers={"Authorization": "Bearer glbw_sk_wrong"}).status_code == 401

    def test_bearer_auth_200(self, client, auth_key):
        _, _, H = auth_key
        assert client.get("/v1/models", headers=H).status_code == 200

    def test_x_api_key_header(self, client, auth_key):
        _, rk, _ = auth_key
        assert client.get("/v1/models", headers={"X-API-Key": rk}).status_code == 200


class TestModelsEndpoint:
    def test_list_models(self, client, auth_key):
        _, _, H = auth_key
        r = client.get("/v1/models", headers=H)
        assert r.status_code == 200
        data = r.json()
        assert "models" in data
        assert len(data["models"]) >= 4  # flow img, flow vid, grok img, grok vid, openai, meta


class TestAdminKeys:
    def test_list_keys(self, client, auth_key):
        _, _, H = auth_key
        r = client.get("/v1/admin/keys", headers=H)
        assert r.status_code == 200
        assert "keys" in r.json()

    def test_create_and_delete_key(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/admin/keys", headers=H, json={"name": "Temp", "permissions": ["image"]})
        assert r.status_code == 200
        data = r.json()
        assert "raw_key" in data
        assert data["name"] == "Temp"

        # Delete
        r = client.delete(f"/v1/admin/keys/{data['key_id']}", headers=H)
        assert r.status_code == 200

    def test_update_key(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/admin/keys", headers=H, json={"name": "Upd"})
        kid = r.json()["key_id"]

        r = client.put(f"/v1/admin/keys/{kid}", headers=H, json={"name": "Renamed", "rate_limit": 99})
        assert r.status_code == 200

        api_key_store.delete_key(kid)


class TestPermissions:
    def test_image_only_key_blocked_on_video(self, client):
        kid, rk = api_key_store.create_key("ImgOnly", permissions=["image"])
        H = {"Authorization": f"Bearer {rk}"}

        assert client.post("/v1/videos/generate", headers=H, json={"prompt": "test"}).status_code == 403
        assert client.post("/v1/videos/from-image", headers=H, json={"prompt": "t", "image": "x.png"}).status_code == 403
        assert client.post("/v1/videos/start-end", headers=H, json={"start_image": "a", "end_image": "b"}).status_code == 403
        assert client.post("/v1/videos/with-references", headers=H, json={"prompt": "t", "reference_images": ["a"]}).status_code == 403

        api_key_store.delete_key(kid)


class TestRateLimitEndpoint:
    def test_rate_limit_enforced(self, client):
        kid, rk = api_key_store.create_key("Rate", rate_limit=3, daily_quota=100, permissions=["image"])
        H = {"Authorization": f"Bearer {rk}"}

        for i in range(3):
            r = client.post("/v1/images/generate", headers=H, json={"prompt": f"t{i}"})
            assert r.status_code != 429, f"Request {i+1} should not be rate limited"

        r = client.post("/v1/images/generate", headers=H, json={"prompt": "over"})
        assert r.status_code == 429
        assert "Retry-After" in r.headers

        api_key_store.delete_key(kid)


class TestUnifiedGenerate:
    def test_invalid_mode(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/generate", headers=H, json={"mode": "bad", "prompt": "x"})
        assert r.status_code == 400
        assert "valid_modes" in r.json()["detail"]

    def test_i2v_missing_image(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/generate", headers=H, json={"mode": "image_to_video", "prompt": "x"})
        assert r.status_code == 400

    def test_start_end_missing_images(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/generate", headers=H, json={"mode": "start_end_video", "prompt": "x"})
        assert r.status_code == 400

    def test_reference_missing_refs(self, client, auth_key):
        _, _, H = auth_key
        r = client.post("/v1/generate", headers=H, json={"mode": "reference_image", "prompt": "x"})
        assert r.status_code == 400


class TestUsageEndpoint:
    def test_usage_returns_data(self, client, auth_key):
        _, _, H = auth_key
        r = client.get("/v1/usage", headers=H)
        assert r.status_code == 200
        data = r.json()
        assert "rate_limit" in data
        assert "daily_quota" in data
        assert "used_today" in data


class TestTasksEndpoint:
    def test_list_tasks(self, client, auth_key):
        _, _, H = auth_key
        r = client.get("/v1/tasks", headers=H)
        assert r.status_code == 200
        assert "tasks" in r.json()

    def test_task_not_found(self, client, auth_key):
        _, _, H = auth_key
        r = client.get("/v1/tasks/nonexistent", headers=H)
        assert r.status_code == 404
