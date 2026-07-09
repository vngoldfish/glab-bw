import logging
from typing import Any

from app.providers.base import BaseProvider, ProviderError
from app.services.account_store import Account
from app.services.auth_bridge_access import auth_bridge_access
from app.services.flow_client import google_flow_client
from app.services.flow_media_cache import get_media_id, invalidate_for_bytes, set_media_id
from app.services.flow_session import flow_session_manager
from app.services.reference_image_loader import load_reference_image
from app.services.reference_resolver import resolve_prompt_references

logger = logging.getLogger(__name__)


def _parse_reference_image(item: Any) -> tuple[bytes, str] | None:
    return load_reference_image(item)


class FlowVeoProvider(BaseProvider):
    """Google Flow / Veo qua API nội bộ aisandbox-pa.googleapis.com + Auth Helper."""

    name = "flow_veo"

    def __init__(self, account: Account | None = None) -> None:
        self.account = account

    def _ensure_bridge(self) -> None:
        if not auth_bridge_access.is_bridge_running():
            raise ProviderError(
                "Auth Bridge chưa chạy — chạy .\\start-backend.ps1 (cần port 18923 + 8765)",
                error_code=0,
            )
        if not auth_bridge_access.is_connected():
            raise ProviderError(
                "Auth Helper chưa kết nối — mở Chrome, cài extension, tab labs.google/fx/tools/flow",
                error_code=0,
            )
        session = auth_bridge_access.get_primary_session()
        if not session or session.flow_tab_status != "open":
            raise ProviderError(
                "Chưa mở tab labs.google/fx/tools/flow — đăng nhập Google và mở Flow Lab",
                error_code=0,
            )

    async def _session(self, *, force_refresh: bool = False) -> dict[str, str]:
        if self.account is None:
            raise ProviderError("No active Flow account available", error_code=0)
        self._ensure_bridge()
        return await flow_session_manager.ensure_session(
            self.account,
            google_flow_client,
            force_refresh=force_refresh,
        )

    async def _ensure_flow_media_id(
        self,
        session: dict[str, str],
        image_bytes: bytes,
        mime_type: str,
        *,
        force_reupload: bool = False,
    ) -> str:
        """Upload once per (project, image bytes); reuse mediaId on later generations."""
        project_id = session["project_id"]
        if not force_reupload:
            cached = get_media_id(project_id, image_bytes)
            if cached:
                return cached

        media_id = await google_flow_client.upload_image(
            access_token=session["access_token"],
            project_id=project_id,
            image_bytes=image_bytes,
            mime_type=mime_type,
            # Visible upload — hidden assets often fail video reference with PERMISSION_DENIED
            hidden=False,
        )
        set_media_id(project_id, image_bytes, media_id)
        return media_id

    async def _ensure_flow_media_id_resilient(
        self,
        session: dict[str, str],
        image_bytes: bytes,
        mime_type: str,
    ) -> str:
        """Use cache; on permission-style failures re-upload a fresh visible mediaId."""
        try:
            return await self._ensure_flow_media_id(session, image_bytes, mime_type)
        except ProviderError as exc:
            msg = str(exc).lower()
            if "permission" not in msg and "403" not in msg:
                raise
            invalidate_for_bytes(image_bytes)
            return await self._ensure_flow_media_id(
                session,
                image_bytes,
                mime_type,
                force_reupload=True,
            )

    async def _build_reference_inputs(
        self,
        session: dict[str, str],
        reference_items: list[Any],
    ) -> list[dict[str, Any]]:
        image_inputs: list[dict[str, Any]] = []
        failed = 0
        for item in reference_items[:10]:
            parsed = _parse_reference_image(item)
            if not parsed:
                failed += 1
                continue
            raw, mime_type = parsed
            media_id = await self._ensure_flow_media_id_resilient(session, raw, mime_type)
            image_inputs.append(
                {
                    "name": media_id,
                    "imageInputType": "IMAGE_INPUT_TYPE_REFERENCE",
                }
            )

        if reference_items and not image_inputs:
            raise ProviderError(
                "Ảnh tham chiếu không hợp lệ — hãy chọn file PNG/JPG/WebP nhỏ hơn 10MB",
                error_code=400,
            )
        if failed:
            raise ProviderError(
                f"{failed} ảnh tham chiếu không đọc được — kiểm tra lại định dạng file",
                error_code=400,
            )
        return image_inputs

    async def generate_image(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        session = await self._session()
        aspect_ratio = params.get("aspect_ratio", "1:1")
        named_refs = params.get("named_references", [])
        resolved_prompt, named_items = resolve_prompt_references(prompt, named_refs)
        if named_items:
            reference_items = named_items
            prompt = resolved_prompt
        else:
            reference_items = params.get("reference_images", [])

        image_inputs = await self._build_reference_inputs(session, reference_items)
        count = max(1, min(int(params.get("count", 1)), 4))

        return await google_flow_client.generate_image(
            access_token=session["access_token"],
            project_id=session["project_id"],
            prompt=prompt,
            model=params.get("model", "nano_banana_2"),
            aspect_ratio=aspect_ratio,
            user_paygate_tier=session.get("user_paygate_tier", "PAYGATE_TIER_ONE"),
            reference_images=image_inputs,
            upscale_targets=params.get("upscale", []),
            count=count,
        )

    async def generate_video(self, prompt: str, params: dict[str, Any]) -> list[bytes]:
        # Always refresh token for video — stale AT often surfaces as PERMISSION_DENIED
        # even when Flow web (browser cookies) still works.
        session = await self._session(force_refresh=True)
        mode = str(params.get("mode", "text_to_video"))
        model = str(params.get("model", "veo_31_fast"))
        is_omni = model in {"omni_flash", "gemini_omni_flash", "omni"}
        named_refs = params.get("named_references", [])

        # I2V / first-last: frames come from UI pickers (named_references order),
        # not from @mentions in the prompt text.
        frame_mode = mode in {"start_image", "start_end_image"}
        rewrite = mode == "components" and not is_omni
        resolved_prompt, named_items = resolve_prompt_references(
            prompt,
            named_refs if isinstance(named_refs, list) else [],
            rewrite_markers=rewrite,
            # Frame modes: ignore stray @foo in prompt; use picker payload order
            strict_unknown_mentions=not frame_mode and mode != "text_to_video",
            prefer_payload_order=frame_mode,
        )

        if named_items:
            reference_items = named_items
            prompt = resolved_prompt
        else:
            reference_items = list(params.get("reference_images") or [])

        # Auto-upgrade plain T2V only when user did not pick an explicit frame mode
        if mode == "text_to_video" and named_items:
            mode = "components" if len(named_items) >= 2 else "start_image"

        # Strict validation for frame modes (do NOT silently rewrite to ingredients)
        if mode == "start_image" and not reference_items:
            raise ProviderError(
                "Ảnh → Video cần 1 ảnh đầu: chọn ở cột Ảnh đầu trên bảng hàng chờ",
                error_code=400,
            )
        if mode == "start_end_image" and len(reference_items) < 2:
            raise ProviderError(
                "Video đầu→cuối cần 2 ảnh: chọn Ảnh đầu và Ảnh cuối trên bảng hàng chờ",
                error_code=400,
            )
        if mode == "components" and not reference_items:
            raise ProviderError(
                "Ingredients cần ít nhất 1 @tên trong prompt (ảnh có trong thư viện tham chiếu)",
                error_code=400,
            )

        # For I2V / FL only first (and second) ordered mentions are frames
        if mode == "start_image" and len(reference_items) > 1:
            reference_items = reference_items[:1]
        elif mode == "start_end_image" and len(reference_items) > 2:
            reference_items = reference_items[:2]

        # Veo R2V max 3; Omni up to 7
        max_refs = 7 if is_omni else 3
        if mode == "components" and len(reference_items) > max_refs:
            reference_items = reference_items[:max_refs]

        start_media_id = None
        end_media_id = None
        reference_media_ids: list[str] = []

        if mode == "components" and reference_items:
            image_inputs = await self._build_reference_inputs(session, reference_items)
            reference_media_ids = [item["name"] for item in image_inputs]
        elif mode == "start_image" and reference_items:
            # First @mention / first ref = start frame only
            first_parsed = _parse_reference_image(reference_items[0])
            if not first_parsed:
                raise ProviderError("Ảnh khung đầu không hợp lệ (PNG/JPG/WebP < 10MB)", error_code=400)
            first_raw, first_mime = first_parsed
            start_media_id = await self._ensure_flow_media_id_resilient(
                session, first_raw, first_mime
            )
        elif mode == "start_end_image" and len(reference_items) >= 2:
            # Ordered: picker[0] = start, picker[1] = end.
            # Always force fresh upload for FL — stale/hidden cache mediaIds often
            # submit OK then poll MEDIA_GENERATION_STATUS_FAILED.
            first_parsed = _parse_reference_image(reference_items[0])
            second_parsed = _parse_reference_image(reference_items[1])
            if not first_parsed:
                raise ProviderError("Ảnh khung đầu không hợp lệ (PNG/JPG/WebP)", error_code=400)
            if not second_parsed:
                raise ProviderError("Ảnh khung cuối không hợp lệ (PNG/JPG/WebP)", error_code=400)
            first_raw, first_mime = first_parsed
            second_raw, second_mime = second_parsed
            if first_raw == second_raw:
                raise ProviderError(
                    "Ảnh đầu và ảnh cuối trùng nhau — chọn 2 ảnh khác nhau cho video đầu→cuối",
                    error_code=400,
                )
            invalidate_for_bytes(first_raw)
            invalidate_for_bytes(second_raw)
            start_media_id = await self._ensure_flow_media_id(
                session, first_raw, first_mime, force_reupload=True
            )
            end_media_id = await self._ensure_flow_media_id(
                session, second_raw, second_mime, force_reupload=True
            )

        duration = params.get("duration") or params.get("video_length")
        try:
            duration_int = int(duration) if duration is not None else None
        except (TypeError, ValueError):
            duration_int = None

        video_kwargs = dict(
            access_token=session["access_token"],
            session_token=session["session_token"],
            project_id=session["project_id"],
            prompt=prompt,
            model=model,
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            mode=mode,
            start_media_id=start_media_id,
            end_media_id=end_media_id,
            reference_media_ids=reference_media_ids,
            user_paygate_tier=session.get("user_paygate_tier", "PAYGATE_TIER_ONE"),
            resolution_targets=params.get("resolution", []),
            duration=duration_int,
        )
        try:
            return await google_flow_client.generate_video(**video_kwargs)
        except ProviderError as exc:
            msg = str(exc).lower()
            # reCAPTCHA evaluation failed: refresh AT + retry once with brand-new captcha tokens
            if "recaptcha" in msg:
                logger.warning("Video reCAPTCHA fail — force session refresh + retry once")
                session = await self._session(force_refresh=True)
                video_kwargs["access_token"] = session["access_token"]
                video_kwargs["session_token"] = session["session_token"]
                video_kwargs["project_id"] = session["project_id"]
                video_kwargs["user_paygate_tier"] = session.get(
                    "user_paygate_tier", "PAYGATE_TIER_ONE"
                )
                return await google_flow_client.generate_video(**video_kwargs)
            # Cached / hidden mediaIds may fail with PERMISSION_DENIED — reupload once
            if "permission" not in msg or not reference_items:
                raise
            if mode == "components":
                image_inputs = []
                for item in reference_items[:10]:
                    parsed = _parse_reference_image(item)
                    if not parsed:
                        continue
                    raw, mime_type = parsed
                    invalidate_for_bytes(raw)
                    mid = await self._ensure_flow_media_id(
                        session, raw, mime_type, force_reupload=True
                    )
                    image_inputs.append(mid)
                video_kwargs["reference_media_ids"] = image_inputs
            elif mode in {"start_image", "start_end_image"} and reference_items:
                first_parsed = _parse_reference_image(reference_items[0])
                if first_parsed:
                    first_raw, first_mime = first_parsed
                    invalidate_for_bytes(first_raw)
                    video_kwargs["start_media_id"] = await self._ensure_flow_media_id(
                        session, first_raw, first_mime, force_reupload=True
                    )
                if mode == "start_end_image" and len(reference_items) > 1:
                    second_parsed = _parse_reference_image(reference_items[1])
                    if second_parsed:
                        second_raw, second_mime = second_parsed
                        invalidate_for_bytes(second_raw)
                        video_kwargs["end_media_id"] = await self._ensure_flow_media_id(
                            session, second_raw, second_mime, force_reupload=True
                        )
            return await google_flow_client.generate_video(**video_kwargs)