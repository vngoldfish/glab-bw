"""In-memory sliding-window rate limiter for Public API keys.

Provides per-key rate limiting (requests/minute) and daily quota checks.
Returns standard rate limit headers for API responses.
"""

import time
from collections import defaultdict
from dataclasses import dataclass


@dataclass
class RateLimitResult:
    """Result of a rate limit check."""

    allowed: bool
    limit: int
    remaining: int
    reset_at: float  # Unix timestamp when the window resets
    retry_after: int  # Seconds until retry (0 if allowed)
    reason: str = ""

    def headers(self) -> dict[str, str]:
        """Standard rate limit response headers."""
        return {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(max(0, self.remaining)),
            "X-RateLimit-Reset": str(int(self.reset_at)),
        }


class RateLimiter:
    """Sliding window rate limiter using in-memory timestamps."""

    def __init__(self) -> None:
        # key_id -> list of request timestamps
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._daily_counts: dict[str, list[float]] = defaultdict(list)

    def _cleanup_window(self, timestamps: list[float], window_seconds: float) -> list[float]:
        """Remove timestamps older than the window."""
        cutoff = time.time() - window_seconds
        return [t for t in timestamps if t > cutoff]

    def check_rate_limit(self, key_id: str, rate_limit: int) -> RateLimitResult:
        """Check per-minute rate limit. Does NOT consume a request."""
        now = time.time()
        window = 60.0  # 1 minute

        # Clean old entries
        self._windows[key_id] = self._cleanup_window(self._windows[key_id], window)
        count = len(self._windows[key_id])
        remaining = rate_limit - count

        if count >= rate_limit:
            # Find when the oldest request in window will expire
            oldest = min(self._windows[key_id]) if self._windows[key_id] else now
            reset_at = oldest + window
            retry_after = max(1, int(reset_at - now))
            return RateLimitResult(
                allowed=False,
                limit=rate_limit,
                remaining=0,
                reset_at=reset_at,
                retry_after=retry_after,
                reason=f"Rate limit exceeded: {rate_limit} requests/minute",
            )

        return RateLimitResult(
            allowed=True,
            limit=rate_limit,
            remaining=remaining,
            reset_at=now + window,
            retry_after=0,
        )

    def check_daily_quota(self, key_id: str, daily_quota: int) -> RateLimitResult:
        """Check daily quota. Does NOT consume a request."""
        now = time.time()
        day_seconds = 86400.0

        self._daily_counts[key_id] = self._cleanup_window(
            self._daily_counts[key_id], day_seconds
        )
        count = len(self._daily_counts[key_id])
        remaining = daily_quota - count

        if count >= daily_quota:
            oldest = min(self._daily_counts[key_id]) if self._daily_counts[key_id] else now
            reset_at = oldest + day_seconds
            retry_after = max(1, int(reset_at - now))
            return RateLimitResult(
                allowed=False,
                limit=daily_quota,
                remaining=0,
                reset_at=reset_at,
                retry_after=retry_after,
                reason=f"Daily quota exceeded: {daily_quota} requests/day",
            )

        return RateLimitResult(
            allowed=True,
            limit=daily_quota,
            remaining=remaining,
            reset_at=now + day_seconds,
            retry_after=0,
        )

    def consume(self, key_id: str) -> None:
        """Record a request for rate limiting."""
        now = time.time()
        self._windows[key_id].append(now)
        self._daily_counts[key_id].append(now)

    def check_and_consume(
        self, key_id: str, rate_limit: int, daily_quota: int
    ) -> RateLimitResult:
        """Check both rate limit and daily quota, consume if allowed."""
        # Check daily quota first
        daily_result = self.check_daily_quota(key_id, daily_quota)
        if not daily_result.allowed:
            return daily_result

        # Check per-minute rate
        rate_result = self.check_rate_limit(key_id, rate_limit)
        if not rate_result.allowed:
            return rate_result

        # Both OK — consume
        self.consume(key_id)
        # Return the more restrictive remaining count
        rate_result.remaining = min(rate_result.remaining - 1, daily_result.remaining - 1)
        return rate_result


# Singleton
rate_limiter = RateLimiter()
