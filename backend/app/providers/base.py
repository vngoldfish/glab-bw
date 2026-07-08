from abc import ABC, abstractmethod
from typing import Any


class ProviderError(Exception):
    def __init__(self, message: str, error_code: int = 0, error: str | None = None) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.error = error or message
        self.error_detail = message


class BaseProvider(ABC):
    name: str

    @abstractmethod
    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        raise NotImplementedError

    @abstractmethod
    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        raise NotImplementedError