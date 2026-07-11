from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py -> project root (g-labs-bw/)
PROJECT_ROOT = Path(__file__).resolve().parents[3]

# ─────────────────────────────────────────────────────────────────────────────
# Giá trị CORS_ORIGINS mặc định khi KHÔNG có .env (môi trường local dev)
# ─────────────────────────────────────────────────────────────────────────────
_LOCAL_ORIGINS = [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
]


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

    # ── CORS ──────────────────────────────────────────────────────────────────
    # Danh sách origins được phép, phân cách bằng dấu phẩy trong .env
    # VD: CORS_ORIGINS=https://myapp.com,https://www.myapp.com
    # Để trống → dùng giá trị mặc định local (127.0.0.1:5173, localhost:8765...)
    cors_origins_raw: str = ""

    # Đặt CORS_ALLOW_ALL=true chỉ khi cần debug hoặc mạng nội bộ hoàn toàn tin tưởng
    # KHÔNG bao giờ dùng trên server public có API key thật
    cors_allow_all: bool = False

    # Domain VPS (không cần http/https) — server tự thêm cả http và https
    # VD: VPS_DOMAIN=myapp.example.com → thêm https://myapp.example.com
    vps_domain: str = ""

    poll_interval_seconds: float = 3.0
    task_timeout_seconds: int = 600
    log_level: str = "INFO"

    # ── Tính toán cors_origins từ các biến trên ───────────────────────────────
    @property
    def cors_origins(self) -> list[str]:
        # 1. Nếu bật allow_all → trả về wildcard (dùng nội bộ hoặc debug)
        if self.cors_allow_all:
            return ["*"]

        origins: list[str] = []

        # 2. Luôn bao gồm localhost (cần cho dev và VPS dùng proxy ngược)
        origins.extend(_LOCAL_ORIGINS)

        # 3. Nếu có VPS_DOMAIN → tự động thêm https và http
        if self.vps_domain:
            domain = self.vps_domain.strip().rstrip("/")
            # Loại bỏ prefix nếu người dùng đã viết đầy đủ
            bare = domain.replace("https://", "").replace("http://", "")
            origins.append(f"https://{bare}")
            origins.append(f"http://{bare}")
            origins.append(f"https://www.{bare}")

        # 4. Nếu có CORS_ORIGINS trong .env → tách ra và thêm vào
        if self.cors_origins_raw:
            for o in self.cors_origins_raw.split(","):
                o = o.strip()
                if o and o not in origins:
                    origins.append(o)

        # Loại bỏ trùng lặp, giữ thứ tự
        seen: set[str] = set()
        result: list[str] = []
        for o in origins:
            if o not in seen:
                seen.add(o)
                result.append(o)
        return result

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
