"""AI settings + prompt rewrite endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.providers.base import ProviderError
from app.services import ai_settings_store
from app.services.prompt_ai import rewrite_prompt

router = APIRouter(prefix="/ai", tags=["ai"])


class AiSettingsUpdate(BaseModel):
    enabled: bool | None = None
    provider: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


class RewriteRequest(BaseModel):
    prompt: str = Field(min_length=1)
    kind: str = "video"  # video | image
    locale: str = "vi"


class RewriteBatchRequest(BaseModel):
    prompts: list[str] = Field(min_length=1, max_length=50)
    kind: str = "video"
    locale: str = "vi"


@router.get("/settings")
async def get_ai_settings() -> dict:
    return ai_settings_store.public_view()


@router.put("/settings")
async def put_ai_settings(body: AiSettingsUpdate) -> dict:
    patch = body.model_dump(exclude_unset=True)
    raw = ai_settings_store.save_raw(patch)
    return ai_settings_store.public_view(raw)


@router.post("/rewrite-prompt")
async def rewrite_one(body: RewriteRequest) -> dict:
    try:
        improved = await rewrite_prompt(body.prompt, kind=body.kind, locale=body.locale)
    except ProviderError as exc:
        # Clamp to valid HTTP codes (ProviderError may carry upstream 500 etc.)
        code = int(exc.error_code or 400)
        if code < 400 or code > 599:
            code = 400
        raise HTTPException(status_code=code, detail={"error": str(exc)}) from exc
    return {
        "prompt": improved,
        "original": body.prompt,
        "changed": improved.strip() != body.prompt.strip(),
    }


@router.post("/rewrite-prompts")
async def rewrite_many(body: RewriteBatchRequest) -> dict:
    results: list[dict] = []
    for index, prompt in enumerate(body.prompts):
        item: dict = {"index": index, "original": prompt}
        if not str(prompt or "").strip():
            item["status"] = "skipped"
            item["prompt"] = prompt
            results.append(item)
            continue
        try:
            improved = await rewrite_prompt(prompt, kind=body.kind, locale=body.locale)
            item["status"] = "ok"
            item["prompt"] = improved
        except ProviderError as exc:
            item["status"] = "failed"
            item["prompt"] = prompt
            item["error"] = str(exc)
        results.append(item)
    ok = sum(1 for r in results if r.get("status") == "ok")
    failed = sum(1 for r in results if r.get("status") == "failed")
    return {"total": len(results), "ok": ok, "failed": failed, "results": results}
