from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> project root (g-labs-bw/)
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "G-Labs BW"
    host: str = "127.0.0.1"
    port: int = 8765
    auth_bridge_url: str = "http://127.0.0.1:18923"
    api_key: str = ""
    # Safer default — Google Flow rate-limits hard at high concurrency
    max_concurrent_tasks: int = 5
    output_dir: Path = PROJECT_ROOT / "data" / "output"
    data_dir: Path = PROJECT_ROOT / "data"
    cors_origins: list[str] = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
    ]
    poll_interval_seconds: float = 3.0
    task_timeout_seconds: int = 600
    log_level: str = "INFO"

    @property
    def api_key_path(self) -> Path:
        return self.data_dir / "api_key.txt"

    def ensure_dirs(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "logs").mkdir(parents=True, exist_ok=True)
        from app.services.reference_storage import ensure_reference_dirs

        ensure_reference_dirs()

    def load_persisted_api_key(self) -> str | None:
        path = self.api_key_path
        if not path.is_file():
            return None
        try:
            key = path.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        return key or None

    def persist_api_key(self, key: str) -> None:
        self.ensure_dirs()
        path = self.api_key_path
        tmp = path.with_suffix(".tmp")
        tmp.write_text(key.strip() + "\n", encoding="utf-8")
        tmp.replace(path)


settings = Settings()
