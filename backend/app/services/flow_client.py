import asyncio
import base64
import hashlib
import json
import logging
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
    is_omni_flash_model,
    resolve_video_aspect,
    resolve_video_model_candidates,
)

logger = logging.getLogger(__name__)


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

        joined = " ".join(reasons)
        if "UNSAFE_GENERATION" in joined or "UNSAFE" in status:
            return "Prompt bị Google chặn (nội dung không an toàn) — hãy sửa lại prompt"
        if (
            "recaptcha evaluation failed" in message.lower()
            or "recaptcha" in message.lower()
            and "fail" in message.lower()
        ):
            return (
                "reCAPTCHA bị Google từ chối (evaluation failed). "
                "Làm lần lượt: (1) Focus tab labs.google/fx/tools/flow (đang login đúng tài khoản), "
                "(2) Auth Helper extension xanh + tab Flow = open, "
                "(3) Settings → dán lại cookie __Secure-next-auth.session-token mới từ ĐÚNG tab đó, "
                "(4) F5 tab Flow, đợi 5s, chạy lại 1 video. "
                "Cookie app và tab extension phải cùng 1 tài khoản Google."
            )
        if status == "PERMISSION_DENIED" or "does not have permission" in message.lower():
            return (
                "Google từ chối quyền tạo video (PERMISSION_DENIED). "
                "Nếu Flow web vẫn tạo được: cookie/session trong app có thể cũ hoặc khác tab browser — "
                "mở Settings → dán lại cookie __Secure-next-auth.session-token mới từ labs.google, "
                "giữ tab Flow mở + extension xanh. "
                "Cũng thử model Veo 3.1 Fast + Văn bản→Video trước để kiểm tra auth. "
                f"({message or status})"
            )
        # 429 / quota must be checked BEFORE generic INTERNAL (Google sometimes wraps)
        quota_hit = (
            status_code == 429
            or status == "RESOURCE_EXHAUSTED"
            or "PUBLIC_ERROR_USER_QUOTA_REACHED" in joined
            or "quota" in message.lower()
            or "resource has been exhausted" in message.lower()
        )
        if quota_hit:
            return (
                "Hết quota Google Flow trên account này (USER_QUOTA_REACHED). "
                "Video/model Pro đã dùng hết lượt free trong ngày hoặc gói. "
                "Cách xử lý: (1) thêm account Flow khác trong Cài đặt, "
                "(2) đợi reset quota (thường ~24h), "
                "(3) ảnh: dùng Nano Banana 2 / Lite (Pro hay fail trên free tier). "
                f"({message or status or status_code})"
            )
        if status == "INTERNAL" or (status_code >= 500 and status_code != 503):
            return (
                "Google Flow INTERNAL (model không hỗ trợ account này, payload lệch, hoặc Google lỗi). "
                "Ảnh: chọn Nano Banana 2 / Lite (Pro hay fail free tier). "
                "Video: thử Omni Flash + Văn bản→Video; reload tab Flow + Auth OK; "
                "hoặc thêm account khác nếu hết lượt. "
                f"({message or status or status_code})"
            )
        if status_code == 503 or status == "UNAVAILABLE":
            return (
                "Google Flow đang bận (503 UNAVAILABLE) — đợi 30–60 giây rồi thử lại"
            )
        if status == "INVALID_ARGUMENT":
            return f"Tham số không hợp lệ — thử model khác hoặc tỷ lệ khác. {message}".strip()
        if message:
            return message
    return raw_text[:500] or f"HTTP {status_code}"


class GoogleFlowClient:
    def __init__(self) -> None:
        self.timeout = 120.0
        self.max_image_retries = 3
        self._client: httpx.AsyncClient | None = None

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _api_url(self, path: str) -> str:
        query = urlencode({"key": FLOW_API_KEY})
        return f"{FLOW_API_BASE}/{path.lstrip('/')}?{query}"

    def _headers(
        self,
        *,
        access_token: str | None = None,
        session_token: str | None = None,
        project_id: str | None = None,
        browser_like: bool = False,
    ) -> dict[str, str]:
        # Browser Flow uses text/plain for aisandbox video calls (not application/json)
        content_type = "text/plain;charset=UTF-8" if browser_like else "application/json"
        referer = (
            f"https://labs.google/fx/tools/flow/project/{project_id}"
            if project_id
            else "https://labs.google/fx/tools/flow"
        )
        headers = {
            "Content-Type": content_type,
            "Accept": "*/*",
            "Origin": "https://labs.google",
            "Referer": referer,
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
            "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
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
        browser_like: bool = False,
    ) -> dict[str, Any]:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        client = self._client
        req_timeout = timeout or self.timeout
        if browser_like and json_data is not None:
            # Match browser: JSON body with Content-Type text/plain;charset=UTF-8
            response = await client.request(
                method,
                url,
                headers=headers,
                content=json.dumps(json_data, separators=(",", ":")),
                timeout=req_timeout,
            )
        else:
            response = await client.request(
                method,
                url,
                headers=headers,
                json=json_data,
                timeout=req_timeout,
            )
        if response.status_code >= 400:
            raw = response.text[:800]
            payload: Any = raw
            try:
                payload = response.json()
                if isinstance(payload, dict) and "error" in payload and isinstance(payload["error"], dict):
                    payload = payload["error"]
            except Exception:
                payload = raw
            logger.warning(
                "Flow API %s %s -> %s body=%s",
                method,
                url.split("?")[0],
                response.status_code,
                raw[:300],
            )
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
        bridge_session = auth_bridge_access.get_primary_session()
        if not bridge_session or bridge_session.flow_tab_status != "open":
            raise ProviderError(
                "Tab Flow chưa mở trong Chrome — mở https://labs.google/fx/tools/flow "
                "(login đúng tài khoản cookie trong Settings), đợi Auth = OK / Flow: open",
                error_code=0,
            )

        last_err: str | None = None
        # Fresh token each try — reused/stale tokens → "reCAPTCHA evaluation failed"
        for attempt in range(3):
            request = await auth_bridge_access.queue_captcha(
                site_key=RECAPTCHA_SITE_KEY,
                action=action,
            )
            try:
                solved = await auth_bridge_access.wait_for_captcha(
                    request.request_id,
                    timeout=90.0,
                )
            except TimeoutError:
                last_err = "Hết thời gian chờ reCAPTCHA — reload tab Flow + kiểm tra extension"
                await asyncio.sleep(1.0 + attempt)
                continue
            if solved.error:
                last_err = str(solved.error)
                await asyncio.sleep(0.8 + attempt * 0.5)
                continue
            token = (solved.token or "").strip()
            if len(token) < 20:
                last_err = "reCAPTCHA token rỗng/không hợp lệ"
                await asyncio.sleep(0.8)
                continue
            # Brief pause so token is not evaluated in the same instant as execute()
            await asyncio.sleep(0.35)
            return token

        raise ProviderError(
            last_err or "reCAPTCHA solve failed — reload tab Flow + extension",
            error_code=403,
        )

    def _client_context(
        self,
        *,
        project_id: str,
        recaptcha_token: str,
        session_id: str,
        user_paygate_tier: str | None = None,
    ) -> dict[str, Any]:
        # Field order closer to Flow web / flowkit production
        return {
            "projectId": project_id,
            "tool": "PINHOLE",
            "userPaygateTier": user_paygate_tier or "PAYGATE_TIER_ONE",
            "sessionId": session_id,
            "recaptchaContext": {
                "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB",
                "token": recaptcha_token,
            },
        }

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
        session_token: str | None = None,
    ) -> list[bytes]:
        last_error: ProviderError | None = None
        result: dict[str, Any] | None = None
        image_count = max(1, min(count, 4))
        has_references = bool(reference_images)
        tier = user_paygate_tier or "PAYGATE_TIER_ONE"

        # Free tier often rejects GEM_PIX (Pro) with INTERNAL — fall back to working models
        primary = resolve_image_model(model)
        model_candidates: list[str] = []
        for name in (primary, "GEM_PIX_2", "NARWHAL"):
            if name and name not in model_candidates:
                model_candidates.append(name)

        # Prefer next model over same-model spam when Google returns INTERNAL for Pro/etc.
        attempts_per_model = 2
        for model_idx, model_name in enumerate(model_candidates):
            for attempt in range(attempts_per_model):
                try:
                    recaptcha_token = await self._solve_recaptcha("IMAGE_GENERATION")
                    session_id = self._session_id()
                    client_context = self._client_context(
                        project_id=project_id,
                        recaptcha_token=recaptcha_token,
                        session_id=session_id,
                        user_paygate_tier=tier,
                    )
                    resolved_aspect = resolve_image_aspect(aspect_ratio, has_references=has_references)
                    request_items = []
                    for _ in range(image_count):
                        request_item: dict[str, Any] = {
                            "clientContext": client_context,
                            "seed": random.randint(1, 999999),
                            "imageModelName": model_name,
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
                    logger.info(
                        "Flow image submit model=%s resolved=%s try=%s/%s refs=%s",
                        model,
                        model_name,
                        attempt + 1,
                        attempts_per_model,
                        len(reference_images or []),
                    )
                    result = await self._request(
                        "POST",
                        self._api_url(f"projects/{project_id}/flowMedia:batchGenerateImages"),
                        headers=self._headers(
                            access_token=access_token,
                            session_token=session_token,
                            project_id=project_id,
                        ),
                        json_data=payload,
                    )
                    break  # success for this model
                except ProviderError as exc:
                    last_error = exc
                    msg = str(exc).lower()
                    code = int(exc.error_code or 0)
                    logger.warning(
                        "Flow image model=%s failed try=%s code=%s: %s",
                        model_name,
                        attempt + 1,
                        code,
                        exc,
                    )
                    # Detect real quota only — do NOT match our own advice text ("còn quota")
                    real_quota = (
                        code == 429
                        or "resource_exhausted" in msg
                        or "user_quota" in msg
                        or "hết quota" in msg
                        or "public_error_user_quota" in msg
                        or "resource has been exhausted" in msg
                    )
                    if real_quota:
                        raise
                    # Google free tier: Pro (GEM_PIX) often 500 INTERNAL — try next model
                    can_retry_same = attempt + 1 < attempts_per_model and code in {
                        403,
                        500,
                        502,
                        503,
                        504,
                    }
                    if can_retry_same:
                        await asyncio.sleep(1.2 + attempt)
                        continue
                    if model_idx + 1 < len(model_candidates) and code in {
                        403,
                        500,
                        502,
                        503,
                        504,
                        0,
                    }:
                        logger.warning(
                            "Flow image switch model %s → %s (after %s)",
                            model_name,
                            model_candidates[model_idx + 1],
                            code,
                        )
                        break
                    raise
            if result is not None:
                break

        if result is None:
            raise last_error or ProviderError("Tạo ảnh thất bại", error_code=0)

        images = await self._extract_images(result)
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
        reference_media_ids: list[str] | None = None,
        user_paygate_tier: str = "PAYGATE_TIER_ONE",
        resolution_targets: list[str] | None = None,
        duration: int | None = None,
        session_token: str | None = None,
    ) -> list[bytes]:
        """Submit video generation with careful model-key + payload strategy.

        Lessons from production traffic + logs:
        - Omni (abra_t2v_*s) is the only multi-ref path that matches Flow web Ingredients.
        - Veo keys like veo_3_0_r2v_* frequently return INTERNAL (bad keys / payload) — do NOT
          cascade to them after Omni fails; that rewrites a 403 into a fake INTERNAL message.
        - Veo R2V must NOT send imageUsageType ASSET (causes INTERNAL). Omni does need it.
        """
        active_mode = mode
        if active_mode in {"start_image", "start_end_image", "components"}:
            endpoint = "video:batchAsyncGenerateVideoStartImage"
            if active_mode == "start_end_image":
                endpoint = "video:batchAsyncGenerateVideoStartAndEndImage"
            if active_mode == "components":
                endpoint = "video:batchAsyncGenerateVideoReferenceImages"
        else:
            endpoint = "video:batchAsyncGenerateVideoText"

        omni = is_omni_flash_model(model)
        # First-last frames: ONLY real *_fl Veo keys + StartAndEnd endpoint.
        # Never fall back to I2V silently — that only animates start frame ("chuyển cảnh" fake).
        if active_mode == "start_end_image":
            if not start_media_id or not end_media_id:
                raise ProviderError(
                    "First & Last Frame cần cả startImage và endImage mediaId",
                    error_code=400,
                )
            if start_media_id == end_media_id:
                raise ProviderError(
                    "startImage và endImage trùng mediaId — chọn 2 ảnh khác nhau",
                    error_code=400,
                )
            fl_model = "veo_31_fast" if omni else model
            model_keys = resolve_video_model_candidates(
                fl_model,
                aspect_ratio,
                mode="start_end_image",
                user_paygate_tier=user_paygate_tier,
                duration=duration,
            )
            for key in resolve_video_model_candidates(
                "veo_31_fast",
                aspect_ratio,
                mode="start_end_image",
                user_paygate_tier=user_paygate_tier,
                duration=duration,
            ):
                if key not in model_keys:
                    model_keys.append(key)
            # Hard filter: only keys that encode first-last (_fl)
            model_keys = [k for k in model_keys if "_fl" in k]
            if not model_keys:
                model_keys = (
                    ["veo_3_1_i2v_s_fast_portrait_fl", "veo_3_1_i2v_s_fast_portrait_ultra_fl"]
                    if aspect_ratio == "9:16"
                    else ["veo_3_1_i2v_s_fast_fl", "veo_3_1_i2v_s_fast_ultra_fl"]
                )
            logger.info(
                "FL true first-last keys=%s start=%s… end=%s…",
                model_keys,
                start_media_id[:20],
                end_media_id[:20],
            )
        # Prefer Omni keys for ingredients — only R2V path matching Flow web
        elif active_mode == "components" or omni:
            model_keys = resolve_video_model_candidates(
                "omni_flash" if (omni or model != "veo_31_lite_relaxed") else model,
                aspect_ratio,
                mode=active_mode if active_mode != "components" else "components",
                user_paygate_tier=user_paygate_tier,
                duration=duration,
            )
            # T2V/I2V with explicit Veo selection: also try that family's keys
            if not omni and active_mode != "components":
                for key in resolve_video_model_candidates(
                    model,
                    aspect_ratio,
                    mode=active_mode,
                    user_paygate_tier=user_paygate_tier,
                    duration=duration,
                ):
                    if key not in model_keys:
                        model_keys.append(key)
        else:
            model_keys = resolve_video_model_candidates(
                model,
                aspect_ratio,
                mode=active_mode,
                user_paygate_tier=user_paygate_tier,
                duration=duration,
            )

        last_error: ProviderError | None = None
        submit: dict[str, Any] | None = None
        used_key = model_keys[0]
        tier = user_paygate_tier or "PAYGATE_TIER_ONE"

        async def _submit_once(
            *,
            model_key: str,
            mode_name: str,
            ep: str,
            start_id: str | None,
            end_id: str | None,
            ref_ids: list[str] | None,
            browser_like: bool,
            use_v2_config: bool = True,
        ) -> dict[str, Any]:
            recaptcha_token = await self._solve_recaptcha("VIDEO_GENERATION")
            if not recaptcha_token or len(recaptcha_token) < 20:
                raise ProviderError("reCAPTCHA token rỗng/không hợp lệ — reload tab Flow", error_code=403)

            use_omni_payload = model_key.startswith("abra_")
            session_id = self._session_id()
            client_context = self._client_context(
                project_id=project_id,
                recaptcha_token=recaptcha_token,
                session_id=session_id,
                user_paygate_tier=tier,
            )

            if use_omni_payload:
                text_input: dict[str, Any] = {
                    "structuredPrompt": {"parts": [{"text": prompt}]},
                }
                metadata: dict[str, Any] = {}
            else:
                # Veo FL/I2V: plain prompt + sceneId
                text_input = {"prompt": prompt}
                metadata = {"sceneId": str(uuid.uuid4())}

            request_data: dict[str, Any] = {
                "aspectRatio": resolve_video_aspect(aspect_ratio),
                "seed": random.randint(1, 9999 if use_omni_payload else 99999),
                "textInput": text_input,
                "videoModelKey": model_key,
                "metadata": metadata,
            }
            if mode_name == "start_image" and start_id:
                request_data["startImage"] = {"mediaId": start_id}
            if mode_name == "start_end_image" and start_id and end_id:
                request_data["startImage"] = {"mediaId": start_id}
                request_data["endImage"] = {"mediaId": end_id}
            if mode_name == "components" and ref_ids:
                if use_omni_payload:
                    request_data["referenceImages"] = [
                        {
                            "mediaId": media_id,
                            "imageUsageType": "IMAGE_USAGE_TYPE_ASSET",
                        }
                        for media_id in ref_ids
                    ]
                else:
                    # Veo: mediaId only — ASSET type often yields INTERNAL
                    request_data["referenceImages"] = [
                        {"mediaId": media_id} for media_id in ref_ids
                    ]

            # First-last: match production Flow payload (clientContext + requests only).
            # Extra mediaGenerationContext / useV2 can make Google treat it like a weaker I2V.
            if mode_name == "start_end_image":
                payload = {
                    "clientContext": client_context,
                    "requests": [request_data],
                }
            else:
                payload = {
                    "mediaGenerationContext": {"batchId": str(uuid.uuid4())},
                    "clientContext": client_context,
                    "requests": [request_data],
                }
                if use_v2_config:
                    payload["useV2ModelConfig"] = True
            logger.info(
                "Flow video submit mode=%s model_key=%s ep=%s start=%s end=%s refs=%s v2=%s browser_like=%s",
                mode_name,
                model_key,
                ep,
                bool(start_id),
                bool(end_id),
                len(ref_ids or []),
                use_v2_config if mode_name != "start_end_image" else False,
                browser_like,
            )
            return await self._request(
                "POST",
                self._api_url(ep),
                headers=self._headers(
                    access_token=access_token,
                    session_token=session_token,
                    project_id=project_id,
                    browser_like=browser_like,
                ),
                json_data=payload,
                timeout=90.0,
                browser_like=browser_like,
            )

        def _ops_from_submit(submit_body: dict[str, Any]) -> list[dict[str, Any]]:
            operations = submit_body.get("operations", [])
            if operations:
                return operations
            # Omni Flash sometimes returns media[] immediately instead of operations[]
            media_list = submit_body.get("media") or []
            ops: list[dict[str, Any]] = []
            for item in media_list:
                if not isinstance(item, dict):
                    continue
                name = item.get("name") or item.get("mediaGenerationId")
                if name:
                    ops.append(
                        {
                            "operation": {"name": name},
                            "mediaGenerationId": name,
                            "name": name,
                        }
                    )
            return ops

        async def _submit_and_poll(
            *,
            model_key: str,
            mode_name: str,
            ep: str,
            start_id: str | None,
            end_id: str | None,
            ref_ids: list[str] | None,
            browser_like: bool,
            use_v2_config: bool = True,
        ) -> str:
            nonlocal submit, used_key
            submit = await _submit_once(
                model_key=model_key,
                mode_name=mode_name,
                ep=ep,
                start_id=start_id,
                end_id=end_id,
                ref_ids=ref_ids,
                browser_like=browser_like,
                use_v2_config=use_v2_config,
            )
            used_key = model_key
            operations = _ops_from_submit(submit)
            if not operations:
                raise ProviderError(
                    f"Video submit không trả về operation (model={model_key})",
                    error_code=500,
                )
            return await self._poll_video(
                access_token,
                operations,
                project_id=project_id,
                session_token=session_token,
            )

        media_name: str | None = None

        # --- Primary attempts: submit+poll per model key ---
        # Critical for FL: wrong *_fl / tier key often submits OK then poll FAILED.
        for key_index, model_key in enumerate(model_keys):
            for attempt in range(3):
                try:
                    # Always browser-like for video — JSON content-type often triggers
                    # "reCAPTCHA evaluation failed" / PERMISSION_DENIED.
                    browser_like = True
                    # FL attempt 2: drop useV2ModelConfig (some accounts need this)
                    # Lite/relaxed models must not use V2 Model Config (legacy API wrappers)
                    use_v2 = (
                        not (active_mode == "start_end_image" and attempt >= 1)
                        and "veo_3_1" in model_key
                    )
                    media_name = await _submit_and_poll(
                        model_key=model_key,
                        mode_name=active_mode,
                        ep=endpoint,
                        start_id=start_media_id,
                        end_id=end_media_id,
                        ref_ids=list(reference_media_ids or []),
                        browser_like=browser_like,
                        use_v2_config=use_v2,
                    )
                    break
                except ProviderError as exc:
                    last_error = exc
                    msg = str(exc).lower()
                    captcha_fail = "recaptcha" in msg
                    quota_hit = (
                        exc.error_code == 429
                        or "resource_exhausted" in msg
                        or "user_quota" in msg
                        or "hết quota" in msg
                        or "public_error_user_quota" in msg
                        or "resource has been exhausted" in msg
                    )
                    logger.warning(
                        "Flow video failed mode=%s model_key=%s attempt=%s: %s",
                        active_mode,
                        model_key,
                        attempt + 1,
                        exc,
                    )
                    # Out of credits — stop trying other keys (avoids fake INTERNAL spam)
                    if quota_hit and active_mode != "components":
                        raise ProviderError(
                            str(exc),
                            error_code=429,
                        ) from exc
                    retryable = (
                        exc.error_code in {403, 500, 502, 503, 504}
                        or "internal" in msg
                        or "unavailable" in msg
                        or "permission" in msg
                        or "tạm thời" in msg
                        or "failed" in msg
                        or "media_generation" in msg
                        or captcha_fail
                    )
                    if retryable and attempt < 2:
                        # Fresh reCAPTCHA each _submit_once; wait longer after captcha fail
                        await asyncio.sleep(
                            (4 + attempt * 4) if captcha_fail else (2 + attempt * 3 + key_index)
                        )
                        continue
                    break
            if media_name is not None:
                break

        # --- Graceful fallback for multi-ref R2V: animate first frame (I2V) ---
        if (
            media_name is None
            and active_mode == "components"
            and reference_media_ids
        ):
            logger.warning(
                "R2V failed for all keys — falling back to I2V with first reference image"
            )
            i2v_keys = resolve_video_model_candidates(
                "omni_flash" if omni else model,
                aspect_ratio,
                mode="start_image",
                user_paygate_tier=tier,
                duration=duration,
            )
            for key in resolve_video_model_candidates(
                "omni_flash",
                aspect_ratio,
                mode="start_image",
                user_paygate_tier=tier,
                duration=duration,
            ):
                if key not in i2v_keys:
                    i2v_keys.append(key)

            for model_key in i2v_keys[:4]:
                try:
                    media_name = await _submit_and_poll(
                        model_key=model_key,
                        mode_name="start_image",
                        ep="video:batchAsyncGenerateVideoStartImage",
                        start_id=reference_media_ids[0],
                        end_id=None,
                        ref_ids=None,
                        browser_like=True,
                    )
                    used_key = model_key
                    active_mode = "start_image"
                    logger.info("I2V fallback succeeded with model_key=%s", model_key)
                    break
                except ProviderError as exc:
                    last_error = exc
                    logger.warning("I2V fallback failed model_key=%s: %s", model_key, exc)
                    await asyncio.sleep(2)

        # --- Last resort for Ingredients only: pure T2V (never for true FL) ---
        if media_name is None and active_mode == "components":
            logger.warning("I2V fallback failed — last resort pure T2V without references")
            t2v_keys = resolve_video_model_candidates(
                model,
                aspect_ratio,
                mode="text_to_video",
                user_paygate_tier=tier,
                duration=duration,
            )
            for key in resolve_video_model_candidates(
                "omni_flash",
                aspect_ratio,
                mode="text_to_video",
                user_paygate_tier=tier,
                duration=duration,
            ):
                if key not in t2v_keys:
                    t2v_keys.append(key)
            for model_key in t2v_keys[:4]:
                try:
                    media_name = await _submit_and_poll(
                        model_key=model_key,
                        mode_name="text_to_video",
                        ep="video:batchAsyncGenerateVideoText",
                        start_id=None,
                        end_id=None,
                        ref_ids=None,
                        browser_like=True,
                    )
                    used_key = model_key
                    active_mode = "text_to_video"
                    break
                except ProviderError as exc:
                    last_error = exc
                    await asyncio.sleep(2)

        if media_name is None:
            err = last_error or ProviderError("Tạo video thất bại", error_code=0)
            if active_mode == "start_end_image":
                raise ProviderError(
                    "First & Last Frame thất bại — không fallback I2V (tránh video chỉ animate ảnh đầu). "
                    "Cần: 2 ảnh khác nhau cùng tỷ lệ, model Veo 3.1 Fast, prompt mô tả chuyển động "
                    "giữa 2 khung (không phải cắt cảnh). "
                    f"Chi tiết: {err}",
                    error_code=getattr(err, "error_code", 500) or 500,
                )
            raise err

        if active_mode == "start_end_image" and "_fl" not in used_key:
            raise ProviderError(
                f"Internal: FL chạy với key không phải first-last ({used_key})",
                error_code=500,
            )
        logger.info(
            "Video done mode=%s model_key=%s media=%s…",
            active_mode,
            used_key,
            str(media_name)[:24],
        )

        base_video = await self._download_video(
            access_token,
            media_name,
            session_token=session_token,
        )

        try:
            from app.services.credit_store import track_run
            track_run(used_key)
        except Exception:
            logger.exception("Failed to track model credit usage")

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
                session_token=session_token,
            )
            outputs.append(upscaled)
        return outputs

    async def _poll_video(
        self,
        access_token: str,
        operations: list[dict[str, Any]],
        *,
        project_id: str | None = None,
        session_token: str | None = None,
    ) -> str:
        media_refs = []
        for op in operations:
            name = (
                op.get("operation", {}).get("name")
                or op.get("name")
                or op.get("mediaGenerationId")
            )
            if name:
                # API only accepts name (+ optional projectId). mediaGenerationId is rejected.
                ref: dict[str, Any] = {"name": name}
                if project_id:
                    ref["projectId"] = project_id
                media_refs.append(ref)

        if not media_refs:
            raise ProviderError("Không có media ref để poll video", error_code=0)

        deadline = time.time() + 600
        current_access_token = access_token
        while time.time() < deadline:
            try:
                result = await self._request(
                    "POST",
                    self._api_url("video:batchCheckAsyncVideoGenerationStatus"),
                    headers=self._headers(
                        access_token=current_access_token,
                        session_token=session_token,
                        project_id=project_id,
                        browser_like=True,
                    ),
                    json_data={"media": media_refs},
                    timeout=60.0,
                    browser_like=True,
                )
            except ProviderError as exc:
                if exc.error_code in (401, 403) and session_token:
                    logger.info("Access token expired during video polling. Refreshing...")
                    try:
                        session = await self.st_to_at(session_token)
                        new_at = session.get("access_token")
                        if new_at:
                            current_access_token = new_at
                            continue
                    except Exception as refresh_exc:
                        logger.error("Failed to refresh access token during polling: %s", refresh_exc)
                raise
            media_items = result.get("media") or result.get("operations") or []
            for item in media_items:
                # Nested status under mediaMetadata.mediaStatus (Omni) or top-level
                nested = (
                    item.get("mediaMetadata", {}).get("mediaStatus", {})
                    if isinstance(item.get("mediaMetadata"), dict)
                    else {}
                )
                status = str(
                    nested.get("mediaGenerationStatus")
                    or item.get("status")
                    or item.get("state")
                    or ""
                ).upper()
                if "FAILED" in status or "ERROR" in status or "BLOCKED" in status:
                    detail_bits: list[str] = [status]
                    for key in (
                        "publicError",
                        "error",
                        "statusMessage",
                        "failureReason",
                        "detailedStatus",
                        "message",
                    ):
                        val = nested.get(key) if isinstance(nested, dict) else None
                        if val is None:
                            val = item.get(key)
                        if val:
                            detail_bits.append(str(val)[:300])
                    # Log full item once for debugging FL failures
                    logger.warning("Video poll failed status item=%s", item)
                    raise ProviderError(
                        "Video generation failed: " + " | ".join(detail_bits),
                        error_code=500,
                    )
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
        session_token: str | None = None,
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
        media_name = await self._poll_video(
            access_token,
            submit.get("operations", []),
            project_id=project_id,
            session_token=session_token,
        )
        return await self._download_video(access_token, media_name, session_token=session_token)

    async def _download_video(
        self,
        access_token: str,
        media_name: str,
        *,
        session_token: str | None = None,
    ) -> bytes:
        result = await self._request(
            "GET",
            self._api_url(f"media/{media_name}"),
            headers=self._headers(
                access_token=access_token,
                session_token=session_token,
                browser_like=True,
            ),
            timeout=180.0,
            browser_like=True,
        )
        video = result.get("video", {})
        generated = video.get("generatedVideo", video)
        encoded = generated.get("encodedVideo") or video.get("encodedVideo")
        if encoded:
            return base64.b64decode(encoded)
        url = generated.get("fifeUrl") or generated.get("videoUrl") or video.get("fifeUrl")
        if url:
            if self._client is None:
                self._client = httpx.AsyncClient(timeout=self.timeout)
            response = await self._client.get(url, timeout=180.0)
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
        hidden: bool = True,
    ) -> str:
        extension = "png"
        if mime_type == "image/jpeg":
            extension = "jpg"
        elif mime_type == "image/webp":
            extension = "webp"
        # Stable name from content so Flow project is easier to read / dedupe mentally
        digest = hashlib.sha256(image_bytes).hexdigest()[:12]
        payload = {
            "clientContext": {
                "projectId": project_id,
                "tool": "PINHOLE",
            },
            "fileName": f"glabs_ref_{digest}.{extension}",
            "imageBytes": base64.b64encode(image_bytes).decode("utf-8"),
            # Keep visible by default — hidden media can cause PERMISSION_DENIED on video gen
            "isHidden": bool(hidden),
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

    async def _extract_images(self, result: dict[str, Any]) -> list[bytes]:
        images: list[bytes] = []
        for item in result.get("media", []):
            encoded = self._find_encoded_image(item)
            if encoded:
                images.append(base64.b64decode(encoded))
                continue
            url = self._find_image_url(item)
            if url:
                images.append(await self._async_download(url))
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

    async def _async_download(self, url: str) -> bytes:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        response = await self._client.get(url, timeout=120.0)
        response.raise_for_status()
        return response.content


google_flow_client = GoogleFlowClient()