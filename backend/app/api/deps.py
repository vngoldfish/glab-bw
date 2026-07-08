from fastapi import Header, HTTPException

from app.core.config import settings


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if not settings.api_key:
        return
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail={"error": "Invalid or missing API key"})