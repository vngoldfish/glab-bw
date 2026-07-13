import asyncio
import logging
import time
import uuid
import httpx
from typing import Any

from app.providers.base import ProviderError

logger = logging.getLogger(__name__)

VIBES_DEFAULT_HOST = "https://vibes.ai"


class MetaClient:
    """REST client wrapper for Meta AI (vibes.ai).
    
    Uses `meta_session` cookie for authentication.
    """

    def __init__(self, session_data: dict[str, Any]) -> None:
        self.session_data = session_data or {}
        self.cookie_raw = self.session_data.get("cookie") or ""
        self.proxy = self.session_data.get("proxy") or ""
        self.host = self.session_data.get("host") or VIBES_DEFAULT_HOST

    def _get_headers(self) -> dict[str, str]:
        headers = {
            "accept": "application/json",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "cookie": self.cookie_raw,
            "origin": self.host,
            "referer": f"{self.host}/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
        }
        return headers

    def _parse_meta_session(self) -> str | None:
        # Search cookie string for meta_session
        for part in self.cookie_raw.split(";"):
            part = part.strip()
            if part.startswith("meta_session="):
                return part.split("=", 1)[1].strip()
        return None

    async def check_token(self) -> dict[str, Any]:
        """Verify cookie format validity locally (bypassing Cloudflare blocks)."""
        token = self._parse_meta_session()
        if not token:
            return {"ok": False, "error": "Thiếu cookie 'meta_session'"}
        
        # Local format validation: meta_session must be at least 20 chars long
        if len(token) < 20:
            return {"ok": False, "error": "Giá trị cookie 'meta_session' quá ngắn hoặc không hợp lệ"}
        
        # Extract user ID mock prefix for display purposes
        user_id = token.split(".")[0] if "." in token else token[:12]
        return {
            "ok": True,
            "user": {
                "id": user_id,
                "email": "meta-user@glabs.local"
            }
        }

    async def _poll_until_done(
        self,
        client: httpx.AsyncClient,
        headers: dict[str, str],
        batch_id: str,
        *,
        content_key: str = "imageUrl",
        timeout: int = 300,
        interval: float = 2.5,
        media_label: str = "ảnh",
    ) -> list[bytes]:
        """Shared poll loop for image and video generation."""
        max_attempts = int(timeout / interval)
        for attempt in range(max_attempts):
            await asyncio.sleep(interval)
            status_res = await client.get(f"{self.host}/api/generation-batches/{batch_id}", headers=headers)
            if status_res.status_code != 200:
                continue

            status_data = status_res.json()
            batch = status_data.get("batch", {})
            is_complete = batch.get("isComplete", False)
            has_error = batch.get("hasError", False)

            if is_complete:
                content = batch.get("content", [])
                outputs: list[bytes] = []
                for item in content:
                    url = item.get(content_key) or item.get("imageUrl")
                    if url:
                        dl_res = await client.get(url, headers=headers)
                        if dl_res.status_code == 200:
                            outputs.append(dl_res.content)
                if outputs:
                    return outputs
                raise ProviderError(f"Vibes AI hoàn thành nhưng không tải được {media_label} kết quả", error_code=500)
            elif has_error:
                raise ProviderError(f"Vibes AI báo lỗi: {batch.get('error') or 'Generation failed'}", error_code=500)

        raise ProviderError(f"Quá thời gian chờ tạo {media_label} từ Vibes AI", error_code=408)

    async def _ensure_project_id(self, client: httpx.AsyncClient, headers: dict) -> str:
        """Get the first available project or create a new one."""
        res = await client.get(f"{self.host}/api/projects?limit=5", headers=headers)
        if res.status_code == 200:
            try:
                data = res.json()
                projects = data.get("projects", [])
                if projects:
                    return projects[0]["id"]
            except Exception:
                pass
        
        # Create a fallback project
        create_res = await client.post(
            f"{self.host}/api/projects",
            headers=headers,
            json={"title": "G-Labs BW"}
        )
        if create_res.status_code != 200:
            raise ProviderError(
                f"Không thể khởi tạo project trên Vibes AI: {create_res.text[:300]}",
                error_code=create_res.status_code
            )
        try:
            return create_res.json()["project"]["id"]
        except Exception as e:
            raise ProviderError(f"Lỗi phân tích project JSON: {e}", error_code=500)

    async def generate_images(
        self,
        prompt: str,
        *,
        model: str = "midjen-base",
        aspect_ratio: str = "1:1",
        count: int = 1,
    ) -> list[bytes]:
        """Generate images via vibes.ai REST API."""
        token = self._parse_meta_session()
        if not token:
            raise ProviderError(
                "Tài khoản Meta chưa có cookie meta_session. Vui lòng xuất cookie từ vibes.ai và dán vào Cài đặt.",
                error_code=401,
            )

        headers = self._get_headers()
        logger.info("Vibes AI generate_images prompt=%s model=%s ratio=%s", prompt[:50], model, aspect_ratio)

        async with httpx.AsyncClient(timeout=180.0, proxy=self.proxy or None) as client:
            try:
                project_id = await self._ensure_project_id(client, headers)
                batch_id = str(uuid.uuid4())
                mg_req_id = f"www-{uuid.uuid4()}"

                config = {
                    "generationType": "t2i",
                    "aspectRatio": aspect_ratio,
                    "imageModel": model,
                    "promptModel": "gemini-2.5-flash"
                }

                payload = {
                    "inputs": [
                        {
                            "type": "variation",
                            "image_prompt": prompt,
                            "original_prompt": prompt,
                            "config": config
                        }
                    ],
                    "config": config,
                    "batchId": batch_id,
                    "mg_request_id": mg_req_id,
                    "projectId": project_id
                }

                # 1) Submit generation request
                res = await client.post(f"{self.host}/api/generate/images", headers=headers, json=payload)
                if res.status_code != 200:
                    try:
                        err_detail = res.json().get("error", {}).get("detail") or res.text[:200]
                    except Exception:
                        err_detail = res.text[:200]
                    raise ProviderError(
                        f"Vibes AI từ chối tạo ảnh (lỗi {res.status_code}): {err_detail}",
                        error_code=res.status_code,
                    )
                
                # 2) Poll for completion
                return await self._poll_until_done(
                    client, headers, batch_id,
                    content_key="imageUrl",
                    timeout=225,
                    interval=2.5,
                    media_label="ảnh",
                )
            except Exception as e:
                if isinstance(e, ProviderError):
                    raise
                raise ProviderError(f"Lỗi gọi Vibes AI: {e}", error_code=500)

    async def generate_video(
        self,
        prompt: str,
        *,
        model: str = "meta-video",
        aspect_ratio: str = "9:16",
    ) -> list[bytes]:
        """Generate video via vibes.ai REST API."""
        token = self._parse_meta_session()
        if not token:
            raise ProviderError(
                "Tài khoản Meta chưa có cookie meta_session. Vui lòng xuất cookie từ vibes.ai và dán vào Cài đặt.",
                error_code=401,
            )

        headers = self._get_headers()
        logger.info("Vibes AI generate_video prompt=%s model=%s ratio=%s", prompt[:50], model, aspect_ratio)

        async with httpx.AsyncClient(timeout=300.0, proxy=self.proxy or None) as client:
            try:
                project_id = await self._ensure_project_id(client, headers)
                batch_id = str(uuid.uuid4())
                mg_req_id = f"www-{uuid.uuid4()}"

                config = {
                    "generationType": "t2v",
                    "aspectRatio": aspect_ratio,
                    "videoModel": model,
                    "resolution": "480p"
                }

                payload = {
                    "inputs": [
                        {
                            "type": "prompt",
                            "value": prompt,
                            "original_prompt": prompt,
                            "config": config
                        }
                    ],
                    "config": config,
                    "batchId": batch_id,
                    "mg_request_id": mg_req_id,
                    "projectId": project_id
                }

                # 1) Submit generation request
                res = await client.post(f"{self.host}/api/generate/videos", headers=headers, json=payload)
                if res.status_code != 200:
                    try:
                        err_detail = res.json().get("error", {}).get("detail") or res.text[:200]
                    except Exception:
                        err_detail = res.text[:200]
                    raise ProviderError(
                        f"Vibes AI từ chối tạo video (lỗi {res.status_code}): {err_detail}",
                        error_code=res.status_code,
                    )
                
                # 2) Poll for completion
                return await self._poll_until_done(
                    client, headers, batch_id,
                    content_key="videoUrl",
                    timeout=450,
                    interval=3.0,
                    media_label="video",
                )
            except Exception as e:
                if isinstance(e, ProviderError):
                    raise
                raise ProviderError(f"Lỗi gọi Vibes AI: {e}", error_code=500)
