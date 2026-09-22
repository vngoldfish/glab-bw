"""
Gemini Interactions API client — video generation with multimodal input.

Uses the same OAuth access_token from the browser extension/auth bridge
to call generativelanguage.googleapis.com Interactions API directly.
Supports video + image + text prompt as input → generates new video.
"""
import asyncio
import base64
import hashlib
import json
import logging
import time
from typing import Any

import httpx

from app.providers.base import ProviderError

logger = logging.getLogger(__name__)

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL_ID = "gemini-omni-flash-preview"


class GeminiVideoClient:
    """Thin async client for Gemini Interactions API video generation."""

    def __init__(self, timeout: float = 300.0):
        self.timeout = timeout
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
            )
        return self._client

    async def generate_video_from_references(
        self,
        *,
        access_token: str,
        prompt: str,
        reference_image: bytes | None = None,
        reference_image_mime: str = "image/png",
        reference_video: bytes | None = None,
        reference_video_mime: str = "video/mp4",
        model: str = MODEL_ID,
    ) -> bytes:
        """
        Generate a video using Gemini Omni Flash Interactions API.

        Sends image + video + text prompt → model generates video with character
        from image performing the motion/dance from video.

        Args:
            access_token: OAuth access token from Flow session (extension/auth bridge)
            prompt: Text description of what to generate
            reference_image: Character/subject image bytes
            reference_image_mime: MIME type of image
            reference_video: Motion/dance reference video bytes
            reference_video_mime: MIME type of video
            model: Model ID (default: gemini-omni-flash-preview)

        Returns:
            Generated video bytes (MP4)
        """
        client = self._get_client()

        # Build multimodal input parts
        parts: list[dict[str, Any]] = []

        # Add reference image
        if reference_image:
            parts.append({
                "inlineData": {
                    "mimeType": reference_image_mime,
                    "data": base64.b64encode(reference_image).decode("utf-8"),
                }
            })
            parts.append({"text": "This is the character/subject image. "})

        # Add reference video
        if reference_video:
            parts.append({
                "inlineData": {
                    "mimeType": reference_video_mime,
                    "data": base64.b64encode(reference_video).decode("utf-8"),
                }
            })
            parts.append({"text": "This is the reference motion/dance video. "})

        # Add text prompt
        parts.append({"text": prompt})

        # Build request payload for Interactions API
        payload = {
            "model": f"models/{model}",
            "generationConfig": {
                "responseModalities": ["VIDEO"],
            },
            "contents": [
                {
                    "role": "user",
                    "parts": parts,
                }
            ],
        }

        url = f"{GEMINI_API_BASE}/models/{model}:generateContent"

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        logger.info(
            "Gemini Interactions API: sending request to %s (image=%s, video=%s, prompt_len=%d)",
            model,
            f"{len(reference_image)} bytes" if reference_image else "none",
            f"{len(reference_video)} bytes" if reference_video else "none",
            len(prompt),
        )

        try:
            response = await client.post(
                url,
                headers=headers,
                content=json.dumps(payload),
                timeout=self.timeout,
            )
        except httpx.TimeoutException:
            raise ProviderError("Gemini API timeout — video generation quá lâu", error_code=504)

        if response.status_code >= 400:
            error_text = response.text[:500]
            logger.warning("Gemini API error %d: %s", response.status_code, error_text)

            # Try Interactions API as fallback
            if response.status_code in (400, 404):
                logger.info("Trying Interactions API endpoint instead...")
                return await self._try_interactions_api(
                    client, access_token, parts, model
                )

            raise ProviderError(
                f"Gemini API lỗi ({response.status_code}): {error_text[:200]}",
                error_code=response.status_code,
            )

        data = response.json()
        return self._extract_video_from_response(data)

    async def _try_interactions_api(
        self,
        client: httpx.AsyncClient,
        access_token: str,
        parts: list[dict],
        model: str,
    ) -> bytes:
        """Try the Interactions API endpoint for video generation."""
        url = f"{GEMINI_API_BASE}/interactions"
        payload = {
            "model": f"models/{model}",
            "input": {
                "parts": parts,
            },
            "config": {
                "responseModalities": ["VIDEO"],
            },
        }

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        try:
            response = await client.post(
                url,
                headers=headers,
                content=json.dumps(payload),
                timeout=self.timeout,
            )
        except httpx.TimeoutException:
            raise ProviderError("Gemini Interactions API timeout", error_code=504)

        if response.status_code >= 400:
            error_text = response.text[:500]
            logger.warning("Gemini Interactions API error %d: %s", response.status_code, error_text)
            raise ProviderError(
                f"Gemini Interactions API lỗi ({response.status_code}): {error_text[:200]}",
                error_code=response.status_code,
            )

        data = response.json()
        logger.info("Interactions API response keys: %s", list(data.keys()) if isinstance(data, dict) else type(data))

        # Check if async — may need polling
        if "name" in data and not any(k in data for k in ("candidates", "output", "outputVideo")):
            # Async operation — poll for result
            return await self._poll_interaction(client, access_token, data["name"])

        return self._extract_video_from_response(data)

    async def _poll_interaction(
        self, client: httpx.AsyncClient, access_token: str, operation_name: str
    ) -> bytes:
        """Poll an async interaction/operation until video is ready."""
        headers = {"Authorization": f"Bearer {access_token}"}
        poll_url = f"{GEMINI_API_BASE}/{operation_name}"

        for attempt in range(60):  # Max ~5 minutes
            await asyncio.sleep(5)
            try:
                resp = await client.get(poll_url, headers=headers, timeout=30.0)
                if resp.status_code >= 400:
                    logger.warning("Poll %s -> %d", operation_name, resp.status_code)
                    continue
                data = resp.json()
                done = data.get("done", False)
                if done:
                    result = data.get("response") or data.get("result") or data
                    return self._extract_video_from_response(result)
                logger.info("Poll interaction attempt %d: not done yet", attempt + 1)
            except Exception as exc:
                logger.warning("Poll error: %s", exc)

        raise ProviderError("Gemini video generation timeout (poll)", error_code=504)

    def _extract_video_from_response(self, data: dict) -> bytes:
        """Extract video bytes from various response formats."""
        # generateContent response: candidates[0].content.parts[].inlineData
        for candidate in data.get("candidates", []):
            content = candidate.get("content", {})
            for part in content.get("parts", []):
                inline = part.get("inlineData", {})
                mime = inline.get("mimeType", "")
                b64 = inline.get("data", "")
                if "video" in mime and b64:
                    logger.info("Extracted video from generateContent response (%s)", mime)
                    return base64.b64decode(b64)

        # Interactions response: outputVideo.data or output.parts
        output_video = data.get("outputVideo") or data.get("output_video")
        if isinstance(output_video, dict):
            b64 = output_video.get("data") or output_video.get("videoData")
            if b64:
                return base64.b64decode(b64)

        output = data.get("output", {})
        if isinstance(output, dict):
            for part in output.get("parts", []):
                inline = part.get("inlineData", {})
                if "video" in inline.get("mimeType", "") and inline.get("data"):
                    return base64.b64decode(inline["data"])

        # Deep search
        video_data = self._find_video_data(data)
        if video_data:
            return video_data

        logger.warning("Could not extract video from response. Keys: %s", list(data.keys()))
        logger.warning("Response preview: %s", json.dumps(data, default=str)[:500])
        raise ProviderError("Gemini API trả về nhưng không có video data", error_code=0)

    def _find_video_data(self, obj: Any, depth: int = 0) -> bytes | None:
        """Recursively search for video data in response."""
        if depth > 10:
            return None
        if isinstance(obj, dict):
            # Check for inline video data
            mime = obj.get("mimeType", "")
            data = obj.get("data", "")
            if "video" in str(mime) and isinstance(data, str) and len(data) > 1000:
                return base64.b64decode(data)
            for val in obj.values():
                result = self._find_video_data(val, depth + 1)
                if result:
                    return result
        elif isinstance(obj, list):
            for item in obj:
                result = self._find_video_data(item, depth + 1)
                if result:
                    return result
        return None


# Singleton
gemini_video_client = GeminiVideoClient()
