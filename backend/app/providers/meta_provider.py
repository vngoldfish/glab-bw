from typing import Any

from app.providers.base import BaseProvider, ProviderError


class MetaProvider(BaseProvider):
    name = "meta"

    def __init__(self, session_data: dict[str, str] | None = None) -> None:
        self.session_data = session_data or {}

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        if not self.session_data:
            raise ProviderError("No enabled Meta account for image", error_code=0)
        raise ProviderError(
            "Meta AI integration pending — add Meta cookies in Accounts tab",
            error_code=0,
        )

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        if not self.session_data:
            raise ProviderError("No enabled Meta account for video", error_code=0)
        raise ProviderError(
            "Meta AI video integration pending — add Meta cookies in Accounts tab",
            error_code=0,
        )