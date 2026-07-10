"""Grok provider — cookie (grok.com web) first, optional xAI API key fallback."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from typing import Any

import httpx

from app.providers.base import BaseProvider, ProviderError
from app.services.grok_web_client import GrokWebClient

logger = logging.getLogger(__name__)

XAI_BASE = "https://api.x.ai/v1"

DEFAULT_IMAGE_MODEL = "grok-imagine-image"
DEFAULT_IMAGE_MODEL_QUALITY = "grok-imagine-image-quality"
DEFAULT_VIDEO_MODEL = "grok-imagine-video"
DEFAULT_VIDEO_MODEL_15 = "grok-imagine-video-1.5"

IMAGE_MODELS = {
    "grok_imagine": DEFAULT_IMAGE_MODEL,
    "grok_imagine_image": DEFAULT_IMAGE_MODEL,
    "grok-imagine-image": DEFAULT_IMAGE_MODEL,
    "grok_imagine_quality": DEFAULT_IMAGE_MODEL_QUALITY,
    "grok_imagine_image_quality": DEFAULT_IMAGE_MODEL_QUALITY,
    "grok-imagine-image-quality": DEFAULT_IMAGE_MODEL_QUALITY,
    "grok-3": "grok-3",
    "grok3": "grok-3",
}

VIDEO_MODELS = {
    "grok_imagine_video": DEFAULT_VIDEO_MODEL,
    "grok-imagine-video": DEFAULT_VIDEO_MODEL,
    "grok_imagine_video_15": DEFAULT_VIDEO_MODEL_15,
    "grok_imagine_video_1_5": DEFAULT_VIDEO_MODEL_15,
    "grok-imagine-video-1.5": DEFAULT_VIDEO_MODEL_15,
    "grok-3": "grok-3",
}


def _resolve_image_model(model: str | None) -> str:
    key = str(model or "").strip()
    if not key:
        return DEFAULT_IMAGE_MODEL
    return IMAGE_MODELS.get(key, IMAGE_MODELS.get(key.replace("-", "_"), key))


def _resolve_video_model(model: str | None) -> str:
    key = str(model or "").strip()
    if not key:
        return DEFAULT_VIDEO_MODEL
    return VIDEO_MODELS.get(key, VIDEO_MODELS.get(key.replace("-", "_"), key))


def _data_uri_from_ref(item: Any) -> str | None:
    if item is None:
        return None
    if isinstance(item, dict):
        data = item.get("data") or item.get("image") or item.get("url") or ""
        return _data_uri_from_ref(data)
    text = str(item).strip()
    if not text:
        return None
    if text.startswith("http://") or text.startswith("https://") or text.startswith("data:"):
        return text
    return f"data:image/png;base64,{text}"


class GrokProvider(BaseProvider):
    name = "grok"

    def __init__(
        self,
        session_data: dict[str, str] | None = None,
        api_key: str | None = None,
    ) -> None:
        self.session_data = dict(session_data or {})
        key = (api_key or self.session_data.get("api_key") or "").strip()
        self.api_key = key
        self.timeout = 120.0
        self.video_poll_interval = 4.0
        self.video_poll_timeout = 600.0

    def _has_cookie(self) -> bool:
        return bool(
            self.session_data.get("sso")
            or self.session_data.get("cookie")
            or self.session_data.get("auth_mode") == "cookie"
        )

    def _auth_mode(self) -> str:
        if self._has_cookie():
            return "cookie"
        if self.api_key:
            return "api_key"
        return "none"

    # ── Cookie / web path ────────────────────────────────────────────

    async def _gen_image_web(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        client = GrokWebClient(self.session_data)
        model = str(params.get("model") or "grok-3")
        count = max(1, min(int(params.get("count") or params.get("n") or 2), 4))
        aspect = str(
            params.get("aspect_ratio")
            or params.get("aspectRatio")
            or params.get("ratio")
            or "2:3"
        )
        return await client.generate_images(
            prompt, model=model, count=count, aspect_ratio=aspect
        )

    async def _gen_video_web(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        client = GrokWebClient(self.session_data)
        model = str(params.get("model") or "grok-3")
        aspect = str(
            params.get("aspect_ratio")
            or params.get("aspectRatio")
            or params.get("ratio")
            or "16:9"
        )
        length = params.get("video_length") or params.get("duration") or 6
        try:
            length_i = int(length)
        except (TypeError, ValueError):
            length_i = 6
        resolution = params.get("resolution") or "480p"
        mode = str(params.get("mode") or "t2v").lower()
        refs = (
            params.get("reference_images")
            or params.get("named_references")
            or params.get("named_refs")
            or []
        )
        if not isinstance(refs, list):
            refs = []
        return await client.generate_videos(
            prompt,
            model=model,
            aspect_ratio=aspect,
            video_length=length_i,
            resolution=str(resolution) if not isinstance(resolution, list) else resolution,
            mode=mode,
            reference_images=refs,
        )

    # ── Official xAI API path (optional) ─────────────────────────────

    def _api_headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ProviderError("Thiếu xAI API key", error_code=400)
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def _download(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.get(url)
            res.raise_for_status()
            return res.content

    def _format_error(self, status: int, body: Any) -> str:
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = err.get("message") or err.get("code") or str(err)
            else:
                msg = body.get("message") or str(body)[:400]
        else:
            msg = str(body)[:400]
        if status == 401:
            return f"xAI API key không hợp lệ (401). {msg}"
        if status == 403:
            return f"xAI từ chối quyền (403). {msg}"
        if status == 429:
            return f"xAI rate limit / hết credit (429). {msg}"
        return f"xAI HTTP {status}: {msg}"

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        json_data: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        url = f"{XAI_BASE}{path}" if path.startswith("/") else path
        async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
            res = await client.request(
                method,
                url,
                headers=self._api_headers(),
                json=json_data,
            )
        try:
            body: Any = res.json() if res.content else {}
        except Exception:
            body = res.text[:500]
        if res.status_code >= 400:
            raise ProviderError(self._format_error(res.status_code, body), error_code=res.status_code)
        if not isinstance(body, dict):
            raise ProviderError(f"xAI trả về không phải JSON: {body!r}"[:300], error_code=502)
        return body

    async def _gen_image_api(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        model = _resolve_image_model(params.get("model"))
        # web model names are not valid for API
        if model in {"grok-3", "grok-4"}:
            model = DEFAULT_IMAGE_MODEL
        aspect = str(params.get("aspect_ratio") or "1:1")
        n = max(1, min(int(params.get("count") or params.get("n") or 1), 10))
        resolution = str(params.get("resolution") or "1k").lower()
        if resolution not in {"1k", "2k"}:
            resolution = "1k"
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "n": n,
            "response_format": "b64_json",
            "aspect_ratio": aspect if aspect != "auto" else "auto",
            "resolution": resolution,
        }
        result = await self._request_json("POST", "/images/generations", json_data=payload, timeout=180.0)
        images: list[bytes] = []
        for item in result.get("data") or []:
            if not isinstance(item, dict):
                continue
            b64 = item.get("b64_json") or item.get("b64")
            if b64:
                images.append(base64.b64decode(b64))
            elif item.get("url"):
                images.append(await self._download(str(item["url"])))
        if not images:
            raise ProviderError("Grok API không trả về ảnh", error_code=502)
        return images

    async def _gen_video_api(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        model = _resolve_video_model(params.get("model"))
        if model in {"grok-3", "grok-4"}:
            model = DEFAULT_VIDEO_MODEL
        aspect = str(params.get("aspect_ratio") or "16:9")
        duration = int(params.get("video_length") or params.get("duration") or 6)
        duration = max(1, min(duration, 15))
        resolution = str(params.get("resolution") or "480p")
        if isinstance(params.get("resolution"), list) and params["resolution"]:
            resolution = str(params["resolution"][0])
        if resolution not in {"480p", "720p", "1080p"}:
            resolution = "480p"
        payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "duration": duration,
            "aspect_ratio": aspect,
            "resolution": resolution,
        }
        mode = str(params.get("mode") or "t2v").lower()
        refs = params.get("reference_images") or params.get("named_references") or []
        start = params.get("start_image") or params.get("startFrameImage")
        image_url = _data_uri_from_ref(start) if start else None
        if (
            not image_url
            and isinstance(refs, list)
            and refs
            and mode in {"i2v", "start_image", "image_to_video"}
        ):
            image_url = _data_uri_from_ref(refs[0])
        if image_url:
            payload["image"] = {"url": image_url}

        start_res = await self._request_json("POST", "/videos/generations", json_data=payload, timeout=60.0)
        request_id = start_res.get("request_id") or start_res.get("id")
        if not request_id:
            video = start_res.get("video") or {}
            url = video.get("url") if isinstance(video, dict) else None
            if url:
                return [await self._download(str(url))]
            raise ProviderError(f"Grok video không trả request_id: {start_res}", error_code=502)

        deadline = time.monotonic() + self.video_poll_timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(self.video_poll_interval)
            status_body = await self._request_json("GET", f"/videos/{request_id}", timeout=30.0)
            status = str(status_body.get("status") or "").lower()
            if status in {"done", "completed", "succeeded", "success"}:
                video = status_body.get("video") or {}
                url = video.get("url") if isinstance(video, dict) else None
                url = url or status_body.get("url")
                if not url:
                    raise ProviderError(f"Grok video xong nhưng thiếu URL: {status_body}", error_code=502)
                return [await self._download(str(url))]
            if status in {"failed", "expired", "error"}:
                err = status_body.get("error") or {}
                msg = err.get("message") if isinstance(err, dict) else status_body.get("message")
                raise ProviderError(f"Grok video {status}: {msg or status_body}", error_code=502)
        raise ProviderError(
            f"Grok video timeout sau {int(self.video_poll_timeout)}s (request_id={request_id})",
            error_code=504,
        )

    # ── Public ───────────────────────────────────────────────────────

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        mode = self._auth_mode()
        # Flow-like cookie path even without stored cookie if extension has live session
        if mode == "cookie" or mode == "none":
            try:
                # Empty credentials still OK — extension uses browser cookies
                if mode == "none":
                    self.session_data = {**self.session_data, "auth_mode": "cookie", "sso": "browser"}
                return await self._gen_image_web(prompt, params)
            except ProviderError as exc:
                if self.api_key:
                    logger.warning("Grok web image failed (%s) — try API key", exc)
                    return await self._gen_image_api(prompt, params)
                raise
        if mode == "api_key":
            return await self._gen_image_api(prompt, params)
        raise ProviderError(
            "Chưa sẵn sàng Grok — cài extension-grok + mở tab grok.com/imagine, "
            "hoặc dán cookie / xAI API key trong Cài đặt.",
            error_code=0,
        )

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        mode = self._auth_mode()
        # Cookie / extension tab (same as image — Auth Helper + grok.com/imagine)
        if mode in {"cookie", "none"}:
            try:
                if mode == "none":
                    self.session_data = {
                        **self.session_data,
                        "auth_mode": "cookie",
                        "sso": "browser",
                    }
                return await self._gen_video_web(prompt, params)
            except ProviderError as exc:
                if self.api_key:
                    logger.warning("Grok web video failed (%s) — try API key", exc)
                    return await self._gen_video_api(prompt, params)
                raise
        if mode == "api_key":
            return await self._gen_video_api(prompt, params)
        raise ProviderError(
            "Chưa sẵn sàng Grok video — mở https://grok.com/imagine + Auth Helper, "
            "hoặc dán cookie / xAI API key trong Cài đặt.",
            error_code=0,
        )
