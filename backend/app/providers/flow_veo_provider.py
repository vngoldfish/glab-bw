from typing import Any

from app.providers.base import BaseProvider, ProviderError

from app.services.account_store import Account
from app.services.auth_bridge_access import auth_bridge_access
from app.services.flow_client import google_flow_client
from app.services.flow_session import flow_session_manager
from app.services.reference_image_loader import load_reference_image
from app.services.reference_resolver import resolve_prompt_references


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

    async def _session(self) -> dict[str, str]:
        if self.account is None:
            raise ProviderError("No active Flow account available", error_code=0)
        self._ensure_bridge()
        return await flow_session_manager.ensure_session(self.account, google_flow_client)

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
            media_id = await google_flow_client.upload_image(
                access_token=session["access_token"],
                project_id=session["project_id"],
                image_bytes=raw,
                mime_type=mime_type,
            )
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
        session = await self._session()
        mode = params.get("mode", "text_to_video")
        refs = params.get("reference_images", [])
        start_media_id = None
        end_media_id = None

        if mode in {"start_image", "start_end_image", "components"} and refs:
            first_parsed = _parse_reference_image(refs[0])
            if not first_parsed:
                raise ProviderError("reference_images[0] không hợp lệ", error_code=400)
            first_raw, first_mime = first_parsed
            start_media_id = await google_flow_client.upload_image(
                access_token=session["access_token"],
                project_id=session["project_id"],
                image_bytes=first_raw,
                mime_type=first_mime,
            )
            if mode == "start_end_image" and len(refs) > 1:
                second_parsed = _parse_reference_image(refs[1])
                if not second_parsed:
                    raise ProviderError("reference_images[1] không hợp lệ", error_code=400)
                second_raw, second_mime = second_parsed
                end_media_id = await google_flow_client.upload_image(
                    access_token=session["access_token"],
                    project_id=session["project_id"],
                    image_bytes=second_raw,
                    mime_type=second_mime,
                )

        return await google_flow_client.generate_video(
            access_token=session["access_token"],
            project_id=session["project_id"],
            prompt=prompt,
            model=params.get("model", "veo_31_fast"),
            aspect_ratio=params.get("aspect_ratio", "16:9"),
            mode=mode,
            start_media_id=start_media_id,
            end_media_id=end_media_id,
            user_paygate_tier=session.get("user_paygate_tier", "PAYGATE_TIER_ONE"),
            resolution_targets=params.get("resolution", []),
        )