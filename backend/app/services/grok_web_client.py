"""Grok.com web session client — cookie auth (sso / sso-rw), like Flow cookie flow.

Primary image path (matches G-Labs desktop + grok.com/imagine):
  Auth Helper kind=gws → wss://grok.com/ws/imagine/listen
  (chat REST /app-chat is anti-bot code 7 without a live x-statsig-id)
"""

from __future__ import annotations

import base64
import json
import logging
import random
import re
import string
import time
import uuid
from typing import Any

import httpx

from app.providers.base import ProviderError

logger = logging.getLogger(__name__)

GROK_ORIGIN = "https://grok.com"
NEW_CHAT_URL = f"{GROK_ORIGIN}/rest/app-chat/conversations/new"
MEDIA_POST_URL = f"{GROK_ORIGIN}/rest/media/post/create"
UPLOAD_FILE_URL = f"{GROK_ORIGIN}/rest/app-chat/upload-file"
WS_IMAGINE_URL = "wss://grok.com/ws/imagine/listen"
ASSETS_CDN = "https://assets.grok.com"

# Official Imagine video model (app-chat stream) — NOT chat image tool
VIDEO_MODEL_NAME = "imagine-video-gen"
_MEDIA_TYPE_VIDEO = "MEDIA_POST_TYPE_VIDEO"
_MEDIA_TYPE_IMAGE = "MEDIA_POST_TYPE_IMAGE"

# Valid Imagine aspect ratios (web UI)
_IMAGINE_ASPECTS = frozenset({"9:16", "16:9", "1:1", "2:3", "3:2"})
_VIDEO_LENGTHS = (6, 10, 15)
_VIDEO_RESOLUTIONS = frozenset({"480p", "720p"})

# Models seen on web over time
WEB_MODEL_ALIASES = {
    "grok-3": "grok-3",
    "grok3": "grok-3",
    "grok-4": "grok-4",
    "grok": "grok-3",
    "default": "grok-3",
    # Imagine-oriented labels from UI map to chat + image tools
    "grok-imagine-image": "grok-3",
    "grok-imagine-image-quality": "grok-3",
    "grok_imagine": "grok-3",
}


def cookies_from_credentials(creds: dict[str, str]) -> dict[str, str]:
    """Build requests cookie jar from stored credentials."""
    out: dict[str, str] = {}
    raw = (creds.get("cookie") or "").strip()
    if raw:
        for part in raw.split(";"):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
    for key in ("sso", "sso-rw", "x-anonuserid", "x-challenge", "x-signature", "cf_clearance"):
        if creds.get(key):
            out[key if key != "sso-rw" else "sso-rw"] = creds[key]
    # normalize key name
    if "sso_rw" in out and "sso-rw" not in out:
        out["sso-rw"] = out.pop("sso_rw")
    return out


def _headers() -> dict[str, str]:
    return {
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9,vi;q=0.8",
        "content-type": "application/json",
        "origin": GROK_ORIGIN,
        "referer": f"{GROK_ORIGIN}/",
        "sec-ch-ua": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
    }


# Hosts / path fragments that look like real Grok/xAI media (not YouTube etc.)
_IMAGE_HOST_HINTS = (
    "imagine-public.x.ai",
    "imagine.x.ai",
    "assets.grok.com",
    "assets.x.ai",
    "cdn.x.ai",
    "grok.com/api",
    "grok.com/rest",
    "x.ai/assets",
    "x.ai/image",
    "generated",
    "share-images",
    "image_gen",
    "imggen",
)
_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif")
_VIDEO_HINTS = (".mp4", ".webm", "vidgen", "video/", "share-videos")
_BLOCK_HOSTS = (
    "youtube.com",
    "youtu.be",
    "google.com",
    "gstatic.com",
    "facebook.com",
    "twitter.com",
    "x.com/i/",
    "cdn.cookielaw.org",
)


def _is_blocked_url(url: str) -> bool:
    u = url.lower()
    return any(b in u for b in _BLOCK_HOSTS)


def is_likely_image_url(url: str) -> bool:
    if not url or not str(url).startswith("http"):
        return False
    u = str(url).strip().rstrip(").,;]'\"")
    if _is_blocked_url(u):
        return False
    low = u.lower()
    if any(ext in low.split("?")[0] for ext in _IMAGE_EXT):
        return True
    if any(h in low for h in _IMAGE_HOST_HINTS):
        return True
    # common CDN query assets
    if "image" in low and any(x in low for x in ("x.ai", "grok", "cdn", "media", "blob")):
        return True
    return False


def is_likely_video_url(url: str) -> bool:
    if not url or not str(url).startswith("http"):
        return False
    u = str(url).strip()
    if _is_blocked_url(u):
        return False
    low = u.lower()
    return any(h in low for h in _VIDEO_HINTS) or "imagine" in low and "video" in low


def _looks_like_image_bytes(data: bytes) -> bool:
    if not data or len(data) < 24:
        return False
    # Reject HTML/JSON mistaken for media
    head = data[:200].lstrip().lower()
    if head.startswith((b"<!doctype", b"<html", b"{", b"[")):
        return False
    sigs = (
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF87a",
        b"GIF89a",
        b"RIFF",  # webp starts RIFF....WEBP
    )
    if any(data.startswith(s) for s in sigs[:4]):
        return True
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return True
    # Some CDNs return JPEG without full SOI in first bytes after BOM — rare
    return False


def _walk_collect_urls(obj: Any, into: list[str], *, video: bool = False) -> None:
    check = is_likely_video_url if video else is_likely_image_url
    if isinstance(obj, str):
        if check(obj) and obj not in into:
            into.append(obj.rstrip(").,;]'\""))
        return
    if isinstance(obj, dict):
        # Prefer dedicated image keys first
        priority_keys = (
            "generatedImageUrls",
            "generatedImageUrl",
            "imageUrl",
            "image_url",
            "imageUri",
            "imageUrls",
            "images",
            "url",
            "src",
            "hdUrl",
            "thumbnailUrl",
        )
        for key in priority_keys:
            if key not in obj:
                continue
            val = obj.get(key)
            if isinstance(val, str) and check(val) and val not in into:
                into.append(val.rstrip(").,;]'\""))
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, str) and check(item) and item not in into:
                        into.append(item.rstrip(").,;]'\""))
                    elif isinstance(item, dict):
                        _walk_collect_urls(item, into, video=video)
        for k, v in obj.items():
            if k in priority_keys:
                continue
            _walk_collect_urls(v, into, video=video)
    elif isinstance(obj, list):
        for item in obj:
            _walk_collect_urls(item, into, video=video)


def _extract_urls_from_text(text: str, *, video: bool = False) -> list[str]:
    urls = re.findall(r"https?://[^\s\"'<>]+", text or "")
    check = is_likely_video_url if video else is_likely_image_url
    out: list[str] = []
    for u in urls:
        u = u.rstrip(").,;]'\"")
        if check(u) and u not in out:
            out.append(u)
    return out


class GrokWebClient:
    def __init__(self, credentials: dict[str, str]) -> None:
        self.credentials = credentials or {}
        self.cookies = cookies_from_credentials(self.credentials)
        # Cookie optional when extension runs fetch in browser (uses tab session).
        # Still require sso for pure-direct mode; extension path checks bridge instead.
        self._has_sso = bool(self.cookies.get("sso") and self.cookies.get("sso") != "browser")

    async def validate_session(self) -> dict[str, Any]:
        """Lightweight check that cookies still work."""
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            res = await client.get(
                GROK_ORIGIN,
                headers=_headers(),
                cookies=self.cookies,
            )
        ok = res.status_code < 400 and "sso" in self.cookies
        # 200 alone is weak; try a tiny chat later if needed
        return {"ok": ok, "status_code": res.status_code}

    def _payload(
        self,
        message: str,
        *,
        model_name: str,
        image_count: int,
        for_video: bool = False,
    ) -> dict[str, Any]:
        model = WEB_MODEL_ALIASES.get(model_name, model_name) or "grok-3"
        # Force image tool via prompt when needed
        msg = message.strip()
        if not for_video and "generate" not in msg.lower() and "tạo ảnh" not in msg.lower():
            # Keep user prompt; enableImageGeneration flag does the heavy lifting
            pass
        if for_video:
            msg = (
                f"Generate a short video (imagine video) based on this description. "
                f"Only produce video if possible:\n{msg}"
            )

        return {
            "temporary": True,
            "modelName": model,
            "message": msg,
            "fileAttachments": [],
            "imageAttachments": [],
            "disableSearch": True,
            "enableImageGeneration": not for_video,
            "returnImageBytes": False,
            "returnRawGrokInXaiRequest": False,
            "enableImageStreaming": True,
            "imageGenerationCount": max(1, min(image_count, 4)),
            "forceConcise": False,
            "toolOverrides": {},
            "enableSideBySide": True,
            "isPreset": False,
            "sendFinalMetadata": True,
            "customInstructions": "",
            "deepsearchPreset": "",
            "isReasoning": False,
        }

    async def _post_stream_direct(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Direct server→grok.com (often blocked by anti-bot)."""
        if not self._has_sso:
            raise ProviderError(
                "Thiếu cookie sso cho direct mode — dùng extension-grok hoặc dán cookie Cài đặt",
                error_code=400,
            )
        events: list[dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=180.0) as client:
            async with client.stream(
                "POST",
                NEW_CHAT_URL,
                headers=_headers(),
                cookies=self.cookies,
                json=payload,
            ) as res:
                raw_err = b""
                if res.status_code >= 400:
                    raw_err = await res.aread()
                    body = raw_err[:500].decode("utf-8", errors="replace")
                    if res.status_code in {401, 403} or "anti-bot" in body.lower():
                        raise ProviderError(
                            "Grok anti-bot chặn request từ app (403). "
                            "Cookie sso vẫn OK nhưng Cloudflare/anti-bot không cho Python gọi API. "
                            "Cách xử lý: (1) mở tab grok.com + Auth Helper (extension hỗ trợ Grok), "
                            "(2) hoặc thêm xAI API key tại console.x.ai làm fallback. "
                            f"Chi tiết: {body[:160]}",
                            error_code=res.status_code,
                        )
                    raise ProviderError(
                        f"Grok web HTTP {res.status_code}: {body[:300]}",
                        error_code=res.status_code,
                    )
                async for line in res.aiter_lines():
                    line = (line or "").strip()
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line in {"[DONE]", "DONE"}:
                        break
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return events

    async def _wait_task(self, task_id: str, timeout: float = 200.0) -> dict[str, Any]:
        from app.services.auth_bridge import auth_bridge

        try:
            return await auth_bridge.wait_for_grok_task(task_id, timeout=timeout)
        except TimeoutError as exc:
            raise ProviderError(
                "Timeout chờ G-Labs Auth Helper (Grok). Kiểm tra: "
                "(1) extension Auth Helper bật, "
                "(2) tab https://grok.com/imagine mở + login, "
                "(3) backend :18923, "
                "(4) title bar app hiện Grok: open.",
                error_code=504,
            ) from exc

    # Official Auth Helper (duckmartians v7):
    #   - captures x-statsig-id via webRequest on grok.com/rest/* → _ftCache
    #   - injects when payload.injectStatsig && _ftCache
    #   - force_refresh_session navigates / → /imagine to refill _ftCache
    # Image path uses Imagine WS (no statsig). Video uses app-chat HTTP → needs real statsig.
    # Synthetic btoa("x1:TypeError…") is often rejected now for video (code 7).

    async def _ensure_statsig_header(self) -> str | None:
        """Companion extension-grok token if available."""
        from app.services.auth_bridge import auth_bridge

        token = auth_bridge.get_statsig_id(max_age=600.0)
        if token:
            return token
        logger.info("Waiting briefly for companion statsig scrape")
        token = await auth_bridge.wait_for_statsig(timeout=4.0)
        if token:
            logger.info("Got companion statsig id len=%s", len(token))
        return token

    @staticmethod
    def _synthetic_statsig_id() -> str:
        """Last-resort fallback (often rejected for video — prefer force_refresh)."""
        if random.choice((True, False)):
            rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
            msg = (
                "x1:TypeError: Cannot read properties of null "
                f"(reading 'children[\\'{rand}\\']')"
            )
        else:
            rand = "".join(random.choices(string.ascii_lowercase, k=10))
            msg = f"x1:TypeError: Cannot read properties of undefined (reading '{rand}')"
        return base64.b64encode(msg.encode()).decode()

    def _statsig_for_request(self, statsig_id: str | None = None) -> str | None:
        """Real statsig only when known — omit synthetic so Auth Helper inject can win.

        If we always send a fake header and _ftCache is empty, Grok returns code 7.
        Prefer: (1) companion cache (2) let injectStatsig fill from Auth Helper _ftCache
        after force_refresh_session.
        """
        sid = (statsig_id or "").strip()
        if sid:
            return sid
        try:
            from app.services.auth_bridge import auth_bridge

            cached = auth_bridge.get_statsig_id(max_age=600.0)
            if cached:
                return cached
        except Exception:
            pass
        return None

    def _parse_force_refresh_meta(self, done: dict[str, Any]) -> dict[str, Any]:
        result = done.get("result") or {}
        if not isinstance(result, dict):
            return {}
        meta = result.get("done") if isinstance(result.get("done"), dict) else result
        return meta if isinstance(meta, dict) else {}

    async def _extension_force_refresh(self) -> dict[str, Any]:
        """G-Labs style: force_refresh_session → fill Auth Helper private _ftCache.

        Official desktop app only needs Auth Helper (no companion). Tab may hop
        / → /imagine once. WebRequest captures x-statsig-id from grok.com/rest/*.
        """
        from app.services.auth_bridge import auth_bridge

        task_id = auth_bridge.queue_grok_task(
            method="GET",
            url=f"{GROK_ORIGIN}/imagine",
            headers={},
            body=None,
            kind="force_refresh_session",
            response_mode="json",
            timeout_ms=120_000,
            inject_statsig=False,
        )
        logger.info("Grok force_refresh_session queued id=%s", task_id)
        done = await self._wait_task(task_id, timeout=130.0)
        meta = self._parse_force_refresh_meta(done)
        if done.get("error"):
            logger.warning("force_refresh error: %s", done.get("error"))
        else:
            logger.info(
                "force_refresh done gotStatsig=%s source=%s widget=%s",
                meta.get("gotStatsig"),
                meta.get("statsigSource"),
                meta.get("_widgetBusy"),
            )
        # Optional: if companion is also installed, pick up scrape after nav
        try:
            auth_bridge._statsig_wanted = True
            await auth_bridge.wait_for_statsig(timeout=2.0)
        except Exception:
            pass
        return done

    async def _warm_for_video_auth_helper(self) -> tuple[bool, str | None]:
        """Warm like G-Labs desktop — Auth Helper only.

        Returns (auth_helper_got_statsig, optional_header_token).
        Always force_refresh so _ftCache is refilled (Auth Helper only injects
        from _ftCache when injectStatsig=true).
        """
        from app.services.auth_bridge import auth_bridge

        # Optional companion token (bonus header; not required)
        optional = auth_bridge.get_statsig_id(max_age=600.0)

        done = await self._extension_force_refresh()
        meta = self._parse_force_refresh_meta(done)
        got = bool(meta.get("gotStatsig"))

        # If first warm failed, retry once (page may need a second paint)
        if not got:
            logger.warning("force_refresh gotStatsig=false — retry once")
            import asyncio

            await asyncio.sleep(1.0)
            done = await self._extension_force_refresh()
            meta = self._parse_force_refresh_meta(done)
            got = bool(meta.get("gotStatsig"))

        optional = auth_bridge.get_statsig_id(max_age=120.0) or optional
        return got, optional

    async def _require_grok_tab(self) -> None:
        from app.services.auth_bridge_access import auth_bridge_access

        if not auth_bridge_access.is_connected():
            raise ProviderError(
                "Auth Helper chưa kết nối bridge :18923. "
                "Bật «G-Labs Automation - Auth Helper».",
                error_code=0,
            )
        session = auth_bridge_access.get_primary_session()
        grok_state = (session.grok_tab_status if session else "closed") or "closed"
        if grok_state == "login_required":
            raise ProviderError(
                "Grok tab cần login — mở https://grok.com/imagine và đăng nhập.",
                error_code=0,
            )
        if grok_state != "open":
            raise ProviderError(
                "Chưa có tab Grok. Mở https://grok.com/imagine (login) và GIỮ tab. "
                f"Trạng thái: {grok_state}",
                error_code=0,
            )

    async def _extension_gfetch(
        self,
        payload: dict[str, Any],
        *,
        inject_statsig: bool = True,
        statsig_id: str | None = None,
        url: str | None = None,
        method: str = "POST",
        response_mode: str = "stream",
        timeout_ms: int = 180_000,
        referer: str | None = None,
        use_synthetic_statsig: bool = False,
    ) -> dict[str, Any]:
        """Queue kind=gfetch matching official Auth Helper _renderFtQuery.

        Prefer real x-statsig-id. injectStatsig=true so Auth Helper overwrites
        from _ftCache after force_refresh. Synthetic only if explicitly allowed
        (video defaults OFF — code 7 rejects fakes).
        """
        from app.services.auth_bridge import auth_bridge

        page_headers = {
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.9",
            "content-type": "application/json",
            "origin": GROK_ORIGIN,
            "referer": referer or f"{GROK_ORIGIN}/imagine",
            "x-xai-request-id": str(uuid.uuid4()),
        }
        sid = self._statsig_for_request(statsig_id)
        if not sid and use_synthetic_statsig:
            sid = self._synthetic_statsig_id()
        if sid:
            page_headers["x-statsig-id"] = sid
        do_inject = bool(inject_statsig)
        target = url or NEW_CHAT_URL
        task_id = auth_bridge.queue_grok_task(
            method=method,
            url=target,
            headers=page_headers,
            body=payload,
            kind="gfetch",
            response_mode=response_mode,
            timeout_ms=timeout_ms,
            inject_statsig=do_inject,
        )
        logger.info(
            "Grok gfetch queued id=%s url=%s mode=%s inject=%s hasStatsigHeader=%s",
            task_id,
            target.replace(GROK_ORIGIN, "")[:60],
            response_mode,
            do_inject,
            bool(sid),
        )
        return await self._wait_task(task_id, timeout=max(30.0, timeout_ms / 1000.0 + 20.0))

    @staticmethod
    def _events_from_done(done: dict[str, Any]) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        result = done.get("result") or {}
        if isinstance(result, dict):
            for item in result.get("events") or []:
                if isinstance(item, dict):
                    events.append(item)
        elif isinstance(result, list):
            events = [e for e in result if isinstance(e, dict)]
        for item in done.get("chunks") or []:
            if isinstance(item, dict) and item not in events:
                events.append(item)
        return events

    @staticmethod
    def _is_antibot_error(err: str | None) -> bool:
        if not err:
            return False
        low = err.lower()
        return (
            "anti-bot" in low
            or "code\":7" in low
            or "code\": 7" in low
            or '"code":7' in low
        )

    @staticmethod
    def _antibot_help_msg(detail: str = "") -> str:
        # Official G-Labs: Auth Helper webRequest fills _ftCache after traffic on
        # grok.com/rest/* (often after one manual gen or when tab is warm).
        base = (
            "Grok anti-bot (code 7) — Auth Helper chưa có x-statsig-id (_ftCache rỗng). "
            "Giống G-Labs gốc: (1) mở https://grok.com/imagine + login SuperGrok, "
            "(2) gen 1 ảnh thủ công trên web (để webRequest bắt header), "
            "(3) giữ tab, gen app ngay. "
            "Dùng đúng extension «G-Labs Automation - Auth Helper» v7 + bridge :18923."
        )
        if detail:
            return f"{base} ({detail[:140]})"
        return base

    async def _post_stream_via_extension(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Queue gfetch for official G-Labs Automation - Auth Helper (content_grok).

        Protocol matches desktop G-Labs:
          theme g=1 → GET /sync/grok-poll-task → gfetch in tab → POST /sync/grok-event
          injectStatsig=true → Auth Helper attaches _ftCache (webRequest x-statsig-id)

        Note: Auth Helper itself may navigate tab once when warm age >45s
        (_readyFtCanvas). We do not queue force_refresh_session ourselves.
        """
        from app.services.auth_bridge_access import auth_bridge_access

        if not auth_bridge_access.is_connected():
            raise ProviderError(
                "Auth Helper chưa kết nối bridge :18923. "
                "Bật extension «G-Labs Automation - Auth Helper» (hỗ trợ Flow + Grok).",
                error_code=0,
            )
        session = auth_bridge_access.get_primary_session()
        grok_state = (session.grok_tab_status if session else "closed") or "closed"
        if grok_state == "login_required":
            raise ProviderError(
                "Grok tab cần login — mở https://grok.com/imagine và đăng nhập (cookie sso).",
                error_code=0,
            )
        if grok_state != "open":
            raise ProviderError(
                "Chưa có tab Grok sẵn sàng. Mở https://grok.com/imagine (đã login) và GIỮ tab đó. "
                f"Trạng thái extension: {grok_state}",
                error_code=0,
            )

        # Optional companion token; official path relies on injectStatsig + _ftCache
        statsig = await self._ensure_statsig_header()

        done = await self._extension_gfetch(
            payload, inject_statsig=True, statsig_id=statsig
        )
        err = done.get("error")

        if err and self._is_antibot_error(str(err)):
            logger.warning("Grok anti-bot — retry once with injectStatsig (Auth Helper warm)")
            import asyncio

            from app.services.auth_bridge import auth_bridge

            auth_bridge._statsig_id = None
            auth_bridge._statsig_at = 0.0
            await asyncio.sleep(1.0)
            statsig = await self._ensure_statsig_header()
            done = await self._extension_gfetch(
                payload, inject_statsig=True, statsig_id=statsig
            )
            err = done.get("error")

        if err:
            msg = str(err)
            if self._is_antibot_error(msg):
                raise ProviderError(self._antibot_help_msg(msg), error_code=403)
            raise ProviderError(f"Auth Helper Grok lỗi: {msg}", error_code=502)

        return self._events_from_done(done)

    async def _post_stream(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Prefer official Auth Helper gfetch (anti-bot + statsig). Direct is last resort."""
        from app.services.auth_bridge_access import auth_bridge_access

        connected = auth_bridge_access.is_connected()
        sess = auth_bridge_access.get_primary_session() if connected else None
        grok_state = (sess.grok_tab_status if sess else "closed") or "closed"

        if connected and grok_state == "open":
            return await self._post_stream_via_extension(payload)

        if connected and grok_state == "login_required":
            raise ProviderError(
                "Auth Helper thấy tab Grok nhưng chưa login (thiếu cookie sso). "
                "Login trên https://grok.com/imagine rồi thử lại.",
                error_code=0,
            )

        if connected and grok_state != "open":
            raise ProviderError(
                "Auth Helper đã nối nhưng Grok tab chưa open. "
                "Mở https://grok.com/imagine (login SuperGrok) — extension tự detect.",
                error_code=0,
            )

        logger.warning("Auth Helper offline — direct cookie call (thường 403 anti-bot)")
        try:
            return await self._post_stream_direct(payload)
        except ProviderError as exc:
            raise ProviderError(
                f"{exc} | Bật «G-Labs Automation - Auth Helper» + mở tab grok.com/imagine "
                f"(extension này đã hỗ trợ Grok, không cần extension-grok riêng).",
                error_code=getattr(exc, "error_code", 403) or 403,
            ) from exc

    def _parse_images(self, events: list[dict[str, Any]]) -> list[str]:
        """Extract only real image URLs — never YouTube / generic page links."""
        urls: list[str] = []
        # 1) Structured fields first
        for ev in events:
            try:
                resp = (ev.get("result") or {}).get("response") or ev.get("response") or {}
                model_resp = resp.get("modelResponse") or {}
                if isinstance(model_resp, dict):
                    for key in ("generatedImageUrls", "imageUrls", "images"):
                        val = model_resp.get(key)
                        if isinstance(val, list):
                            for item in val:
                                if isinstance(item, str) and is_likely_image_url(item):
                                    urls.append(item.rstrip(").,;]'\""))
                                elif isinstance(item, dict):
                                    for k in ("url", "imageUrl", "src", "hdUrl"):
                                        u = item.get(k)
                                        if isinstance(u, str) and is_likely_image_url(u):
                                            urls.append(u.rstrip(").,;]'\""))
                    msg = model_resp.get("message") or ""
                    if msg:
                        urls.extend(_extract_urls_from_text(str(msg)))
            except Exception:
                continue
        # 2) Deep walk as fallback (still filtered)
        if not urls:
            for ev in events:
                _walk_collect_urls(ev, urls, video=False)

        seen: set[str] = set()
        out: list[str] = []
        for u in urls:
            if u not in seen and is_likely_image_url(u):
                seen.add(u)
                out.append(u)
        if out:
            logger.info("Grok image URLs found: %s", [u[:90] for u in out[:5]])
        else:
            # debug: how many events, sample keys
            logger.warning(
                "Grok image parse empty — events=%s sample=%s",
                len(events),
                str(events[:1])[:400] if events else "[]",
            )
        return out

    async def _download(self, url: str, *, expect: str = "image") -> bytes:
        headers = {
            "User-Agent": _headers()["user-agent"],
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
            if expect == "image"
            else "*/*",
            "Referer": f"{GROK_ORIGIN}/imagine",
        }
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            # Prefer browser cookies when we have them (auth-walled CDN)
            res = await client.get(
                url,
                headers=headers,
                cookies=self.cookies if self._has_sso else None,
            )
            res.raise_for_status()
            data = res.content
        if expect == "image" and not _looks_like_image_bytes(data):
            ctype = (res.headers.get("content-type") or "").lower()
            raise ProviderError(
                f"URL không phải file ảnh (content-type={ctype}, "
                f"head={data[:40]!r}). URL: {url[:120]}",
                error_code=502,
            )
        if expect == "video" and (
            data.lstrip().startswith((b"<!doctype", b"<html", b"{")) or len(data) < 1000
        ):
            raise ProviderError(
                f"URL không phải video hợp lệ. URL: {url[:120]}",
                error_code=502,
            )
        return data

    @staticmethod
    def _normalize_aspect(aspect_ratio: str | None) -> str:
        ar = (aspect_ratio or "2:3").strip()
        if ar in _IMAGINE_ASPECTS:
            return ar
        aliases = {
            "portrait": "2:3",
            "landscape": "3:2",
            "square": "1:1",
            "vertical": "9:16",
            "horizontal": "16:9",
        }
        return aliases.get(ar.lower(), "2:3")

    @staticmethod
    def _build_imagine_init_messages(
        prompt: str,
        *,
        aspect_ratio: str,
        enable_pro: bool,
        enable_nsfw: bool = True,
    ) -> list[dict[str, Any]]:
        """Official Imagine WS client messages (same as grok.com / G-Labs)."""
        now_ms = int(time.time() * 1000)
        request_id = str(uuid.uuid4())
        reset = {
            "type": "conversation.item.create",
            "timestamp": now_ms,
            "item": {"type": "message", "content": [{"type": "reset"}]},
        }
        request = {
            "type": "conversation.item.create",
            "timestamp": now_ms,
            "item": {
                "type": "message",
                "content": [
                    {
                        "requestId": request_id,
                        "text": prompt,
                        "type": "input_text",
                        "properties": {
                            "section_count": 0,
                            "is_kids_mode": False,
                            "enable_nsfw": bool(enable_nsfw),
                            "skip_upsampler": False,
                            "enable_side_by_side": True,
                            "is_initial": False,
                            "aspect_ratio": aspect_ratio,
                            "enable_pro": bool(enable_pro),
                        },
                    }
                ],
            },
        }
        return [reset, request]

    async def _extension_gws_imagine(
        self,
        prompt: str,
        *,
        count: int = 1,
        aspect_ratio: str = "2:3",
        enable_pro: bool = False,
    ) -> list[dict[str, Any]]:
        """Queue kind=gws for Auth Helper → wss://grok.com/ws/imagine/listen."""
        from app.services.auth_bridge import auth_bridge
        from app.services.auth_bridge_access import auth_bridge_access

        if not auth_bridge_access.is_connected():
            raise ProviderError(
                "Auth Helper chưa kết nối bridge :18923. "
                "Bật «G-Labs Automation - Auth Helper».",
                error_code=0,
            )
        session = auth_bridge_access.get_primary_session()
        grok_state = (session.grok_tab_status if session else "closed") or "closed"
        if grok_state == "login_required":
            raise ProviderError(
                "Grok tab cần login — mở https://grok.com/imagine và đăng nhập.",
                error_code=0,
            )
        if grok_state != "open":
            raise ProviderError(
                "Chưa có tab Grok. Mở https://grok.com/imagine (login) và GIỮ tab. "
                f"Trạng thái: {grok_state}",
                error_code=0,
            )

        n = max(1, min(int(count or 1), 6))
        ar = self._normalize_aspect(aspect_ratio)
        init_messages = self._build_imagine_init_messages(
            prompt.strip(),
            aspect_ratio=ar,
            enable_pro=enable_pro,
        )
        task_id = auth_bridge.queue_grok_task(
            method="GET",
            url=WS_IMAGINE_URL,
            headers={},
            body=None,
            kind="gws",
            response_mode="stream",
            timeout_ms=180_000,
            inject_statsig=False,
            payload_extra={
                "initMessages": init_messages,
                # Wait for final 100% frames (previews are small / blurry)
                "idleTimeoutMs": 90_000,
                # Don't stop on first "completed" json — wait for image 100% frames
                "terminateOnCompletedStatus": False,
                "completeImageCount": n,
            },
        )
        logger.info(
            "Grok Imagine gws queued id=%s count=%s aspect=%s pro=%s",
            task_id,
            n,
            ar,
            enable_pro,
        )
        done = await self._wait_task(task_id, timeout=200.0)
        if done.get("error"):
            raise ProviderError(
                f"Grok Imagine WS lỗi: {done.get('error')}",
                error_code=502,
            )
        return self._events_from_done(done)

    # Intermediate Imagine WS previews are tiny JPEGs (~10–40KB). Full finals
    # are usually >>100KB when blob, or a CDN URL at percentage_complete=100.
    _MIN_FINAL_IMAGE_BYTES = 80_000

    @staticmethod
    def _decode_image_blob(blob: str, *, min_bytes: int = 0) -> bytes | None:
        if not blob or not isinstance(blob, str):
            return None
        raw = blob.strip()
        if raw.startswith("data:") and "," in raw:
            raw = raw.split(",", 1)[1]
        try:
            data = base64.b64decode(raw, validate=False)
        except Exception:
            return None
        if not _looks_like_image_bytes(data):
            return None
        if min_bytes and len(data) < min_bytes:
            return None
        return data

    def _collect_imagine_finals(
        self, events: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Group WS frames by image id; keep only completed / 100% slots.

        Intermediate progressive frames look valid but are low-res previews —
        that is why app output looked 'khác' / blurry vs web.
        """
        by_id: dict[str, dict[str, Any]] = {}
        order: list[str] = []

        def _ensure(iid: str) -> dict[str, Any]:
            if iid not in by_id:
                order.append(iid)
                by_id[iid] = {
                    "id": iid,
                    "url": "",
                    "blob": "",
                    "pct": 0,
                    "completed": False,
                    "width": 0,
                    "height": 0,
                }
            return by_id[iid]

        for ev in events:
            if not isinstance(ev, dict):
                continue
            obj = ev.get("obj") if isinstance(ev.get("obj"), dict) else ev
            if not isinstance(obj, dict):
                continue
            typ = obj.get("type")

            if typ == "image":
                url = str(obj.get("url") or "")
                blob = obj.get("blob") or ""
                pct_raw = obj.get("percentage_complete")
                try:
                    pct_i = int(float(pct_raw)) if pct_raw is not None else 0
                except (TypeError, ValueError):
                    pct_i = 0
                # Derive stable id from URL path when possible
                iid = str(obj.get("image_id") or obj.get("job_id") or "")
                if not iid and url:
                    m = re.search(r"/images/([a-f0-9\-]+)\.", url, re.I)
                    if m:
                        iid = m.group(1)
                if not iid:
                    iid = url or f"anon-{len(by_id)}"
                slot = _ensure(iid)
                if url:
                    slot["url"] = url
                # Always keep the latest (highest pct) blob
                if blob and pct_i >= slot["pct"]:
                    slot["blob"] = blob
                if pct_i >= slot["pct"]:
                    slot["pct"] = pct_i
                if pct_i >= 100:
                    slot["completed"] = True

            elif typ == "json":
                status = obj.get("current_status")
                iid = str(obj.get("image_id") or obj.get("job_id") or "")
                if not iid:
                    continue
                slot = _ensure(iid)
                if status == "start_stage":
                    slot["width"] = int(obj.get("width") or 0)
                    slot["height"] = int(obj.get("height") or 0)
                elif status == "completed":
                    slot["completed"] = True
                    slot["pct"] = max(slot["pct"], 100)
                    if obj.get("moderated"):
                        slot["moderated"] = True

        finals: list[dict[str, Any]] = []
        for iid in order:
            slot = by_id[iid]
            if slot.get("moderated"):
                continue
            if slot["completed"] or slot["pct"] >= 100:
                finals.append(slot)
        # If nothing marked complete, keep the highest-pct slot only as last resort
        if not finals and by_id:
            best = max(by_id.values(), key=lambda s: int(s.get("pct") or 0))
            if int(best.get("pct") or 0) >= 90:
                finals.append(best)
        return finals

    async def _materialize_imagine_images(
        self, finals: list[dict[str, Any]], limit: int
    ) -> list[bytes]:
        """Prefer CDN URL (full quality); blob only if large enough final."""
        out: list[bytes] = []
        for slot in finals:
            if len(out) >= limit:
                break
            url = str(slot.get("url") or "")
            blob = str(slot.get("blob") or "")
            data: bytes | None = None

            # 1) Download final URL (full res) — same as web Imagine gallery
            if url.startswith("http"):
                try:
                    data = await self._download(url, expect="image")
                    if data and len(data) < self._MIN_FINAL_IMAGE_BYTES:
                        logger.warning(
                            "Imagine URL small (%s B) — may be preview: %s",
                            len(data),
                            url[:80],
                        )
                except Exception as exc:
                    logger.warning("Imagine URL download failed %s: %s", url[:80], exc)
                    data = None

            # 2) Blob only when final (pct>=100) AND large enough (skip 20–40KB previews)
            if data is None:
                data = self._decode_image_blob(
                    blob, min_bytes=self._MIN_FINAL_IMAGE_BYTES
                )
            # 3) Last resort: any valid final blob (still better than nothing)
            if data is None and (slot.get("completed") or int(slot.get("pct") or 0) >= 100):
                data = self._decode_image_blob(blob, min_bytes=8_000)

            if data:
                out.append(data)
            else:
                logger.warning(
                    "Skip incomplete Imagine slot id=%s pct=%s url=%s blob_len=%s",
                    str(slot.get("id"))[:12],
                    slot.get("pct"),
                    url[:60],
                    len(blob),
                )
        return out

    async def generate_images(
        self,
        prompt: str,
        *,
        model: str = "grok-3",
        count: int = 2,
        aspect_ratio: str = "2:3",
    ) -> list[bytes]:
        """Generate via Imagine WebSocket (G-Labs path). Chat REST is last resort."""
        n = max(1, min(int(count or 1), 4))
        enable_pro = "quality" in str(model or "").lower() or "pro" in str(model or "").lower()
        text = prompt.strip()
        if not text:
            raise ProviderError("Missing prompt", error_code=400)

        # 1) Primary: Imagine WS through Auth Helper (avoids chat anti-bot code 7)
        try:
            events = await self._extension_gws_imagine(
                text,
                count=n,
                aspect_ratio=aspect_ratio,
                enable_pro=enable_pro,
            )
            finals = self._collect_imagine_finals(events)
            images = await self._materialize_imagine_images(finals, n)
            if images:
                logger.info(
                    "Grok Imagine WS ok: %s image(s) avg=%sB (skipped previews)",
                    len(images),
                    sum(len(x) for x in images) // max(1, len(images)),
                )
                return images[:n]
            logger.warning(
                "Imagine WS returned no final images — events=%s finals=%s sample=%s",
                len(events),
                len(finals),
                str(events[:2])[:400] if events else "[]",
            )
        except ProviderError as exc:
            msg = str(exc).lower()
            if any(
                x in msg
                for x in (
                    "chưa kết nối",
                    "login",
                    "chưa có tab",
                    "tab grok",
                )
            ):
                raise
            logger.warning("Imagine WS failed, chat fallback: %s", exc)

        # 2) Fallback: chat REST (often anti-bot code 7)
        logger.warning("Falling back to chat REST image gen (may hit anti-bot)")
        img_prompt = (
            f"{text}\n\n"
            "[Instruction: generate image with the image generation tool. "
            "Do not answer with text only. Do not link external websites.]"
        )
        payload = self._payload(img_prompt, model_name=model, image_count=n, for_video=False)
        payload["enableImageGeneration"] = True
        payload["imageGenerationCount"] = n
        payload["disableSearch"] = True
        events = await self._post_stream(payload)
        urls = self._parse_images(events)
        if not urls:
            raise ProviderError(
                "Grok không trả ảnh. Cần tab https://grok.com/imagine + Auth Helper "
                "(Imagine WS). Chat REST hay bị anti-bot code 7.",
                error_code=502,
            )
        images = []
        errors: list[str] = []
        for url in urls[: max(1, n * 2)]:
            if len(images) >= n:
                break
            try:
                images.append(await self._download(url, expect="image"))
            except Exception as exc:
                errors.append(f"{url[:60]}: {exc}")
                logger.warning("Download Grok image failed %s: %s", url[:80], exc)
        if not images:
            raise ProviderError(
                "Tải ảnh Grok thất bại. " + ("; ".join(errors[:2]) if errors else ""),
                error_code=502,
            )
        return images

    @staticmethod
    def _normalize_video_length(seconds: int | None) -> int:
        try:
            sec = int(seconds or 6)
        except (TypeError, ValueError):
            sec = 6
        if sec <= 6:
            return 6
        if sec <= 10:
            return 10
        return 15

    @staticmethod
    def _normalize_video_resolution(value: Any) -> str:
        if isinstance(value, list) and value:
            value = value[0]
        res = str(value or "480p").strip().lower()
        if res in _VIDEO_RESOLUTIONS:
            return res
        if "720" in res:
            return "720p"
        return "480p"

    @staticmethod
    def _json_from_gfetch_done(done: dict[str, Any]) -> dict[str, Any]:
        """Extract JSON object from Auth Helper gfetch done/chunk result."""
        if done.get("error"):
            raise ProviderError(f"Auth Helper Grok lỗi: {done.get('error')}", error_code=502)
        result = done.get("result") or {}
        # stream mode: events list
        if isinstance(result, dict):
            done_meta = result.get("done")
            if isinstance(done_meta, dict):
                for key in ("body", "json", "data", "result"):
                    val = done_meta.get(key)
                    if isinstance(val, dict):
                        return val
                    if isinstance(val, str) and val.strip().startswith("{"):
                        try:
                            return json.loads(val)
                        except json.JSONDecodeError:
                            pass
            for item in result.get("events") or []:
                if isinstance(item, dict):
                    return item
        if isinstance(result, dict) and result:
            return result
        # chunks
        for item in done.get("chunks") or []:
            if isinstance(item, dict):
                return item
        return {}

    async def _create_media_post(
        self,
        *,
        media_type: str,
        prompt: str = "",
        media_url: str = "",
    ) -> str:
        return await self._create_media_post_with_statsig(
            media_type=media_type,
            prompt=prompt,
            media_url=media_url,
            statsig_id=None,
        )

    async def _create_media_post_with_statsig(
        self,
        *,
        media_type: str,
        prompt: str = "",
        media_url: str = "",
        statsig_id: str | None = None,
    ) -> str:
        """POST /rest/media/post/create → parent post id (required for video gen)."""
        body: dict[str, Any] = {"mediaType": media_type}
        if prompt:
            body["prompt"] = prompt
        if media_url:
            body["mediaUrl"] = media_url
        sid = (statsig_id or "").strip() or None
        done = await self._extension_gfetch(
            body,
            url=MEDIA_POST_URL,
            response_mode="json",
            timeout_ms=60_000,
            # G-Labs: always injectStatsig — Auth Helper fills from _ftCache after warm
            inject_statsig=True,
            statsig_id=sid,
            use_synthetic_statsig=False,
        )
        if done.get("error") and self._is_antibot_error(str(done.get("error"))):
            raise ProviderError(str(done.get("error")), error_code=403)
        data = self._json_from_gfetch_done(done)
        post = data.get("post") if isinstance(data.get("post"), dict) else data
        post_id = str((post or {}).get("id") or data.get("id") or "").strip()
        if not post_id:
            # sometimes nested
            for key in ("result", "data"):
                nested = data.get(key)
                if isinstance(nested, dict):
                    p = nested.get("post") if isinstance(nested.get("post"), dict) else nested
                    post_id = str((p or {}).get("id") or "").strip()
                    if post_id:
                        break
        if not post_id:
            raise ProviderError(
                f"Grok media/post/create không trả post id: {str(data)[:240]}",
                error_code=502,
            )
        logger.info("Grok media post created id=%s type=%s", post_id[:16], media_type)
        return post_id

    def _video_stream_payload(
        self,
        prompt: str,
        *,
        parent_post_id: str,
        aspect_ratio: str,
        video_length: int,
        resolution_name: str,
        image_references: list[str] | None = None,
        preset: str = "custom",
    ) -> dict[str, Any]:
        """Payload for POST /rest/app-chat/conversations/new (imagine-video-gen)."""
        mode_flag = {
            "fun": "--mode=extremely-crazy",
            "normal": "--mode=normal",
            "spicy": "--mode=extremely-spicy-or-crazy",
            "custom": "--mode=custom",
        }.get(preset, "--mode=custom")
        message = f"{prompt.strip()} {mode_flag}".strip()
        video_gen_config: dict[str, Any] = {
            "parentPostId": parent_post_id,
            "aspectRatio": aspect_ratio,
            "videoLength": int(video_length),
            "resolutionName": resolution_name,
        }
        if image_references:
            video_gen_config["isVideoEdit"] = False
            video_gen_config["isReferenceToVideo"] = True
            video_gen_config["imageReferences"] = list(image_references)
        return {
            "temporary": True,
            "modelName": VIDEO_MODEL_NAME,
            "message": message,
            "enableSideBySide": True,
            "fileAttachments": [],
            "imageAttachments": [],
            "disableSearch": True,
            "enableImageGeneration": False,
            "returnImageBytes": False,
            "returnRawGrokInXaiRequest": False,
            "enableImageStreaming": False,
            "imageGenerationCount": 0,
            "forceConcise": False,
            "toolOverrides": {},
            "isPreset": False,
            "sendFinalMetadata": True,
            "customInstructions": "",
            "deepsearchPreset": "",
            "isReasoning": False,
            "responseMetadata": {
                "experiments": [],
                "modelConfigOverride": {
                    "modelMap": {
                        "videoGenModelConfig": video_gen_config,
                    }
                },
            },
        }

    def _parse_video_stream_url(self, events: list[dict[str, Any]]) -> str | None:
        """Extract final videoUrl from streamingVideoGenerationResponse events."""
        best_url = ""
        best_progress = -1
        for ev in events:
            if not isinstance(ev, dict):
                continue
            # walk common nestings
            candidates = [ev]
            result = ev.get("result")
            if isinstance(result, dict):
                candidates.append(result)
                resp = result.get("response")
                if isinstance(resp, dict):
                    candidates.append(resp)
            resp2 = ev.get("response")
            if isinstance(resp2, dict):
                candidates.append(resp2)

            for node in candidates:
                if not isinstance(node, dict):
                    continue
                stream = node.get("streamingVideoGenerationResponse")
                if not isinstance(stream, dict):
                    # sometimes nested under modelResponse
                    mr = node.get("modelResponse")
                    if isinstance(mr, dict):
                        stream = mr.get("streamingVideoGenerationResponse")
                if not isinstance(stream, dict):
                    continue
                try:
                    progress = int(float(stream.get("progress") or 0))
                except (TypeError, ValueError):
                    progress = 0
                if stream.get("moderated"):
                    continue
                raw = stream.get("videoUrl") or stream.get("video_url")
                if isinstance(raw, str) and raw.strip() and progress >= best_progress:
                    best_progress = progress
                    best_url = raw.strip()

        if not best_url:
            # deep walk any video-looking URL
            found: list[str] = []
            for ev in events:
                _walk_collect_urls(ev, found, video=True)
            for u in found:
                if is_likely_video_url(u):
                    return u
            return None

        if best_url.startswith("//"):
            best_url = "https:" + best_url
        elif best_url.startswith("/"):
            best_url = ASSETS_CDN.rstrip("/") + best_url
        return best_url

    async def generate_videos(
        self,
        prompt: str,
        *,
        model: str = "grok-3",
        aspect_ratio: str = "16:9",
        video_length: int = 6,
        resolution: str = "480p",
        mode: str = "t2v",
        reference_images: list[Any] | None = None,
    ) -> list[bytes]:
        """Grok Imagine video via Auth Helper (media post + app-chat stream).

        Protocol matches grok.com/imagine video + G-Labs desktop:
          1) POST /rest/media/post/create (parent post)
          2) POST /rest/app-chat/conversations/new model=imagine-video-gen
          3) parse streamingVideoGenerationResponse.videoUrl @ progress 100
        """
        text = (prompt or "").strip()
        if not text:
            raise ProviderError("Missing prompt", error_code=400)

        await self._require_grok_tab()

        # ── G-Labs style: ONLY Auth Helper (no companion required) ──
        # force_refresh_session fills Auth Helper _ftCache → injectStatsig on gfetch
        got_cache, optional_sid = await self._warm_for_video_auth_helper()
        logger.info(
            "Grok video Auth Helper warm gotStatsig=%s optionalHeader=%s",
            got_cache,
            bool(optional_sid),
        )

        ar = self._normalize_aspect(aspect_ratio if aspect_ratio in _IMAGINE_ASPECTS else aspect_ratio)
        if ar not in _IMAGINE_ASPECTS:
            ar = "16:9"
        length = self._normalize_video_length(video_length)
        res_name = self._normalize_video_resolution(resolution)
        mode_l = (mode or "t2v").lower()
        refs = reference_images or []

        async def _make_parent(sid: str | None) -> tuple[str, list[str]]:
            parent = ""
            img_refs: list[str] = []
            if mode_l in {"i2v", "start_image", "image_to_video"} and refs:
                first = refs[0]
                if isinstance(first, dict):
                    ref_url = str(
                        first.get("url")
                        or first.get("data")
                        or first.get("image")
                        or first.get("content_url")
                        or ""
                    )
                else:
                    ref_url = str(first or "")
                if ref_url.startswith("http") and "assets.grok.com" in ref_url:
                    try:
                        parent = await self._create_media_post_with_statsig(
                            media_type=_MEDIA_TYPE_IMAGE,
                            media_url=ref_url,
                            prompt="",
                            statsig_id=sid,
                        )
                        img_refs = [ref_url]
                    except ProviderError as exc:
                        logger.warning("i2v image media post failed: %s", exc)
            if not parent:
                parent = await self._create_media_post_with_statsig(
                    media_type=_MEDIA_TYPE_VIDEO,
                    prompt=text,
                    statsig_id=sid,
                )
            return parent, img_refs

        async def _run_video_stream(
            parent_id: str, img_refs: list[str], sid: str | None
        ) -> dict[str, Any]:
            payload = self._video_stream_payload(
                text,
                parent_post_id=parent_id,
                aspect_ratio=ar,
                video_length=length,
                resolution_name=res_name,
                image_references=img_refs or None,
            )
            logger.info(
                "Grok Imagine video start parent=%s ar=%s len=%ss res=%s inject=1",
                parent_id[:12],
                ar,
                length,
                res_name,
            )
            # Always injectStatsig=true like G-Labs desktop (uses Auth Helper _ftCache)
            return await self._extension_gfetch(
                payload,
                url=NEW_CHAT_URL,
                response_mode="stream",
                timeout_ms=300_000,
                inject_statsig=True,
                statsig_id=sid,
                referer=f"{GROK_ORIGIN}/imagine",
                use_synthetic_statsig=False,
            )

        parent_post_id, image_ref_urls = await _make_parent(optional_sid)
        done = await _run_video_stream(parent_post_id, image_ref_urls, optional_sid)

        # Anti-bot → warm again + full retry (G-Labs also re-warms session)
        if done.get("error") and self._is_antibot_error(str(done.get("error"))):
            logger.warning("video anti-bot — force_refresh + retry (Auth Helper only)")
            got2, sid2 = await self._warm_for_video_auth_helper()
            optional_sid = sid2 or optional_sid
            logger.info("retry warm gotStatsig=%s", got2)
            parent_post_id, image_ref_urls = await _make_parent(optional_sid)
            done = await _run_video_stream(parent_post_id, image_ref_urls, optional_sid)

        if done.get("error"):
            err = str(done.get("error"))
            if self._is_antibot_error(err):
                raise ProviderError(
                    "Grok video anti-bot (code 7). Chỉ cần Auth Helper như G-Labs: "
                    "(1) extension G-Labs Automation - Auth Helper bật, "
                    "(2) tab https://grok.com/imagine login SuperGrok, "
                    "(3) gen 1 clip trên web (để Auth Helper bắt x-statsig-id), "
                    "(4) gen app ngay — tab có thể nhảy URL 1–2 lần khi warm. "
                    f"({err[:100]})",
                    error_code=403,
                )
            raise ProviderError(f"Grok video lỗi: {err}", error_code=502)

        events = self._events_from_done(done)
        video_url = self._parse_video_stream_url(events)
        if not video_url:
            logger.warning(
                "Grok video no URL — events=%s sample=%s",
                len(events),
                str(events[:2])[:500] if events else "[]",
            )
            raise ProviderError(
                "Grok video không trả URL (cần SuperGrok + tab /imagine). "
                "Thử duration 6s, resolution 480p.",
                error_code=502,
            )

        logger.info("Grok video URL: %s", video_url[:120])
        data = await self._download(video_url, expect="video")
        if not data or len(data) < 1000:
            raise ProviderError("Tải video Grok rỗng / quá nhỏ", error_code=502)
        return [data]
