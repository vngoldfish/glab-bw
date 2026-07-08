import re
from typing import Any

from app.providers.base import ProviderError

_MENTION_PATTERN = re.compile(r"@([a-zA-Z][a-zA-Z0-9_]*)")


def _normalize_prompt(prompt: str) -> str:
    return prompt.replace("\uff20", "@")


def _ordered_mentions(prompt: str, ref_by_name: dict[str, dict[str, Any]]) -> list[str]:
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
) -> tuple[str, list[Any]]:
    """Map custom @names to ordered upload items.

    When rewrite_markers=True (Veo ingredients), replace @name with @reference_N.
    When False (Omni Flash assets), keep original @names in the prompt and only
    return ordered image items for referenceImages[].
    """
    prompt = _normalize_prompt(prompt)
    ref_by_name: dict[str, dict[str, Any]] = {}
    for item in named_refs:
        name = str(item.get("name") or "").strip().lower()
        if name:
            ref_by_name[name] = item

    ordered_names = _ordered_mentions(prompt, ref_by_name)

    if not ordered_names:
        return prompt, []

    if len(ordered_names) > 10:
        raise ProviderError("Tối đa 10 ảnh tham chiếu trong một prompt", error_code=400)

    rewritten_prompt = prompt
    if rewrite_markers:
        for index, name in enumerate(ordered_names):
            slot = index + 1
            pattern = re.compile(rf"@{re.escape(name)}(?![a-zA-Z0-9_])", re.IGNORECASE)
            rewritten_prompt = pattern.sub(f"@reference_{slot}", rewritten_prompt)

    ordered_items = [ref_by_name[name] for name in ordered_names]
    return rewritten_prompt, ordered_items