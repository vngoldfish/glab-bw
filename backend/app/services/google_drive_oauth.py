"""Google Drive OAuth2 Client implementation."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

import google.auth.transport.requests
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

logger = logging.getLogger(__name__)

import os
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid"
]

def load_credentials() -> Credentials | None:
    """Load credentials from local store."""
    from app.services import google_drive_store
    raw = google_drive_store.load_raw()
    creds_json = raw.get("oauth_credentials_json")
    if not creds_json:
        return None
    try:
        data = json.loads(creds_json)
        creds = Credentials.from_authorized_user_info(data, SCOPES)
        return creds
    except Exception:
        logger.exception("Failed to parse saved credentials")
        return None

def get_drive_service() -> Any:
    """Get refreshed Drive API client service."""
    creds = load_credentials()
    if not creds:
        raise ValueError("Chưa liên kết tài khoản Google Drive. Vui lòng bấm đăng nhập.")
        
    try:
        # Refresh token if expired
        if creds.expired and creds.refresh_token:
            request = google.auth.transport.requests.Request()
            creds.refresh(request)
            # Save refreshed credentials back to store
            from app.services import google_drive_store
            creds_data = {
                "token": creds.token,
                "refresh_token": creds.refresh_token,
                "token_uri": creds.token_uri,
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "scopes": creds.scopes,
            }
            google_drive_store.save_raw({"oauth_credentials_json": json.dumps(creds_data)})
            
        return build("drive", "v3", credentials=creds)
    except Exception as e:
        raise ValueError(f"Không thể kết nối Google Drive API: {e}")

def _sync_run_oauth_flow() -> str:
    """Launch local desktop OAuth2 authentication flow."""
    from app.services import google_drive_store
    raw = google_drive_store.load_raw()
    secrets_json = raw.get("client_secrets_json")
    if not secrets_json:
        raise ValueError("Chưa upload cấu hình Client Secrets JSON")
        
    try:
        client_config = json.loads(secrets_json)
    except Exception as e:
        raise ValueError(f"Định dạng Client Secrets JSON không hợp lệ: {e}")
        
    try:
        flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
        # Choose port=0 to automatically search for any open port on localhost
        creds = flow.run_local_server(
            port=0,
            authorization_prompt_message="Vui lòng hoàn tất xác thực trên trình duyệt...",
            success_message="Đăng nhập Google Drive thành công! Bạn có thể đóng tab này và quay lại G-Labs.",
            open_browser=True
        )
        
        # Save credentials to store
        creds_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
        }
        
        # Fetch email profile of authorized user
        email = ""
        try:
            profile_service = build("oauth2", "v2", credentials=creds)
            user_info = profile_service.userinfo().get().execute()
            email = user_info.get("email", "")
        except Exception:
            logger.exception("Failed to fetch user email profile")
            
        google_drive_store.save_raw({
            "oauth_credentials_json": json.dumps(creds_data),
            "authorized_email": email
        })
        
        return email or "Thành công"
    except Exception as e:
        logger.exception("OAuth flow failed")
        raise ValueError(f"Lỗi xác thực Google OAuth: {e}")

async def run_oauth_flow() -> str:
    """Async wrapper to run oauth flow without blocking main thread."""
    return await asyncio.to_thread(_sync_run_oauth_flow)
