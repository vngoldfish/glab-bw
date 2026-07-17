"""Google Drive integration service."""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import threading
from pathlib import Path
from typing import Any

from googleapiclient.http import MediaFileUpload

logger = logging.getLogger(__name__)

_mapping_lock = threading.Lock()

_MIME_MAP = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
}

from app.services.google_drive_oauth import get_drive_service

def _sync_test_connection() -> dict:
    try:
        service = get_drive_service()
        # List 1 file to confirm authentication and read access
        service.files().list(pageSize=1).execute()
        
        # If folder ID is configured, verify write/read permission on folder
        from app.services import google_drive_store
        raw = google_drive_store.load_raw()
        folder_id = raw.get("folder_id", "").strip()
        if folder_id:
            try:
                service.files().get(fileId=folder_id, fields="id, name").execute()
            except Exception as e:
                return {
                    "success": False,
                    "message": f"Kết nối Google API OK, nhưng không tìm thấy hoặc không có quyền truy cập Thư mục ID '{folder_id}': {e}"
                }
                
        return {"success": True, "message": "Kết nối tới Google Drive thành công!"}
    except Exception as e:
        return {"success": False, "message": str(e)}

async def test_connection() -> dict:
    """Async wrapper to test connection without blocking FastAPI thread."""
    return await asyncio.to_thread(_sync_test_connection)

def _sync_upload_file(file_path: Path) -> str:
    """Synchronous file upload to Google Drive."""
    from app.services import google_drive_store
    raw = google_drive_store.load_raw()
    if not raw.get("enabled"):
        logger.info("Google Drive upload is disabled, skipping.")
        return ""
        
    folder_id = raw.get("folder_id", "").strip()
    service = get_drive_service()
    
    file_metadata: dict[str, Any] = {
        "name": file_path.name,
    }
    if folder_id:
        file_metadata["parents"] = [folder_id]
        
    suffix = file_path.suffix.lower()
    mime_type = _MIME_MAP.get(suffix) or mimetypes.guess_type(str(file_path))[0] or 'application/octet-stream'
    media = MediaFileUpload(
        str(file_path),
        mimetype=mime_type,
        resumable=True
    )
    
    logger.info("Uploading %s to Google Drive...", file_path.name)
    uploaded = service.files().create(
        body=file_metadata,
        media_body=media,
        fields="id, webViewLink"
    ).execute()
    
    web_link = uploaded.get("webViewLink", "")
    logger.info("Successfully uploaded %s to Google Drive. Link: %s", file_path.name, web_link)
    
    # Save mapping of local relative file path -> Google Drive URL
    try:
        from app.core.config import settings
        rel_path = file_path.relative_to(settings.data_dir).as_posix()
        
        mapping_file = settings.data_dir / "google_drive_file_mappings.json"
        with _mapping_lock:
            mappings = {}
            if mapping_file.is_file():
                try:
                    mappings = json.loads(mapping_file.read_text(encoding="utf-8"))
                except Exception:
                    pass
            
            mappings[rel_path] = web_link
            mapping_file.write_text(json.dumps(mappings, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("Saved Google Drive file mapping: %s -> %s", rel_path, web_link)
    except Exception:
        logger.exception("Failed to save Google Drive file mapping")
        
    # OPTIMIZATION: If save_local is False, delete the local file after successful upload!
    if not raw.get("save_local", True):
        try:
            if file_path.is_file():
                file_path.unlink()
                logger.info("Deleted temporary local file %s after upload.", file_path.name)
        except Exception:
            logger.exception("Failed to delete temporary local file %s", file_path.name)
            
    return web_link

async def upload_file(file_path: Path) -> str:
    """Asynchronously upload file to Google Drive (run in thread pool)."""
    if not file_path.is_file():
        logger.warning("Target file %s does not exist, cannot upload.", file_path)
        return ""
    try:
        return await asyncio.to_thread(_sync_upload_file, file_path)
    except Exception:
        logger.exception("Failed to upload file %s to Google Drive", file_path.name)
        return ""

def get_drive_mapping(rel_path: str) -> str | None:
    """Check if a local file relative path maps to an uploaded Google Drive web Link."""
    from app.core.config import settings
    mapping_file = settings.data_dir / "google_drive_file_mappings.json"
    if not mapping_file.is_file():
        return None
    try:
        mappings = json.loads(mapping_file.read_text(encoding="utf-8"))
        standardized_rel = rel_path.replace("\\", "/")
        return mappings.get(standardized_rel)
    except Exception:
        return None
