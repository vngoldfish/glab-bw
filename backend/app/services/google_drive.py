"""Google Drive integration service."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

logger = logging.getLogger(__name__)

def get_drive_service() -> Any:
    """Initialize Drive API v3 client using Service Account credentials."""
    from app.services import google_drive_store
    raw = google_drive_store.load_raw()
    info = raw.get("service_account_info")
    if not info:
        raise ValueError("Chưa cấu hình thông tin Google Service Account JSON")
    try:
        parsed = json.loads(info)
        if not isinstance(parsed, dict) or "private_key" not in parsed:
            raise ValueError("Định dạng JSON Service Account không hợp lệ (thiếu private_key)")
        
        credentials = service_account.Credentials.from_service_account_info(
            parsed,
            scopes=["https://www.googleapis.com/auth/drive"]
        )
        return build("drive", "v3", credentials=credentials)
    except Exception as e:
        raise ValueError(f"Không thể khởi tạo kết nối Google Drive: {e}")

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
        
    mime_type = "video/mp4" if file_path.suffix.lower() == ".mp4" else "image/png"
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
