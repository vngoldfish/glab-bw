from typing import Any

from app.providers.base import BaseProvider, ProviderError
from app.services.meta_client import MetaClient


class MetaProvider(BaseProvider):
    name = "meta"

    def __init__(self, session_data: dict[str, Any] | None = None) -> None:
        self.session_data = session_data or {}
        self.client = MetaClient(self.session_data)

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        if not self.session_data:
            raise ProviderError("Chưa bật tài khoản Meta AI cho tính năng tạo ảnh", error_code=401)
        model = str(params.get("model") or "midjen-base")
        aspect = str(params.get("aspect_ratio") or "1:1")
        count = max(1, min(int(params.get("count") or 1), 4))
        return await self.client.generate_images(prompt, model=model, aspect_ratio=aspect, count=count)

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        if not self.session_data:
            raise ProviderError("Chưa bật tài khoản Meta AI cho tính năng tạo video", error_code=401)
        model = str(params.get("model") or "meta-video")
        aspect = str(params.get("aspect_ratio") or "9:16")
        return await self.client.generate_video(prompt, model=model, aspect_ratio=aspect)