import asyncio
import base64
import random
import time
import uuid
from typing import Any
from urllib.parse import urlencode

import httpx

from app.providers.base import ProviderError
from app.services.auth_bridge_access import auth_bridge_access
from app.services.flow_models import (
    FLOW_API_BASE,
    FLOW_API_KEY,
    FLOW_LABS_BASE,
    RECAPTCHA_SITE_KEY,
    UPSCALE_IMAGE,
    UPSCALE_VIDEO,
    resolve_image_aspect,
    resolve_image_model,
    resolve_video_aspect,
    resolve_video_model,
)


def _format_api_error(status_code: int, payload: Any, raw_text: str) -> str:
    if isinstance(payload, dict):
        message = str(payload.get("message") or payload.get("error", {}).get("message") or "")
        status = str(payload.get("status") or payload.get("error", {}).get("status") or "")
        details = payload.get("details") or payload.get("error", {}).get("details") or []
        reasons: list[str] = []
        if isinstance(details, list):
            for item in details:
                if isinstance(item, dict):
                    reason = item.get("reason")
                    if reason:
                        reasons.append(str(reason))

        if "UNSAFE_GENERATION" in " ".join(reasons) or "UNSAFE" in status:
            return "Prompt bị Google chặn (nội dung không an toàn) — hãy sửa lại prompt"
        if status == "INTERNAL" or status_code >= 500:
            return (
                "Google Flow lỗi tạm thời (INTERNAL) — thử lại sau 10–30 giây, "
                "đổi model sang Nano Banana 2 Lite, hoặc refresh cookie Flow"
            )
        if status == "INVALID_ARGUMENT":
            return f"Tham số không hợp lệ — thử model khác hoặc tỷ lệ 1:1. {message}".strip()
        if message:
            return message
    return raw_text[:500] or f"HTTP {status_code}"


class GoogleFlowClient:
    def __init__(self) -> None:
        self.timeout = 120.0
        self.max_image_retries = 3

    def _api_url(self, path: str) -> str:
        query = urlencode({"key": FLOW_API_KEY})
        return f"{FLOW_API_BASE}/{path.lstrip('/')}?{query}"

    def _headers(
        self,
        *,
        access_token: str | None = None,
        session_token: str | None = None,
        project_id: str | None = None,
    ) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Origin": "https://labs.google",
            "Referer": f"https://labs.google/fx/tools/flow/project/{project_id}" if project_id else "https://labs.google/",
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "x-browser-channel": "stable",
            "x-browser-copyright": "Copyright 2026 Google LLC. All Rights Reserved.",
            "x-browser-validation": "MRCPrt/rS3JY47x2Yiz9h3ag4U8=",
            "x-browser-year": "2026",
        }
        if access_token:
            headers["Authorization"] = f"Bearer {access_token}"
        if session_token:
            headers["Cookie"] = f"__Secure-next-auth.session-token={session_token}"
        return headers

    async def _request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json_data: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=timeout or self.timeout) as client:
            response = await client.request(method, url, headers=headers, json=json_data)
        if response.status_code >= 400:
            raw = response.text[:500]
            payload: Any = raw
            try:
                payload = response.json()
                if isinstance(payload, dict) and "error" in payload and isinstance(payload["error"], dict):
                    payload = payload["error"]
            except Exception:
                payload = raw
            detail = _format_api_error(response.status_code, payload, raw)
            raise ProviderError(detail, error_code=response.status_code)
        if not response.content:
            return {}
        return response.json()

    def _session_id(self) -> str:
        return f";{int(time.time() * 1000)}"

    async def _solve_recaptcha(self, action: str) -> str:
        if not auth_bridge_access.is_connected():
            raise ProviderError(
                "Auth Helper chưa kết nối — mở tab labs.google/fx/tools/flow và bật extension",
                error_code=0,
            )
        request = await auth_bridge_access.queue_captcha(site_key=RECAPTCHA_SITE_KEY, action=action)
        solved = await auth_bridge_access.wait_for_captcha(request.request_id, timeout=120.0)
        if not solved.token:
            raise ProviderError(solved.error or "reCAPTCHA solve failed", error_code=403)
        return solved.token

    def _client_context(
        self,
        *,
        project_id: str,
        recaptcha_token: str,
        session_id: str,
        user_paygate_tier: str | None = None,
    ) -> dict[str, Any]:
        context: dict[str, Any] = {
            "recaptchaContext": {
                "token": recaptcha_token,
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
            },
            "sessionId": session_id,
            "projectId": project_id,
            "tool": "PINHOLE",
        }
        if user_paygate_tier:
            context["userPaygateTier"] = user_paygate_tier
        return context

    async def st_to_at(self, session_token: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"{FLOW_LABS_BASE}/auth/session",
            headers=self._headers(session_token=session_token),
            timeout=30.0,
        )

    async def create_project(self, session_token: str, title: str) -> str:
        result = await self._request(
            "POST",
            f"{FLOW_LABS_BASE}/trpc/project.createProject",
            headers=self._headers(session_token=session_token),
            json_data={"json": {"projectTitle": title, "toolName": "PINHOLE"}},
            timeout=30.0,
        )
        project_id = (
            result.get("result", {})
            .get("data", {})
            .get("json", {})
            .get("result", {})
            .get("projectId")
        )
        if not project_id:
            raise ProviderError("Không tạo được project Flow", error_code=500)
        return str(project_id)

    async def generate_image(
        self,
        *,
        access_token: str,
        project_id: str,
        prompt: str,
        model: str,
        aspect_ratio: str,
        user_paygate_tier: str = "PAYGATE_TIER_ONE",
        reference_images: list[Any] | None = None,
        upscale_targets: list[str] | None = None,
        count: int = 1,
    ) -> list[bytes]:
        last_error: ProviderError | None = None
        result: dict[str, Any] | None = None
        image_count = max(1, min(count, 4))
        has_references = bool(reference_images)

        for attempt in range(self.max_image_retries):
            try:
                recaptcha_token = await self._solve_recaptcha("IMAGE_GENERATION")
                session_id = self._session_id()
                client_context = self._client_context(
                    project_id=project_id,
                    recaptcha_token=recaptcha_token,
                    session_id=session_id,
                )
                resolved_aspect = resolve_image_aspect(aspect_ratio, has_references=has_references)
                request_items = []
                for _ in range(image_count):
                    request_item: dict[str, Any] = {
                        "clientContext": client_context,
                        "seed": random.randint(1, 999999),
                        "imageModelName": resolve_image_model(model),
                        "structuredPrompt": {"parts": [{"text": prompt}]},
                        "imageInputs": reference_images or [],
                    }
                    if resolved_aspect:
                        request_item["imageAspectRatio"] = resolved_aspect
                    request_items.append(request_item)
                payload = {
                    "clientContext": client_context,
                    "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
                    "useNewMedia": True,
                    "requests": request_items,
                }
                result = await self._request(
                    "POST",
                    self._api_url(f"projects/{project_id}/flowMedia:batchGenerateImages"),
                    headers=self._headers(access_token=access_token, project_id=project_id),
                    json_data=payload,
                )
                break
            except ProviderError as exc:
                last_error = exc
                retryable = exc.error_code in {403, 500, 502, 503, 504}
                if retryable and attempt < self.max_image_retries - 1:
                    await asyncio.sleep(2 + attempt * 2)
                    continue
                raise

        if result is None:
            raise last_error or ProviderError("Tạo ảnh thất bại", error_code=0)

        images = self._extract_images(result)
        if upscale_targets:
            upscaled: list[bytes] = []
            media_id = self._extract_media_id(result)
            for target in upscale_targets:
                if target not in UPSCALE_IMAGE:
                    continue
                upscaled.append(
                    await self._upscale_image(
                        access_token=access_token,
                        project_id=project_id,
                        media_id=media_id,
                        target=UPSCALE_IMAGE[target],
                        user_paygate_tier=user_paygate_tier,
                    )
                )
            if not upscaled:
                raise ProviderError("Upscale thất bại", error_code=0)
            return upscaled
        return images

    async def _upscale_image(
        self,
        *,
        access_token: str,
        project_id: str,
        media_id: str,
        target: str,
        user_paygate_tier: str,
    ) -> bytes:
        recaptcha_token = await self._solve_recaptcha("IMAGE_GENERATION")
        payload = {
            "mediaId": media_id,
            "targetResolution": target,
            "clientContext": self._client_context(
                project_id=project_id,
                recaptcha_token=recaptcha_token,
                session_id=self._session_id(),
                user_paygate_tier=user_paygate_tier,
            ),
        }
        result = await self._request(
            "POST",
            self._api_url("flow/upsampleImage"),
            headers=self._headers(access_token=access_token, project_id=project_id),
            json_data=payload,
            timeout=180.0,
        )
        encoded = self._find_encoded_image(result)
        if not encoded:
            raise ProviderError(f"Upscale {target} không trả về ảnh", error_code=0)
        return base64.b64decode(encoded)

    async def generate_video(
        self,
        *,
        access_token: str,
        project_id: str,
        prompt: str,
        model: str,
        aspect_ratio: str,
        mode: str = "text_to_video",
        start_media_id: str | None = None,
        end_media_id: str | None = None,
        user_paygate_tier: str = "PAYGATE_TIER_ONE",
        resolution_targets: list[str] | None = None,
    ) -> list[bytes]:
        recaptcha_token = await self._solve_recaptcha("VIDEO_GENERATION")
        session_id = self._session_id()
        client_context = self._client_context(
            project_id=project_id,
            recaptcha_token=recaptcha_token,
            session_id=session_id,
            user_paygate_tier=user_paygate_tier,
        )
        model_key = resolve_video_model(model, aspect_ratio, mode=mode)
        request_data: dict[str, Any] = {
            "aspectRatio": resolve_video_aspect(aspect_ratio),
            "seed": random.randint(1, 99999),
            "textInput": {"prompt": prompt},
            "videoModelKey": model_key,
            "metadata": {"sceneId": str(uuid.uuid4())},
        }
        if mode == "start_image" and start_media_id:
            request_data["startImage"] = {"mediaId": start_media_id}
        if mode == "start_end_image" and start_media_id and end_media_id:
            request_data["startImage"] = {"mediaId": start_media_id}
            request_data["endImage"] = {"mediaId": end_media_id}

        if mode in {"start_image", "start_end_image", "components"}:
            endpoint = "video:batchAsyncGenerateVideoStartImage"
            if mode == "start_end_image":
                endpoint = "video:batchAsyncGenerateVideoStartAndEndImage"
            if mode == "components":
                endpoint = "video:batchAsyncGenerateVideoReferenceImages"
        else:
            endpoint = "video:batchAsyncGenerateVideoText"

        payload = {
            "clientContext": client_context,
            "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
            "requests": [request_data],
            "useV2ModelConfig": True,
        }
        submit = await self._request(
            "POST",
            self._api_url(endpoint),
            headers=self._headers(access_token=access_token, project_id=project_id),
            json_data=payload,
            timeout=60.0,
        )
        operations = submit.get("operations", [])
        if not operations:
            raise ProviderError("Video submit không trả về operation", error_code=500)

        media_name = await self._poll_video(access_token, operations)
        base_video = await self._download_video(access_token, media_name)

        if not resolution_targets:
            return [base_video]

        outputs = [base_video]
        for target in resolution_targets:
            if target not in UPSCALE_VIDEO:
                continue
            resolution, upsampler_key = UPSCALE_VIDEO[target]
            upscaled = await self._upscale_video(
                access_token=access_token,
                project_id=project_id,
                media_id=media_name,
                resolution=resolution,
                upsampler_key=upsampler_key,
                aspect_ratio=aspect_ratio,
                user_paygate_tier=user_paygate_tier,
            )
            outputs.append(upscaled)
        return outputs

    async def _poll_video(self, access_token: str, operations: list[dict[str, Any]]) -> str:
        media_refs = []
        for op in operations:
            name = (
                op.get("operation", {}).get("name")
                or op.get("name")
                or op.get("mediaGenerationId")
            )
            if name:
                media_refs.append({"name": name, "mediaGenerationId": name})

        if not media_refs:
            raise ProviderError("Không có media ref để poll video", error_code=0)

        deadline = time.time() + 600
        while time.time() < deadline:
            result = await self._request(
                "POST",
                self._api_url("video:batchCheckAsyncVideoGenerationStatus"),
                headers=self._headers(access_token=access_token),
                json_data={"media": media_refs},
                timeout=60.0,
            )
            media_items = result.get("media") or result.get("operations") or []
            for item in media_items:
                status = str(item.get("status") or item.get("state") or "").upper()
                if "FAILED" in status or "ERROR" in status:
                    raise ProviderError(f"Video generation failed: {status}", error_code=500)
                if "SUCCESS" in status or "COMPLETE" in status or "DONE" in status:
                    media_name = self._extract_media_name(item)
                    if media_name:
                        return media_name
            await asyncio.sleep(5)
        raise ProviderError("Timeout: video generation chưa hoàn thành", error_code=0)

    async def _upscale_video(
        self,
        *,
        access_token: str,
        project_id: str,
        media_id: str,
        resolution: str,
        upsampler_key: str,
        aspect_ratio: str,
        user_paygate_tier: str,
    ) -> bytes:
        recaptcha_token = await self._solve_recaptcha("VIDEO_GENERATION")
        payload = {
            "clientContext": self._client_context(
                project_id=project_id,
                recaptcha_token=recaptcha_token,
                session_id=self._session_id(),
                user_paygate_tier=user_paygate_tier,
            ),
            "requests": [
                {
                    "aspectRatio": resolve_video_aspect(aspect_ratio),
                    "resolution": resolution,
                    "seed": random.randint(1, 99999),
                    "metadata": {"sceneId": str(uuid.uuid4())},
                    "videoInput": {"mediaId": media_id},
                    "videoModelKey": upsampler_key,
                }
            ],
        }
        submit = await self._request(
            "POST",
            self._api_url("video:batchAsyncGenerateVideoUpsampleVideo"),
            headers=self._headers(access_token=access_token, project_id=project_id),
            json_data=payload,
            timeout=60.0,
        )
        media_name = await self._poll_video(access_token, submit.get("operations", []))
        return await self._download_video(access_token, media_name)

    async def _download_video(self, access_token: str, media_name: str) -> bytes:
        result = await self._request(
            "GET",
            self._api_url(f"media/{media_name}"),
            headers=self._headers(access_token=access_token),
            timeout=180.0,
        )
        video = result.get("video", {})
        generated = video.get("generatedVideo", video)
        encoded = generated.get("encodedVideo") or video.get("encodedVideo")
        if encoded:
            return base64.b64decode(encoded)
        url = generated.get("fifeUrl") or generated.get("videoUrl") or video.get("fifeUrl")
        if url:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                return response.content
        raise ProviderError("Không tải được video từ Google Flow", error_code=0)

    def _extract_uploaded_media_id(self, result: dict[str, Any]) -> str | None:
        media = result.get("media")
        if isinstance(media, dict):
            name = media.get("name")
            if isinstance(name, str) and name:
                return name

        media_generation = result.get("mediaGenerationId")
        if isinstance(media_generation, dict):
            value = media_generation.get("mediaGenerationId")
            if isinstance(value, str) and value:
                return value

        raw_media_id = result.get("mediaId")
        if isinstance(raw_media_id, dict):
            value = raw_media_id.get("mediaId")
            if isinstance(value, str) and value:
                return value
        if isinstance(raw_media_id, str) and raw_media_id:
            return raw_media_id
        return None

    async def upload_image(
        self,
        *,
        access_token: str,
        project_id: str,
        image_bytes: bytes,
        mime_type: str = "image/png",
    ) -> str:
        extension = "png"
        if mime_type == "image/jpeg":
            extension = "jpg"
        elif mime_type == "image/webp":
            extension = "webp"
        payload = {
            "clientContext": {
                "projectId": project_id,
                "tool": "PINHOLE",
            },
            "fileName": f"glabs_{int(time.time() * 1000)}.{extension}",
            "imageBytes": base64.b64encode(image_bytes).decode("utf-8"),
            "isHidden": False,
            "isUserUploaded": True,
            "mimeType": mime_type,
        }
        result = await self._request(
            "POST",
            self._api_url("flow/uploadImage"),
            headers=self._headers(access_token=access_token, project_id=project_id),
            json_data=payload,
            timeout=60.0,
        )
        media_id = self._extract_uploaded_media_id(result)
        if not media_id:
            raise ProviderError("Upload ảnh tham chiếu thất bại", error_code=0)
        return str(media_id)

    def _extract_images(self, result: dict[str, Any]) -> list[bytes]:
        images: list[bytes] = []
        for item in result.get("media", []):
            encoded = self._find_encoded_image(item)
            if encoded:
                images.append(base64.b64decode(encoded))
                continue
            url = self._find_image_url(item)
            if url:
                images.append(self._sync_download(url))
        if not images:
            raise ProviderError("Flow không trả về ảnh", error_code=0)
        return images

    def _extract_media_id(self, result: dict[str, Any]) -> str:
        for item in result.get("media", []):
            media_id = self._extract_media_name(item)
            if media_id:
                return media_id
        raise ProviderError("Không lấy được mediaId từ response ảnh", error_code=0)

    def _extract_media_name(self, item: dict[str, Any]) -> str | None:
        for key in ("name", "mediaGenerationId", "mediaId"):
            value = item.get(key)
            if isinstance(value, str) and value:
                return value
        image = item.get("image", {})
        generated = image.get("generatedImage", {})
        for key in ("mediaId", "name", "mediaGenerationId"):
            value = generated.get(key)
            if isinstance(value, str) and value:
                return value
        operation = item.get("operation", {})
        if isinstance(operation, dict):
            return operation.get("name")
        return None

    def _find_encoded_image(self, item: dict[str, Any]) -> str | None:
        image = item.get("image", {})
        generated = image.get("generatedImage", image)
        for key in ("encodedImage", "imageBytes", "bytesBase64Encoded"):
            value = generated.get(key) or image.get(key) or item.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    def _find_image_url(self, item: dict[str, Any]) -> str | None:
        image = item.get("image", {})
        generated = image.get("generatedImage", image)
        for key in ("fifeUrl", "imageUri", "uri", "url"):
            value = generated.get(key) or image.get(key)
            if isinstance(value, str) and value.startswith("http"):
                return value
        return None

    def _sync_download(self, url: str) -> bytes:
        with httpx.Client(timeout=120.0) as client:
            response = client.get(url)
            response.raise_for_status()
            return response.content


google_flow_client = GoogleFlowClient()