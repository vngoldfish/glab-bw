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
    max_concurrent_tasks: int = 10
    output_dir: Path = PROJECT_ROOT / "data" / "output"
    data_dir: Path = PROJECT_ROOT / "data"
    cors_origins: list[str] = ["*"]
    poll_interval_seconds: float = 3.0
    task_timeout_seconds: int = 600

    def ensure_dirs(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        from app.services.reference_storage import ensure_reference_dirs

        ensure_reference_dirs()


settings = Settings()