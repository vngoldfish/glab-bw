from typing import Any

FLOW_API_BASE = "https://aisandbox-pa.googleapis.com/v1"
FLOW_LABS_BASE = "https://labs.google/fx/api"
FLOW_API_KEY = "AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY"
RECAPTCHA_SITE_KEY = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV"

IMAGE_MODELS = {
    "nano_banana_pro": "GEM_PIX",
    "nano_banana_2": "GEM_PIX_2",
    "nano_banana_2_lite": "NARWHAL",
}

IMAGE_ASPECTS = {
    "1:1": "IMAGE_ASPECT_RATIO_SQUARE",
    "3:4": "IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR",
    "4:3": "IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE",
    "9:16": "IMAGE_ASPECT_RATIO_PORTRAIT",
    "16:9": "IMAGE_ASPECT_RATIO_LANDSCAPE",
    "auto": None,
}

VIDEO_ASPECTS = {
    "16:9": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "9:16": "VIDEO_ASPECT_RATIO_PORTRAIT",
}

VIDEO_MODELS_T2V = {
    "veo_31_fast": {
        "16:9": "veo_3_1_t2v_fast_landscape",
        "9:16": "veo_3_1_t2v_fast_portrait",
    },
    "veo_31_lite": {
        "16:9": "veo_3_1_t2v_lite_landscape",
        "9:16": "veo_3_1_t2v_lite_portrait",
    },
    "veo_31_quality": {
        "16:9": "veo_3_1_t2v_landscape",
        "9:16": "veo_3_1_t2v_portrait",
    },
    "veo_31_lite_relaxed": {
        "16:9": "veo_3_1_t2v_fast_ultra_relaxed",
        "9:16": "veo_3_1_t2v_fast_portrait_ultra_relaxed",
    },
}

VIDEO_MODELS_I2V = {
    "veo_31_fast": {
        "16:9": "veo_3_1_i2v_s_fast_ultra_fl",
        "9:16": "veo_3_1_i2v_s_fast_portrait_ultra_fl",
    },
    "veo_31_lite": {
        "16:9": "veo_3_1_i2v_lite_landscape",
        "9:16": "veo_3_1_i2v_lite_portrait",
    },
    "veo_31_quality": {
        "16:9": "veo_3_1_i2v_s_landscape",
        "9:16": "veo_3_1_i2v_s_portrait",
    },
}

UPSCALE_IMAGE = {
    "2K": "UPSAMPLE_IMAGE_RESOLUTION_2K",
    "4K": "UPSAMPLE_IMAGE_RESOLUTION_4K",
}

UPSCALE_VIDEO = {
    "1080p": ("VIDEO_RESOLUTION_1080P", "veo_3_1_upsampler_1080p"),
    "4K": ("VIDEO_RESOLUTION_4K", "veo_3_1_upsampler_4k"),
}


def resolve_image_model(model: str) -> str:
    return IMAGE_MODELS.get(model, IMAGE_MODELS["nano_banana_2"])


def resolve_image_aspect(aspect_ratio: str, *, has_references: bool = False) -> str | None:
    if aspect_ratio == "auto" or (has_references and aspect_ratio not in IMAGE_ASPECTS):
        return None
    return IMAGE_ASPECTS.get(aspect_ratio, IMAGE_ASPECTS["1:1"])


def resolve_video_model(model: str, aspect_ratio: str, mode: str = "text_to_video") -> str:
    aspect = aspect_ratio if aspect_ratio in {"16:9", "9:16"} else "16:9"
    table = VIDEO_MODELS_I2V if mode in {"start_image", "start_end_image", "components"} else VIDEO_MODELS_T2V
    mapping = table.get(model, VIDEO_MODELS_T2V["veo_31_fast"])
    return mapping.get(aspect, mapping["16:9"])


def resolve_video_aspect(aspect_ratio: str) -> str:
    return VIDEO_ASPECTS.get(aspect_ratio, VIDEO_ASPECTS["16:9"])


def apply_video_length(model_key: str, video_length: int | None) -> str:
    if not video_length or video_length == 8:
        return model_key
    suffix = f"_{video_length}s"
    if suffix in model_key or model_key.endswith(suffix.replace("_", "")):
        return model_key
    return model_key