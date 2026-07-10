from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.pipeline import get_pipeline_job, run_image_then_video

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


class ImageThenVideoRequest(BaseModel):
    prompt: str
    video_prompt: str | None = None
    image_params: dict = Field(default_factory=dict)
    video_params: dict = Field(default_factory=dict)


@router.post("/image-then-video")
async def image_then_video(body: ImageThenVideoRequest) -> dict:
    if not body.prompt.strip():
        raise HTTPException(status_code=400, detail={"error": "prompt required"})
    job = await run_image_then_video(
        prompt=body.prompt.strip(),
        image_params=body.image_params,
        video_params=body.video_params,
        video_prompt=body.video_prompt,
    )
    return job


@router.get("/{job_id}")
async def pipeline_status(job_id: str) -> dict:
    job = get_pipeline_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"error": "Job not found"})
    return job
