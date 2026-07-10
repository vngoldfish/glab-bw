import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.core.config import settings

ProviderType = Literal["flow", "grok", "meta", "openai"]

# After quota/rate-limit, skip account for this many seconds (default 1 hour)
DEFAULT_QUOTA_COOLDOWN_SEC = 3600


@dataclass
class Account:
    id: str
    provider: ProviderType
    label: str
    credentials: dict[str, str] = field(default_factory=dict)
    image_enabled: bool = True
    video_enabled: bool = True
    enabled: bool = True
    created_at: float = field(default_factory=time.time)
    last_used_at: float | None = None
    # Legacy unified cooldown (still used for UI + clear_cooldown)
    cooldown_until: float | None = None
    # Separate cooldowns: video quota must NOT block text→image
    image_cooldown_until: float | None = None
    video_cooldown_until: float | None = None
    last_error: str | None = None


class AccountStore:
    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self._accounts: dict[str, Account] = {}
        self._rotation_index: dict[str, int] = {
            "flow:image": 0,
            "flow:video": 0,
            "grok:video": 0,
            "meta:image": 0,
            "meta:video": 0,
            "openai:image": 0,
        }
        self._load()

    def _load(self) -> None:
        if not self.storage_path.exists():
            return
        try:
            data = json.loads(self.storage_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return
        for item in data.get("accounts", []):
            # Ignore unknown keys for forward compat
            known = {f.name for f in Account.__dataclass_fields__.values()}  # type: ignore[attr-defined]
            filtered = {k: v for k, v in item.items() if k in known}
            try:
                account = Account(**filtered)
            except TypeError:
                continue
            self._accounts[account.id] = account

    def _save(self) -> None:
        settings.ensure_dirs()
        payload = {
            "accounts": [
                {
                    "id": a.id,
                    "provider": a.provider,
                    "label": a.label,
                    "credentials": a.credentials,
                    "image_enabled": a.image_enabled,
                    "video_enabled": a.video_enabled,
                    "enabled": a.enabled,
                    "created_at": a.created_at,
                    "last_used_at": a.last_used_at,
                    "cooldown_until": a.cooldown_until,
                    "image_cooldown_until": a.image_cooldown_until,
                    "video_cooldown_until": a.video_cooldown_until,
                    "last_error": a.last_error,
                }
                for a in self._accounts.values()
            ]
        }
        self.storage_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def list_accounts(self, provider: ProviderType | None = None) -> list[Account]:
        accounts = list(self._accounts.values())
        if provider:
            accounts = [a for a in accounts if a.provider == provider]
        return sorted(accounts, key=lambda a: a.created_at)

    def get(self, account_id: str) -> Account | None:
        return self._accounts.get(account_id)

    def create(
        self,
        provider: ProviderType,
        label: str,
        credentials: dict[str, str],
        image_enabled: bool = True,
        video_enabled: bool = True,
        enabled: bool = True,
    ) -> Account:
        account = Account(
            id=secrets.token_hex(8),
            provider=provider,
            label=label,
            credentials=credentials,
            image_enabled=image_enabled,
            video_enabled=video_enabled,
            enabled=enabled,
        )
        self._accounts[account.id] = account
        self._save()
        return account

    def update(self, account_id: str, **updates) -> Account | None:
        account = self._accounts.get(account_id)
        if not account:
            return None
        for key, value in updates.items():
            if value is not None and hasattr(account, key):
                setattr(account, key, value)
        # Allow clearing cooldown with explicit None via clear_cooldown flag
        if updates.get("clear_cooldown"):
            account.cooldown_until = None
            account.image_cooldown_until = None
            account.video_cooldown_until = None
            account.last_error = None
        self._save()
        return account

    def delete(self, account_id: str) -> bool:
        if account_id not in self._accounts:
            return False
        del self._accounts[account_id]
        self._save()
        return True

    def _rot_key(self, provider: ProviderType, for_video: bool) -> str:
        kind = "video" if for_video else "image"
        return f"{provider}:{kind}"

    def _clear_expired(self, account: Account, attr: str) -> None:
        value = getattr(account, attr, None)
        if value and value <= time.time():
            setattr(account, attr, None)

    def _modality_in_cooldown(self, account: Account, *, for_video: bool) -> bool:
        """Check cooldown for image OR video only (video quota must not block image)."""
        now = time.time()
        # Expire stale fields
        dirty = False
        for attr in ("cooldown_until", "image_cooldown_until", "video_cooldown_until"):
            value = getattr(account, attr, None)
            if value and value <= now:
                setattr(account, attr, None)
                dirty = True
        if dirty and not account.last_error:
            pass
        if dirty:
            self._save()

        # Prefer modality-specific cooldown; fall back to legacy unified field
        # only when modality fields were never used (both None).
        specific = account.video_cooldown_until if for_video else account.image_cooldown_until
        if specific is not None:
            return specific > now
        if account.image_cooldown_until is None and account.video_cooldown_until is None:
            return bool(account.cooldown_until and account.cooldown_until > now)
        return False

    def _in_cooldown(self, account: Account) -> bool:
        """Any cooldown active (for UI badge)."""
        return self._modality_in_cooldown(account, for_video=True) or self._modality_in_cooldown(
            account, for_video=False
        )

    def _eligible(self, provider: ProviderType, for_video: bool) -> list[Account]:
        accounts = [
            a
            for a in self._accounts.values()
            if a.provider == provider
            and a.enabled
            and (a.video_enabled if for_video else a.image_enabled)
            and not self._modality_in_cooldown(a, for_video=for_video)
            and bool(a.credentials)
        ]
        return sorted(accounts, key=lambda a: a.created_at)

    def get_active(self, provider: ProviderType, for_video: bool = False) -> Account | None:
        """Round-robin next eligible account (skips cooldown / disabled)."""
        eligible = self._eligible(provider, for_video)
        if not eligible:
            return None
        key = self._rot_key(provider, for_video)
        index = self._rotation_index.get(key, 0) % len(eligible)
        account = eligible[index]
        self._rotation_index[key] = index + 1
        account.last_used_at = time.time()
        # Don't disk-write every rotate (heavy under batch); only touch memory
        return account

    def list_eligible(self, provider: ProviderType, for_video: bool = False) -> list[Account]:
        """All accounts that can be tried right now (for multi-account retry)."""
        return self._eligible(provider, for_video)

    def list_eligible_rotated(
        self, provider: ProviderType, for_video: bool = False
    ) -> list[Account]:
        """Eligible accounts rotated so next call starts at a different account."""
        eligible = self._eligible(provider, for_video)
        if not eligible:
            return []
        key = self._rot_key(provider, for_video)
        start = self._rotation_index.get(key, 0) % len(eligible)
        self._rotation_index[key] = start + 1
        return eligible[start:] + eligible[:start]

    def mark_used(self, account_id: str) -> None:
        account = self._accounts.get(account_id)
        if not account:
            return
        account.last_used_at = time.time()
        account.last_error = None
        self._save()

    def mark_quota_exhausted(
        self,
        account_id: str,
        *,
        reason: str = "quota",
        cooldown_sec: int = DEFAULT_QUOTA_COOLDOWN_SEC,
        for_video: bool | None = None,
    ) -> Account | None:
        """Put account modality on cooldown so rotation skips it for a while.

        for_video=True  → only video generation skips this account
        for_video=False → only image generation skips this account
        for_video=None  → legacy: block both (avoid)
        """
        account = self._accounts.get(account_id)
        if not account:
            return None
        until = time.time() + max(60, cooldown_sec)
        if for_video is True:
            account.video_cooldown_until = until
        elif for_video is False:
            account.image_cooldown_until = until
        else:
            account.cooldown_until = until
            account.image_cooldown_until = until
            account.video_cooldown_until = until
        # Keep unified field as the later of modality cooldowns (UI)
        account.cooldown_until = max(
            t
            for t in (
                account.cooldown_until,
                account.image_cooldown_until,
                account.video_cooldown_until,
            )
            if t
        )
        account.last_error = reason[:300]
        self._save()
        return account

    def clear_cooldown(self, account_id: str) -> Account | None:
        account = self._accounts.get(account_id)
        if not account:
            return None
        account.cooldown_until = None
        account.image_cooldown_until = None
        account.video_cooldown_until = None
        account.last_error = None
        self._save()
        return account


account_store = AccountStore(settings.data_dir / "accounts.json")
