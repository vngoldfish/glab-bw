import re
from typing import Any

from app.providers.base import ProviderError

_MENTION_PATTERN = re.compile(r"@([a-zA-Z][a-zA-Z0-9_]*)")


def _normalize_prompt(prompt: str) -> str:
    return prompt.replace("\uff20", "@")


def _ordered_mentions(
    prompt: str,
    ref_by_name: dict[str, dict[str, Any]],
    *,
    strict_unknown: bool = True,
) -> list[str]:
    hits: list[tuple[int, str]] = []

    for name in ref_by_name:
        pattern = re.compile(rf"@{re.escape(name)}(?![a-zA-Z0-9_])", re.IGNORECASE)
        for match in pattern.finditer(prompt):
            hits.append((match.start(), name.lower()))

    for match in _MENTION_PATTERN.finditer(prompt):
        key = match.group(1).lower()
        if key in ref_by_name:
            hits.append((match.start(), key))

    hits.sort(key=lambda item: item[0])

    ordered: list[str] = []
    seen: set[str] = set()
    for _, key in hits:
        if key in seen:
            continue
        seen.add(key)
        ordered.append(key)

    if strict_unknown:
        for match in _MENTION_PATTERN.finditer(prompt):
            key = match.group(1).lower()
            if key in seen:
                continue
            if key not in ref_by_name:
                raise ProviderError(
                    f"Không tìm thấy ảnh tham chiếu '@{match.group(1)}' trong thư viện",
                    error_code=400,
                )

    return ordered


def resolve_prompt_references(
    prompt: str,
    named_refs: list[dict[str, Any]],
    *,
    rewrite_markers: bool = True,
    strict_unknown_mentions: bool = True,
    prefer_payload_order: bool = False,
) -> tuple[str, list[Any]]:
    """Map custom @names to ordered upload items.

    When rewrite_markers=True (Veo ingredients), replace @name with @reference_N.
    When False (Omni Flash assets), keep original @names in the prompt and only
    return ordered image items for referenceImages[].

    prefer_payload_order=True (I2V / first-last): use named_refs list order from the
    UI frame pickers; do not require @names in the prompt text.
    """
    prompt = _normalize_prompt(prompt)
    ref_by_name: dict[str, dict[str, Any]] = {}
    ordered_payload: list[Any] = []
    for item in named_refs:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip().lower()
        if name:
            ref_by_name[name] = item
        # Keep payload order for frame modes even without a name
        ordered_payload.append(item)

    if prefer_payload_order and ordered_payload:
        if len(ordered_payload) > 10:
            raise ProviderError("Tối đa 10 ảnh tham chiếu trong một prompt", error_code=400)
        normalized_payload = []
        for item in ordered_payload:
            ni = dict(item)
            if "name" in ni:
                ni["name"] = str(ni["name"]).strip().lower()
            normalized_payload.append(ni)
        return prompt, normalized_payload

    ordered_names = _ordered_mentions(
        prompt,
        ref_by_name,
        strict_unknown=strict_unknown_mentions,
    )

    if not ordered_names:
        # Fall back to payload order when prompt has no @ but client sent frames
        if ordered_payload and not strict_unknown_mentions:
            normalized_payload = []
            for item in ordered_payload:
                ni = dict(item)
                if "name" in ni:
                    ni["name"] = str(ni["name"]).strip().lower()
                normalized_payload.append(ni)
            return prompt, normalized_payload
        return prompt, []

    if len(ordered_names) > 10:
        raise ProviderError("Tối đa 10 ảnh tham chiếu trong một prompt", error_code=400)

    rewritten_prompt = prompt
    if rewrite_markers:
        for index, name in enumerate(ordered_names):
            slot = index + 1
            pattern = re.compile(rf"@{re.escape(name)}(?![a-zA-Z0-9_])", re.IGNORECASE)
            rewritten_prompt = pattern.sub(f"@reference_{slot}", rewritten_prompt)
    else:
        # Normalize prompt mentions to lowercase (e.g. @MODERNYOU -> @modernyou)
        for name in ordered_names:
            pattern = re.compile(rf"@{re.escape(name)}(?![a-zA-Z0-9_])", re.IGNORECASE)
            rewritten_prompt = pattern.sub(f"@{name}", rewritten_prompt)

    ordered_items = []
    for name in ordered_names:
        item = dict(ref_by_name[name])
        item["name"] = name  # name is already lowercased
        ordered_items.append(item)

    return rewritten_prompt, ordered_items