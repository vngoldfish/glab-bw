"""Central retry policy for provider / network calls."""

from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# HTTP / provider codes that are worth retrying on the same account
RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})

# Soft error substrings (lowercase)
RETRYABLE_NEEDLES = (
    "unavailable",
    "temporarily",
    "timeout",
    "timed out",
    "connection reset",
    "connection aborted",
    "econnreset",
    "503",
    "502",
    "504",
    "busy",
    "try again",
    "throttl",
)

SESSION_STALE_NEEDLES = (
    "unauthenticated",
    "permission_denied",
    "does not have permission",
    "invalid session",
    "session expired",
    "cookie",
    "401",
    "403",
    "đăng nhập",
    "dang nhap",
    "dán lại cookie",
    "dan lai cookie",
)


def is_retryable_error(exc: BaseException) -> bool:
    code = int(getattr(exc, "error_code", 0) or 0)
    if code in RETRYABLE_STATUS:
        # 429 often means quota — still retryable once with backoff, then rotate
        return True
    msg = str(exc).lower()
    return any(n in msg for n in RETRYABLE_NEEDLES)


def is_session_stale_error(exc: BaseException) -> bool:
    code = int(getattr(exc, "error_code", 0) or 0)
    if code in {401, 403}:
        return True
    msg = str(exc).lower()
    return any(n in msg for n in SESSION_STALE_NEEDLES)


async def with_retries(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 1.5,
    max_delay: float = 20.0,
    retry_if: Callable[[BaseException], bool] | None = None,
    label: str = "op",
) -> T:
    """Run async fn with exponential backoff + jitter on retryable errors."""
    check = retry_if or is_retryable_error
    last: BaseException | None = None
    tries = max(1, attempts)
    for attempt in range(tries):
        try:
            return await fn()
        except Exception as exc:
            last = exc
            if attempt + 1 >= tries or not check(exc):
                raise
            delay = min(max_delay, base_delay * (2**attempt))
            delay *= 0.7 + random.random() * 0.6  # jitter
            logger.warning(
                "%s failed try=%s/%s (%s) — retry in %.1fs",
                label,
                attempt + 1,
                tries,
                exc,
                delay,
            )
            await asyncio.sleep(delay)
    assert last is not None
    raise last
