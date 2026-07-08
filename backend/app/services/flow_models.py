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

# Text-to-video keys (tier-agnostic naming; Ultra accounts still accept these)
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
    # Gemini Omni Flash — keys are duration-based (abra_t2v_{Ns}), not aspect-based
    "omni_flash": {
        "16:9": "abra_t2v_8s",
        "9:16": "abra_t2v_8s",
    },
}

# Omni Flash videoModelKey = abra_t2v_{duration}s (same key for T2V/I2V/FL/R2V)
OMNI_FLASH_DURATIONS = (4, 6, 8, 10)
OMNI_FLASH_DEFAULT_DURATION = 8

# Image/start-frame → video (no end frame). Non-ultra = TIER_ONE / free-ish accounts.
VIDEO_MODELS_I2V_START = {
    "veo_31_fast": {
        "16:9": "veo_3_1_i2v_s_fast",
        "9:16": "veo_3_1_i2v_s_fast_portrait",
    },
    "veo_31_lite": {
        "16:9": "veo_3_1_i2v_lite_landscape",
        "9:16": "veo_3_1_i2v_lite_portrait",
    },
    "veo_31_quality": {
        "16:9": "veo_3_1_i2v_s_landscape",
        "9:16": "veo_3_1_i2v_s_portrait",
    },
    "omni_flash": {
        "16:9": "abra_t2v_8s",
        "9:16": "abra_t2v_8s",
    },
}

VIDEO_MODELS_I2V_START_ULTRA = {
    "veo_31_fast": {
        "16:9": "veo_3_1_i2v_s_fast_ultra",
        "9:16": "veo_3_1_i2v_s_fast_portrait_ultra",
    },
    "veo_31_lite": {
        "16:9": "veo_3_1_i2v_lite_landscape",
        "9:16": "veo_3_1_i2v_lite_portrait",
    },
    "veo_31_quality": {
        "16:9": "veo_3_1_i2v_s_landscape",
        "9:16": "veo_3_1_i2v_s_portrait",
    },
    "omni_flash": {
        "16:9": "abra_t2v_8s",
        "9:16": "abra_t2v_8s",
    },
}

# Start + end frame → video (_fl suffix). Omni Flash does not support end frame.
VIDEO_MODELS_I2V_START_END = {
    "veo_31_fast": {
        "16:9": "veo_3_1_i2v_s_fast_fl",
        "9:16": "veo_3_1_i2v_s_fast_portrait_fl",
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

VIDEO_MODELS_I2V_START_END_ULTRA = {
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

# Ingredients / multiple reference images → video (R2V). Quality model does not support R2V.
VIDEO_MODELS_R2V = {
    "veo_31_fast": {
        "16:9": "veo_3_0_r2v_fast",
        "9:16": "veo_3_0_r2v_fast_portrait",
    },
    "veo_31_lite": {
        "16:9": "veo_3_0_r2v_fast",
        "9:16": "veo_3_0_r2v_fast_portrait",
    },
    "veo_31_quality": {
        "16:9": "veo_3_0_r2v_fast",
        "9:16": "veo_3_0_r2v_fast_portrait",
    },
    "veo_31_lite_relaxed": {
        "16:9": "veo_3_0_r2v_fast",
        "9:16": "veo_3_0_r2v_fast_portrait",
    },
    "omni_flash": {
        "16:9": "abra_t2v_8s",
        "9:16": "abra_t2v_8s",
    },
}

VIDEO_MODELS_R2V_ULTRA = {
    "veo_31_fast": {
        "16:9": "veo_3_0_r2v_fast_ultra",
        "9:16": "veo_3_0_r2v_fast_portrait_ultra",
    },
    "veo_31_lite": {
        "16:9": "veo_3_0_r2v_fast_ultra",
        "9:16": "veo_3_0_r2v_fast_portrait_ultra",
    },
    "veo_31_quality": {
        "16:9": "veo_3_0_r2v_fast_ultra",
        "9:16": "veo_3_0_r2v_fast_portrait_ultra",
    },
    "veo_31_lite_relaxed": {
        "16:9": "veo_3_0_r2v_fast_ultra",
        "9:16": "veo_3_0_r2v_fast_portrait_ultra",
    },
    "omni_flash": {
        "16:9": "abra_t2v_8s",
        "9:16": "abra_t2v_8s",
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


def _is_ultra_tier(user_paygate_tier: str | None) -> bool:
    tier = (user_paygate_tier or "").upper()
    # TIER_TWO / THREE / ULTRA use the *_ultra model keys in Flow production
    return any(token in tier for token in ("TIER_TWO", "TIER_THREE", "ULTRA", "TIER_FOUR"))


def _pick(table: dict[str, dict[str, str]], model: str, aspect: str) -> str:
    mapping = table.get(model) or table.get("veo_31_fast") or next(iter(table.values()))
    return mapping.get(aspect) or next(iter(mapping.values()))


def is_omni_flash_model(model: str | None) -> bool:
    return str(model or "").lower() in {
        "omni_flash",
        "gemini_omni_flash",
        "omni",
        "abra",
    }


def resolve_omni_flash_model_key(duration: int | None = None) -> str:
    """Omni Flash uses duration-encoded keys: abra_t2v_4s / 6s / 8s / 10s."""
    seconds = int(duration or OMNI_FLASH_DEFAULT_DURATION)
    if seconds not in OMNI_FLASH_DURATIONS:
        seconds = OMNI_FLASH_DEFAULT_DURATION
    return f"abra_t2v_{seconds}s"


def resolve_video_model(
    model: str,
    aspect_ratio: str,
    mode: str = "text_to_video",
    user_paygate_tier: str | None = None,
    duration: int | None = None,
) -> str:
    """Primary Flow videoModelKey for mode + account tier."""
    return resolve_video_model_candidates(
        model,
        aspect_ratio,
        mode,
        user_paygate_tier,
        duration=duration,
    )[0]


def resolve_video_model_candidates(
    model: str,
    aspect_ratio: str,
    mode: str = "text_to_video",
    user_paygate_tier: str | None = None,
    duration: int | None = None,
) -> list[str]:
    """Ordered model keys to try. Wrong keys often come back as INTERNAL from Google."""
    aspect = aspect_ratio if aspect_ratio in {"16:9", "9:16"} else "16:9"
    ultra = _is_ultra_tier(user_paygate_tier)
    keys: list[str] = []

    def add(key: str) -> None:
        if key and key not in keys:
            keys.append(key)

    # Gemini Omni Flash — real production keys are abra_t2v_{Ns} (same for T2V/I2V/R2V)
    if is_omni_flash_model(model):
        primary = resolve_omni_flash_model_key(duration)
        add(primary)
        for seconds in OMNI_FLASH_DURATIONS:
            add(f"abra_t2v_{seconds}s")
        return keys

    if mode == "components":
        primary = VIDEO_MODELS_R2V_ULTRA if ultra else VIDEO_MODELS_R2V
        secondary = VIDEO_MODELS_R2V if ultra else VIDEO_MODELS_R2V_ULTRA
        add(_pick(primary, model, aspect))
        add(_pick(secondary, model, aspect))
        # Extra R2V aliases seen in the wild
        if aspect == "9:16":
            add("veo_3_0_r2v_fast_portrait_ultra")
            add("veo_3_0_r2v_fast_portrait")
            add("veo_3_1_r2v_fast_portrait")
        else:
            add("veo_3_0_r2v_fast_ultra")
            add("veo_3_0_r2v_fast")
            add("veo_3_1_r2v_fast")
            add("veo_3_1_r2v_fast_ultra")
    elif mode == "start_end_image":
        primary = VIDEO_MODELS_I2V_START_END_ULTRA if ultra else VIDEO_MODELS_I2V_START_END
        secondary = VIDEO_MODELS_I2V_START_END if ultra else VIDEO_MODELS_I2V_START_END_ULTRA
        add(_pick(primary, model, aspect))
        add(_pick(secondary, model, aspect))
        if aspect == "9:16":
            add("veo_3_1_i2v_s_fast_portrait_ultra_fl")
            add("veo_3_1_i2v_s_fast_portrait_fl")
        else:
            add("veo_3_1_i2v_s_fast_ultra_fl")
            add("veo_3_1_i2v_s_fast_fl")
    elif mode == "start_image":
        primary = VIDEO_MODELS_I2V_START_ULTRA if ultra else VIDEO_MODELS_I2V_START
        secondary = VIDEO_MODELS_I2V_START if ultra else VIDEO_MODELS_I2V_START_ULTRA
        add(_pick(primary, model, aspect))
        add(_pick(secondary, model, aspect))
        if aspect == "9:16":
            add("veo_3_1_i2v_s_fast_portrait_ultra")
            add("veo_3_1_i2v_s_fast_portrait")
            add("veo_3_1_i2v_s_fast_portrait_ultra_fl")
        else:
            add("veo_3_1_i2v_s_fast_ultra")
            add("veo_3_1_i2v_s_fast")
            add("veo_3_1_i2v_s_fast_ultra_fl")
            add("veo_3_1_i2v_s_fast_landscape")
    else:
        add(_pick(VIDEO_MODELS_T2V, model, aspect))
        # Fallbacks for T2V if primary model unavailable
        if aspect == "9:16":
            add("veo_3_1_t2v_fast_portrait")
            add("veo_3_1_t2v_lite_portrait")
            add("veo_3_1_t2v_portrait")
            add("abra_t2v_8s")
        else:
            add("veo_3_1_t2v_fast_landscape")
            add("veo_3_1_t2v_lite_landscape")
            add("veo_3_1_t2v_landscape")
            add("abra_t2v_8s")

    return keys or ["veo_3_1_t2v_fast_landscape"]


def resolve_video_aspect(aspect_ratio: str) -> str:
    return VIDEO_ASPECTS.get(aspect_ratio, VIDEO_ASPECTS["16:9"])


def apply_video_length(model_key: str, video_length: int | None) -> str:
    if not video_length or video_length == 8:
        return model_key
    suffix = f"_{video_length}s"
    if suffix in model_key or model_key.endswith(suffix.replace("_", "")):
        return model_key
    return model_key