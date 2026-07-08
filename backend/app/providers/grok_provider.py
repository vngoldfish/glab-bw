from typing import Any

from app.providers.base import BaseProvider, ProviderError


class GrokProvider(BaseProvider):
    name = "grok"

    def __init__(self, session_data: dict[str, str] | None = None) -> None:
        self.session_data = session_data or {}

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        if not self.session_data:
            raise ProviderError("No active Grok session available", error_code=0)
        raise ProviderError(
            "Grok integration pending — connect Super Grok session in Accounts tab",
            error_code=0,
        )

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        return await self.generate_image(prompt, params)