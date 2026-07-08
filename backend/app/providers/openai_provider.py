import base64
from typing import Any

from openai import AsyncOpenAI

from app.providers.base import BaseProvider, ProviderError


class OpenAIProvider(BaseProvider):
    name = "openai"

    def __init__(self, api_key: str) -> None:
        self.client = AsyncOpenAI(api_key=api_key)

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        model = params.get("model", "dall-e-3")
        size = params.get("size", "1024x1024")
        quality = params.get("quality", "standard")
        n = min(max(int(params.get("n", 1)), 1), 4)

        try:
            response = await self.client.images.generate(
                model=model,
                prompt=prompt,
                size=size,
                quality=quality,
                n=n,
                response_format="b64_json",
            )
        except Exception as exc:
            raise ProviderError(str(exc), error_code=500) from exc

        results: list[bytes] = []
        for item in response.data:
            if item.b64_json:
                results.append(base64.b64decode(item.b64_json))
        if not results:
            raise ProviderError("OpenAI produced no output", error_code=0)
        return results

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        raise ProviderError("OpenAI video generation not configured", error_code=0)