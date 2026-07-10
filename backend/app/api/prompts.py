from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import prompt_hub_store as hub

router = APIRouter(prefix="/prompts", tags=["prompt-hub"])


class PromptCreate(BaseModel):
    title: str = ""
    text: str
    kind: str = "any"
    tags: list[str] = Field(default_factory=list)


class PromptUpdate(BaseModel):
    title: str | None = None
    text: str | None = None
    kind: str | None = None
    tags: list[str] | None = None


@router.get("")
async def list_prompts(kind: str | None = None, q: str | None = None, limit: int = 200) -> dict:
    return {"prompts": hub.list_prompts(kind=kind, q=q, limit=limit)}


@router.post("", status_code=201)
async def create_prompt(body: PromptCreate) -> dict:
    try:
        item = hub.create_prompt(
            title=body.title,
            text=body.text,
            kind=body.kind if body.kind in {"image", "video", "any"} else "any",  # type: ignore[arg-type]
            tags=body.tags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
    return {"prompt": item}


@router.get("/{prompt_id}")
async def get_prompt(prompt_id: str) -> dict:
    item = hub.get_prompt(prompt_id)
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return {"prompt": item}


@router.patch("/{prompt_id}")
async def update_prompt(prompt_id: str, body: PromptUpdate) -> dict:
    item = hub.update_prompt(prompt_id, body.model_dump(exclude_unset=True))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return {"prompt": item}


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str) -> dict:
    if not hub.delete_prompt(prompt_id):
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    return {"ok": True}


@router.post("/{prompt_id}/use")
async def use_prompt(prompt_id: str) -> dict:
    item = hub.get_prompt(prompt_id)
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Not found"})
    hub.touch_use(prompt_id)
    return {"prompt": hub.get_prompt(prompt_id)}
