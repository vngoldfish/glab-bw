import json
import logging
import threading
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)
_LOCK = threading.Lock()

def _path() -> Path:
    d = settings.data_dir
    d.mkdir(parents=True, exist_ok=True)
    return d / "credit_usage.json"

def _load() -> dict[str, Any]:
    p = _path()
    default_models = {
        "omni_flash": {"runs": 0, "credits": 0},
        "veo_31_lite": {"runs": 0, "credits": 0},
        "veo_31_fast": {"runs": 0, "credits": 0},
        "veo_31_quality": {"runs": 0, "credits": 0},
        "free_image": {"runs": 0, "credits": 0},
        "free_video": {"runs": 0, "credits": 0},
    }
    if not p.is_file():
        return {
            "total_runs": 0,
            "total_credits": 0,
            "models": default_models
        }
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if "total_runs" not in data:
            data["total_runs"] = 0
        if "total_credits" not in data:
            data["total_credits"] = 0
        if "models" not in data:
            data["models"] = {}
        for m, default_val in default_models.items():
            if m not in data["models"]:
                data["models"][m] = default_val
        return data
    except Exception:
        logger.exception("Failed to load credit usage, returning default")
        return {
            "total_runs": 0,
            "total_credits": 0,
            "models": default_models
        }

def _save(data: dict[str, Any]) -> None:
    p = _path()
    try:
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        logger.exception("Failed to save credit usage")

def track_run(model_name: str, kind: str = "video", account_id: str | None = None, account_label: str | None = None) -> None:
    """Track a successful run of a model and increment credits."""
    m = str(model_name).lower()
    std_name = None
    credits = 0

    if kind == "image":
        std_name = "free_image"
        credits = 0
    else:
        # video
        if "relaxed" in m or "free" in m:
            std_name = "free_video"
            credits = 0
        elif "omni" in m or "abra" in m:
            std_name = "omni_flash"
            credits = 12
        elif "lite" in m:
            std_name = "veo_31_lite"
            credits = 5
        elif "fast" in m:
            std_name = "veo_31_fast"
            credits = 10
        elif "quality" in m or ("veo_3" in m and "lite" not in m and "fast" not in m and "abra" not in m):
            std_name = "veo_31_quality"
            credits = 100
        else:
            std_name = "free_video"
            credits = 0

    if not std_name:
        return

    with _LOCK:
        data = _load()
        data["total_runs"] += 1
        data["total_credits"] += credits

        if "models" not in data:
            data["models"] = {}
        for k in ["omni_flash", "veo_31_lite", "veo_31_fast", "veo_31_quality", "free_image", "free_video"]:
            if k not in data["models"]:
                data["models"][k] = {"runs": 0, "credits": 0}

        data["models"][std_name]["runs"] += 1
        data["models"][std_name]["credits"] += credits

        # Account-specific tracking
        if account_id:
            if "accounts" not in data:
                data["accounts"] = {}
            if account_id not in data["accounts"]:
                data["accounts"][account_id] = {
                    "label": account_label or account_id,
                    "total_runs": 0,
                    "total_credits": 0,
                    "models": {}
                }
            acc_data = data["accounts"][account_id]
            acc_data["label"] = account_label or acc_data.get("label") or account_id
            acc_data["total_runs"] += 1
            acc_data["total_credits"] += credits

            if "models" not in acc_data:
                acc_data["models"] = {}
            if std_name not in acc_data["models"]:
                acc_data["models"][std_name] = {"runs": 0, "credits": 0}
            acc_data["models"][std_name]["runs"] += 1
            acc_data["models"][std_name]["credits"] += credits

        _save(data)
        logger.info("Tracked model %s (%s) run for account %s, +%s credits. Total: %s credits (%s runs)", std_name, kind, account_id or "global", credits, data["total_credits"], data["total_runs"])

def get_usage() -> dict[str, Any]:
    with _LOCK:
        return _load()
