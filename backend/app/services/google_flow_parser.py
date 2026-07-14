import re
import json
import logging
import time
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

def _models_path() -> Path:
    d = settings.data_dir
    d.mkdir(parents=True, exist_ok=True)
    return d / "google_flow_models.json"

def get_scraped_flow_models() -> dict:
    from app.services.auth_bridge import auth_bridge
    # Only return models if the Google Flow tab is active and open on browser
    if not auth_bridge.is_flow_tab_open():
        return {
            "is_placeholder": True,
            "models": []
        }
        
    p = _models_path()
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if data.get("models") and len(data["models"]) > 0:
                return data
        except Exception:
            logger.exception("Failed to load google_flow_models.json")
            
    return {
        "is_placeholder": True,
        "models": []
    }

def process_google_flow_html(data: dict) -> dict:
    """Save the HTML/Scripts and extract Google Flow models list."""
    if "debug_urls" in data:
        logger.info(f"📊 Extension active tabs found: {data['debug_urls']}")
        return {"debug": True}
    if "error" in data:
        logger.error(f"⚠️ Received Google Flow scraping error from extension: {data['error']}")
        return {"error": data["error"]}
    if "scraped_labels" not in data:
        return {"ignored": True}
    try:
        data_dir = settings.data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        payload_path = data_dir / "google_flow_payload.json"
        payload_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        
        html = data.get("html", "")
        html_path = data_dir / "google_flow_page.html"
        html_path.write_text(html, encoding="utf-8")
    except Exception:
        logger.exception("Failed to save Google Flow payload/HTML")

    scraped_labels = data.get("scraped_labels", [])
    models_list = []
    
    if scraped_labels:
        # Map labels to our models
        for label in scraped_labels:
            lbl = label.lower().strip()
            if "omni flash" in lbl or "omni" in lbl:
                models_list.append({"value": "omni_flash", "label": "Gemini Omni Flash (15 credits)", "credits": 15, "api_value": "omni_flash"})
            elif "veo 3.1" in lbl:
                if "lite" in lbl:
                    if "lower priority" in lbl or "relaxed" in lbl or "prior" in lbl:
                        models_list.append({"value": "veo_31_lite_relaxed", "label": "Veo 3.1 Lite [Lower Priority] (0 credit)", "credits": 0, "api_value": "veo_3_1_t2v_lite_relaxed"})
                    else:
                        models_list.append({"value": "veo_31_lite", "label": "Veo 3.1 Lite (5 credits)", "credits": 5, "api_value": "veo_3_1_t2v_lite"})
                elif "fast" in lbl:
                    models_list.append({"value": "veo_31_fast", "label": "Veo 3.1 Fast (10 credits)", "credits": 10, "api_value": "veo_3_1_t2v_fast"})
                elif "quality" in lbl or "chất lượng" in lbl:
                    models_list.append({"value": "veo_31_quality", "label": "Veo 3.1 Quality (100 credits)", "credits": 100, "api_value": "veo_3_1_t2v_quality"})
            elif "banana" in lbl or "imagen" in lbl:
                if "lite" in lbl:
                    models_list.append({"value": "nano_banana_2_lite", "label": "Nano Banana 2 Lite (0 credit)", "credits": 0, "api_value": "NARWHAL_LITE"})
                elif "pro" in lbl:
                    models_list.append({"value": "nano_banana_pro", "label": "Nano Banana Pro (0 credit)", "credits": 0, "api_value": "NARWHAL_PRO"})
                else:
                    models_list.append({"value": "nano_banana_2", "label": "Nano Banana 2 (0 credit)", "credits": 0, "api_value": "NARWHAL"})
                    
        # Remove duplicates while preserving order
        seen = set()
        unique_list = []
        for m in models_list:
            if m["value"] not in seen:
                seen.add(m["value"])
                unique_list.append(m)
        models_list = unique_list

    if not models_list:
        # Fallback to regex on text if no labels scraped
        all_text = html + "\n" + "\n".join(data.get("scripts", []))
        model_keys = set()
        found_veo = re.findall(r'\b(veo_3_1_[a-zA-Z0-9_]+)\b', all_text)
        found_abra = re.findall(r'\b(abra_t2v_[a-zA-Z0-9_]+)\b', all_text)
        
        for k in found_veo + found_abra:
            if "aspect" not in k and "ratio" not in k:
                model_keys.add(k)
                
        for k in sorted(model_keys):
            credits = 0
            label = k
            
            if "relaxed" in k or "free" in k or "low_priority" in k:
                credits = 0
                label = f"{k} (0 credit)"
            elif "quality" in k or (k.startswith("veo_3_1") and "lite" not in k and "fast" not in k):
                credits = 100
                label = f"{k} (100 credits)"
            elif "fast" in k:
                credits = 10
                label = f"{k} (10 credits)"
            elif "lite" in k:
                credits = 5
                label = f"{k} (5 credits)"
            elif "abra" in k:
                credits = 15
                label = f"{k} (15 credits)"
                
            models_list.append({
                "value": k,
                "label": label,
                "credits": credits
            })

    if len(models_list) > 0:
        models_data = {
            "is_placeholder": False,
            "models": models_list
        }
        try:
            p = _models_path()
            p.write_text(json.dumps(models_data, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info(f"Saved {len(models_list)} scraped models to {p}")
        except Exception:
            logger.exception("Failed to save google_flow_models.json")
    else:
        logger.info("No models scraped, keeping existing cache")

    return {
        "saved": True,
        "models_found": len(models_list),
        "models": models_list
    }
