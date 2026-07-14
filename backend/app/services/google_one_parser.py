import re
import json
import time
import logging
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

def _history_path() -> Path:
    d = settings.data_dir
    d.mkdir(parents=True, exist_ok=True)
    return d / "google_one_history.json"

def get_google_one_history() -> dict:
    p = _history_path()
    if not p.is_file():
        return {"last_sync_at": 0, "transactions": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to load google_one_history.json")
        return {"last_sync_at": 0, "transactions": []}

def process_google_one_html(html: str) -> dict:
    """Save the HTML and extract Google One AI Activity history."""
    try:
        # Save HTML for debugging
        data_dir = settings.data_dir
        data_dir.mkdir(parents=True, exist_ok=True)
        html_path = data_dir / "google_one_activity.html"
        html_path.write_text(html, encoding="utf-8")
    except Exception:
        logger.exception("Failed to save Google One activity HTML")

    activity_entries = []
    
    # Try to find AF_initDataCallback blocks
    matches = re.finditer(r'AF_initDataCallback\s*\(\s*({.*?})\s*\)\s*;', html, re.DOTALL)
    for match in matches:
        content = match.group(1)
        if "ds:0" not in content:
            continue
            
        data_match = re.search(r'data\s*:\s*(\[.*?\])\s*,\s*sideChannel', content, re.DOTALL)
        if not data_match:
            data_match = re.search(r'data\s*:\s*(\[.*\])\s*}', content, re.DOTALL)
            
        if data_match:
            try:
                data_str = data_match.group(1)
                # Clean up JS syntax to valid JSON
                cleaned_str = re.sub(r'\bundefined\b', 'null', data_str)
                cleaned_str = re.sub(r',\s*([\]}])', r'\1', cleaned_str)
                parsed = json.loads(cleaned_str)
                
                if isinstance(parsed, list) and len(parsed) > 1 and isinstance(parsed[1], list):
                    for item in parsed[1]:
                        if isinstance(item, list) and len(item) > 6:
                            tx_id = item[0]
                            # item[1] is [timestamp_sec, timestamp_nanosec]
                            ts = item[1][0] if isinstance(item[1], list) and len(item[1]) > 0 else 0
                            credits = abs(item[3]) if isinstance(item[3], (int, float)) else 0
                            model = item[6] if isinstance(item[6], str) else "unknown"
                            activity_entries.append({
                                "id": str(tx_id),
                                "timestamp": int(ts),
                                "credits": int(credits),
                                "model": str(model)
                            })
            except Exception:
                logger.exception("Failed to parse ds:0 block")

    # Save to history file if we successfully found entries
    if activity_entries:
        existing_history = get_google_one_history()
        existing_txs = {tx["id"]: tx for tx in existing_history.get("transactions", [])}
        
        for tx in activity_entries:
            existing_txs[tx["id"]] = tx
            
        merged_transactions = sorted(existing_txs.values(), key=lambda x: x["timestamp"], reverse=True)
        
        history_data = {
            "last_sync_at": int(time.time()),
            "transactions": merged_transactions
        }
        try:
            p = _history_path()
            p.write_text(json.dumps(history_data, ensure_ascii=False, indent=2), encoding="utf-8")
            logger.info(f"Merged and saved {len(merged_transactions)} Google One transactions to {p}")
        except Exception:
            logger.exception("Failed to save google_one_history.json")

    return {
        "saved": True,
        "entries_found": len(activity_entries),
        "transactions": activity_entries
    }
