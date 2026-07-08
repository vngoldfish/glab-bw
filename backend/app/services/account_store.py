import json
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from app.core.config import settings

ProviderType = Literal["flow", "grok", "meta", "openai"]


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


class AccountStore:
    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self._accounts: dict[str, Account] = {}
        self._rotation_index: dict[ProviderType, int] = {
            "flow": 0,
            "grok": 0,
            "meta": 0,
            "openai": 0,
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
            account = Account(**item)
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
        self._save()
        return account

    def delete(self, account_id: str) -> bool:
        if account_id not in self._accounts:
            return False
        del self._accounts[account_id]
        self._save()
        return True

    def _eligible(self, provider: ProviderType, for_video: bool) -> list[Account]:
        accounts = [
            a
            for a in self._accounts.values()
            if a.provider == provider
            and a.enabled
            and (a.video_enabled if for_video else a.image_enabled)
        ]
        return accounts

    def get_active(self, provider: ProviderType, for_video: bool = False) -> Account | None:
        eligible = self._eligible(provider, for_video)
        if not eligible:
            return None
        index = self._rotation_index.get(provider, 0) % len(eligible)
        account = eligible[index]
        self._rotation_index[provider] = index + 1
        account.last_used_at = time.time()
        self._save()
        return account


account_store = AccountStore(settings.data_dir / "accounts.json")