"""Rewrite / polish prompts via OpenAI-compatible Chat Completions API."""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx

from app.providers.base import ProviderError
from app.services.ai_settings_store import get_credentials

logger = logging.getLogger(__name__)

_MENTION_RE = re.compile(r"@([a-zA-Z][a-zA-Z0-9_]*)")


_STYLE_HINTS = {
    "light": (
        "Style level: LIGHT — clarify wording only, keep almost the same length, "
        "add at most one short quality phrase so the image/video model understands better."
    ),
    "pro": (
        "Style level: PRO — expand a short/casual idea into a clear professional generation prompt: "
        "subject, setting, lighting, composition (and motion for video). "
        "Still the SAME idea — no new story."
    ),
    "cinematic": (
        "Style level: CINEMATIC — expand with camera, light, atmosphere, texture. "
        "Keep same subject/action. At most ~2–3x original length. No new characters/plot."
    ),
}


def _system_prompt(
    kind: str,
    locale: str,
    *,
    style: str = "pro",
    custom_instruction: str = "",
) -> str:
    lang = "Vietnamese" if locale.startswith("vi") else "English"
    # Core product job: user types a short/generic prompt → AI rewrites for image/video models
    mission = (
        "Your job in G-Labs BW: the user pastes a SHORT or CASUAL prompt (ý tưởng chung chung). "
        "You ANALYZE it (who/what, where, action, mood) then REWRITE it into a PROFESSIONAL "
        "prompt that image/video AI models understand easily and generate better from. "
        "You are NOT chatting — only output the improved prompt.\n"
    )
    core = (
        "CRITICAL RULES — follow strictly:\n"
        "1) KEEP the same subject, people, place, action and meaning as the original.\n"
        "2) Do NOT invent a different story, new plot, or new characters.\n"
        "3) Expand vague ideas into concrete visual language the generator can follow "
        "(who, where, pose/action, lighting, composition"
        + (", camera motion / pacing" if kind == "video" else "")
        + ").\n"
        "4) Keep length controlled — not an essay; typically 1–4 sentences.\n"
        "5) @reference tokens (character library):\n"
        "   - If original HAS @name (e.g. @hoa), keep those EXACT tokens.\n"
        "   - If original has NO @name, do NOT add any @name. Never invent @someone.\n"
        "6) Prefer the same language as the user input when possible.\n"
    )
    style_key = (style or "pro").lower()
    # "custom" without instruction → treat as pro so rewrite still works
    if style_key == "custom" and not (custom_instruction or "").strip():
        style_key = "pro"
    style_hint = _STYLE_HINTS.get(style_key, _STYLE_HINTS["pro"])
    if kind == "video":
        task = (
            "Target: AI VIDEO generation (Google Flow / Veo, text-to-video, image-to-video). "
            "Make motion, camera, and timing clear when it fits the same action. "
        )
    else:
        task = (
            "Target: AI IMAGE generation (Google Flow still image). "
            "Make composition, lighting, detail, and style clear — not multi-second camera moves. "
        )
    extra = ""
    if custom_instruction.strip():
        extra = (
            "Extra user style instructions (follow if they do not break CRITICAL RULES):\n"
            f"{custom_instruction.strip()}\n"
        )
    return (
        f"{mission}{task}{core}{style_hint}\n{extra}"
        f"Write the improved prompt in {lang}. "
        "Return ONLY the improved prompt text — no quotes, no markdown, no explanation."
    )


def _strip_all_mentions(text: str) -> str:
    """Remove @name tokens and tidy leftover spaces."""
    cleaned = _MENTION_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    return cleaned.strip(" ,;|")


def _preserve_mentions(original: str, rewritten: str) -> str:
    """Keep original @mentions only; never invent @refs if original had none."""
    needed = list(dict.fromkeys(m.lower() for m in _MENTION_RE.findall(original)))
    text = rewritten.strip()

    # Original has no character refs → strip any @ the model invented
    if not needed:
        if _MENTION_RE.search(text):
            logger.info("Stripping AI-invented @mentions (original had none)")
            text = _strip_all_mentions(text)
        return text

    # Drop @mentions that were NOT in the original
    def _keep_only_original(match: re.Match[str]) -> str:
        name = match.group(1).lower()
        return match.group(0) if name in needed else ""

    text = _MENTION_RE.sub(_keep_only_original, text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip(" ,;|")

    # Ensure every original mention still appears
    missing = [
        m
        for m in needed
        if not re.search(rf"@{re.escape(m)}(?![a-zA-Z0-9_])", text, re.I)
    ]
    if missing:
        orig_map = {m.lower(): m for m in _MENTION_RE.findall(original)}
        prefix = " ".join(f"@{orig_map.get(m, m)}" for m in missing)
        text = f"{prefix} {text}".strip()
    return text


def _extract_message_text(data: dict[str, Any]) -> str:
    """Support OpenAI, OpenRouter, Gemini-proxy, and array content shapes."""
    # OpenAI / compatible
    try:
        content = data["choices"][0]["message"]["content"]
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict):
                    t = part.get("text") or part.get("content") or ""
                    if isinstance(t, str) and t:
                        parts.append(t)
            joined = "".join(parts).strip()
            if joined:
                return joined
    except (KeyError, IndexError, TypeError):
        pass

    # Some proxies: choices[0].text
    try:
        text = data["choices"][0].get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    except (KeyError, IndexError, TypeError, AttributeError):
        pass

    # Gemini-style proxy
    try:
        parts = data["candidates"][0]["content"]["parts"]
        texts = [str(p.get("text", "")) for p in parts if isinstance(p, dict)]
        joined = "".join(texts).strip()
        if joined:
            return joined
    except (KeyError, IndexError, TypeError):
        pass

    # Direct output field
    for key in ("output", "result", "prompt", "content"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()

    logger.warning("AI response unparsed keys=%s body=%s", list(data.keys())[:20], str(data)[:400])
    raise ProviderError(
        "Phản hồi API AI không đọc được (format lạ). Kiểm tra Model/Base URL trong Cài đặt → API AI",
        error_code=502,
    )


def _clean_output(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text.strip().strip('"').strip("'").strip()


def _resolve_endpoint(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    provider: str | None = None,
) -> tuple[str, str, str]:
    """Merge overrides with saved credentials → (api_key, base_url, model)."""
    raw = get_credentials()
    key = (api_key or "").strip() or str(raw.get("api_key") or "").strip()
    base = (base_url or "").strip() or str(raw.get("base_url") or "https://api.openai.com/v1")
    base = base.rstrip("/")
    mdl = (model or "").strip() or str(raw.get("model") or "gpt-4o-mini").strip()
    prov = (provider or "").strip() or str(raw.get("provider") or "openai_compatible")

    if prov == "grok" and "api.openai.com" in base:
        base = "https://api.x.ai/v1"
        if mdl in {"gpt-4o-mini", "gpt-4o", ""}:
            mdl = "grok-2-latest"

    if not key:
        raise ProviderError(
            "Chưa có API key — dán key trong Cấu hình AI (hoặc Lưu rồi Test)",
            error_code=400,
        )
    if not base:
        raise ProviderError("Thiếu Base URL trong Cấu hình AI", error_code=400)
    if not mdl:
        raise ProviderError("Thiếu Model trong Cấu hình AI", error_code=400)
    return key, base, mdl


async def test_connection(
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    provider: str | None = None,
) -> dict[str, Any]:
    """Ping chat/completions to verify API key + URL + model work."""
    import time

    key, base, mdl = _resolve_endpoint(
        api_key=api_key,
        base_url=base_url,
        model=model,
        provider=provider,
    )
    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": mdl,
        "temperature": 0,
        "max_tokens": 16,
        "messages": [
            {
                "role": "user",
                "content": "Reply with exactly one word: OK",
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    logger.info("AI test request url=%s model=%s", url, mdl)
    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(url, headers=headers, json=payload)
    except httpx.TimeoutException as exc:
        raise ProviderError(
            "Timeout — API không phản hồi trong 45s. Kiểm tra Base URL / mạng.",
            error_code=504,
        ) from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"Không kết nối được API AI: {exc}", error_code=502) from exc

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    if res.status_code >= 400:
        detail = res.text[:400]
        try:
            err = res.json()
            detail = str(
                err.get("error", {}).get("message")
                or err.get("message")
                or err.get("error")
                or detail
            )
        except Exception:
            pass
        raise ProviderError(
            f"API lỗi HTTP {res.status_code}: {detail}",
            error_code=res.status_code if 400 <= res.status_code <= 599 else 502,
        )

    try:
        data = res.json()
    except Exception as exc:
        raise ProviderError(
            f"API không trả JSON hợp lệ: {res.text[:200]}",
            error_code=502,
        ) from exc

    try:
        reply = _extract_message_text(data)
    except ProviderError:
        reply = ""

    return {
        "ok": True,
        "model": mdl,
        "base_url": base,
        "latency_ms": elapsed_ms,
        "reply": (reply or "")[:120],
        "message": f"Kết nối OK · model {mdl} · {elapsed_ms}ms",
    }


async def rewrite_prompt(
    prompt: str,
    *,
    kind: str = "video",
    locale: str = "vi",
) -> str:
    raw = get_credentials()
    if not raw.get("enabled"):
        raise ProviderError(
            "AI prompt chưa bật — Cài đặt → 1. Cấu hình AI → tick Bật + Lưu",
            error_code=400,
        )

    kind_key = "video" if kind == "video" else "image"
    if kind_key == "video" and not raw.get("video_enabled", True):
        raise ProviderError(
            "AI sửa prompt VIDEO đang tắt — bật trong Cài đặt → 2. Cấu hình Prompt",
            error_code=400,
        )
    if kind_key == "image" and not raw.get("image_enabled", True):
        raise ProviderError(
            "AI sửa prompt ẢNH đang tắt — bật trong Cài đặt → 2. Cấu hình Prompt",
            error_code=400,
        )

    style = str(raw.get(f"{kind_key}_style") or "pro")
    custom = str(raw.get(f"{kind_key}_custom_instruction") or "")
    api_key, base, model = _resolve_endpoint()

    system = _system_prompt(
        kind_key,
        locale,
        style=style,
        custom_instruction=custom,
    )
    temp = 0.25 if style == "light" else 0.35 if style == "pro" else 0.45

    url = f"{base}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "temperature": temp,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": (
                    f"The user wrote a short/casual idea. Analyze it and rewrite as a professional "
                    f"{'VIDEO' if kind_key == 'video' else 'IMAGE'} generation prompt "
                    "(clear for Google Flow / generation AI).\n"
                    "Keep the SAME meaning and subject. Expand only visual detail that fits. "
                    "Do NOT invent a new scene. "
                    "If the original has no @name tokens, do NOT add any @name tokens.\n\n"
                    f"Original (simple) prompt:\n{prompt.strip()}\n\n"
                    "Professional generation prompt:"
                ),
            },
        ],
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    logger.info("AI rewrite request url=%s model=%s prompt_len=%s", url, model, len(prompt))

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            res = await client.post(url, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        raise ProviderError(f"Không gọi được API AI: {exc}", error_code=502) from exc

    if res.status_code >= 400:
        detail = res.text[:500]
        try:
            err = res.json()
            detail = str(
                err.get("error", {}).get("message")
                or err.get("message")
                or detail
            )
        except Exception:
            pass
        logger.warning("AI rewrite HTTP %s: %s", res.status_code, detail[:200])
        raise ProviderError(
            f"API AI lỗi HTTP {res.status_code}: {detail}",
            error_code=res.status_code,
        )

    try:
        data = res.json()
    except Exception as exc:
        raise ProviderError(
            f"API AI không trả JSON: {res.text[:200]}",
            error_code=502,
        ) from exc

    text = _clean_output(_extract_message_text(data))
    if not text:
        raise ProviderError("AI trả về prompt rỗng", error_code=502)

    final = _preserve_mentions(prompt, text)

    # Guard: if model drifted too far (almost no word overlap), retry once with stricter prompt
    if _too_different(prompt, final):
        logger.warning("AI rewrite drifted too far — retrying with stricter keep-original rules")
        payload["temperature"] = 0.2
        payload["messages"][-1]["content"] = (
            "The rewrite changed the meaning too much. Try again.\n"
            "KEEP the exact same people, place, and action as the original. "
            "Only polish wording slightly. Keep @tokens.\n\n"
            f"Original:\n{prompt.strip()}\n\n"
            "Slightly improved version (same meaning):"
        )
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                res2 = await client.post(url, headers=headers, json=payload)
            if res2.status_code < 400:
                data2 = res2.json()
                text2 = _clean_output(_extract_message_text(data2))
                if text2:
                    alt = _preserve_mentions(prompt, text2)
                    if not _too_different(prompt, alt):
                        return alt
                    # Still bad: fall back to light local polish rather than wrong scene
                    logger.warning("Second rewrite still drifted — using light local polish")
                    return _light_local_polish(prompt, kind=kind)
        except Exception:
            pass
        if _too_different(prompt, final):
            return _light_local_polish(prompt, kind=kind)

    return final


def _tokenize(text: str) -> set[str]:
    return {
        t
        for t in re.findall(r"[a-zA-Z0-9_@àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]+", text.lower())
        if len(t) > 1
    }


def _too_different(original: str, rewritten: str) -> bool:
    """True if rewritten barely shares content with original (model invented a new scene)."""
    o = original.strip()
    r = rewritten.strip()
    if not o or not r:
        return False
    if o == r:
        return False
    # Very short original: only flag if rewritten is huge AND loses all tokens
    ot, rt = _tokenize(o), _tokenize(r)
    if not ot:
        return len(r) > max(80, len(o) * 4)
    overlap = len(ot & rt) / max(1, len(ot))
    # Less than 30% of original content words kept → too different
    if overlap < 0.3:
        return True
    # Rewritten more than 4x longer and weak overlap
    if len(r) > max(120, len(o) * 4) and overlap < 0.5:
        return True
    return False


def _light_local_polish(prompt: str, *, kind: str) -> str:
    """Fallback when remote model invents a new scene — gentle suffix, keep original body."""
    text = prompt.strip()
    if kind == "video":
        suffix = "cinematic, chuyển động mượt, ánh sáng tự nhiên"
    else:
        suffix = "chi tiết rõ, ánh sáng đẹp, chất lượng cao"
    # Avoid double-appending
    if suffix.split(",")[0] in text.lower():
        return text
    return f"{text}, {suffix}"
