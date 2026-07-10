from typing import Any, Literal

from pydantic import BaseModel, Field


class ImageGenerateRequest(BaseModel):
    prompt: str
    model: str = "nano_banana_2"
    aspect_ratio: str = "1:1"
    reference_images: list[Any] = Field(default_factory=list)
    upscale: list[str] = Field(default_factory=list)


class VideoGenerateRequest(BaseModel):
    prompt: str
    model: str = "veo_31_fast"
    aspect_ratio: str = "16:9"
    mode: str = "text_to_video"
    reference_images: list[Any] = Field(default_factory=list)
    resolution: list[str] = Field(default_factory=lambda: ["720p"])
    voice: str = ""
    video_length: int | None = None


class GrokGenerateRequest(BaseModel):
    prompt: str
    mode: str = "t2v"  # t2i | i2i | t2v | i2v
    model: str = ""
    aspect_ratio: str = "9:16"
    reference_images: list[Any] = Field(default_factory=list)
    video_length: int = 6
    duration: int | None = None
    resolution: str = "480p"
    count: int = 1


class MetaGenerateRequest(BaseModel):
    prompt: str
    mode: str = "t2i"
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    count: int = 1
    character_image: str | None = None
    subject_image: str | None = None
    scene_image: str | None = None
    style_image: str | None = None
    start_image: str | None = None
    end_image: str | None = None


class OpenAIGenerateRequest(BaseModel):
    prompt: str
    model: str = "dall-e-3"
    size: str = "1024x1024"
    quality: str = "standard"
    n: int = 1


class BatchItem(BaseModel):
    prompt: str
    provider: Literal["image", "video", "grok", "meta", "openai"] = "image"
    params: dict[str, Any] = Field(default_factory=dict)


class BatchSubmitRequest(BaseModel):
    items: list[BatchItem]
    concurrency: int = 5


class AccountCreate(BaseModel):
    provider: Literal["flow", "grok", "meta", "openai"]
    label: str
    credentials: dict[str, str] = Field(default_factory=dict)
    image_enabled: bool = True
    video_enabled: bool = True
    enabled: bool = True


class AccountUpdate(BaseModel):
    label: str | None = None
    credentials: dict[str, str] | None = None
    image_enabled: bool | None = None
    video_enabled: bool | None = None
    enabled: bool | None = None
    clear_cooldown: bool | None = None
    enabled: bool | None = None


class TaskQueuedResponse(BaseModel):
    task_id: str
    status: str
    message: str
    poll_url: str