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
    # Skip until unix timestamp (quota / rate limit)
    cooldown_until: float | None = None
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

    def _in_cooldown(self, account: Account) -> bool:
        if not account.cooldown_until:
            return False
        if account.cooldown_until <= time.time():
            # Auto-clear expired cooldown
            account.cooldown_until = None
            account.last_error = None
            self._save()
            return False
        return True

    def _eligible(self, provider: ProviderType, for_video: bool) -> list[Account]:
        accounts = [
            a
            for a in self._accounts.values()
            if a.provider == provider
            and a.enabled
            and (a.video_enabled if for_video else a.image_enabled)
            and not self._in_cooldown(a)
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
    ) -> Account | None:
        """Put account on cooldown so rotation skips it for a while."""
        account = self._accounts.get(account_id)
        if not account:
            return None
        account.cooldown_until = time.time() + max(60, cooldown_sec)
        account.last_error = reason[:300]
        self._save()
        return account

    def clear_cooldown(self, account_id: str) -> Account | None:
        account = self._accounts.get(account_id)
        if not account:
            return None
        account.cooldown_until = None
        account.last_error = None
        self._save()
        return account


account_store = AccountStore(settings.data_dir / "accounts.json")
