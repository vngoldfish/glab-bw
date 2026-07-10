# G-Labs BW

Ứng dụng automation tạo ảnh/video hàng loạt qua Google Flow (Veo) / Grok, với Auth Helper Chrome extension.

## Yêu cầu

- **Python 3.11+**
- **Node.js 18+**
- **Chrome** + extension **G-Labs Automation - Auth Helper** (Flow reCAPTCHA)
- Tab [Google Flow Lab](https://labs.google/fx/tools/flow) đã đăng nhập
- **(Grok)** Load unpacked extension `extension-grok/` + tab [grok.com/imagine](https://grok.com/imagine)

## Cài đặt

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cd ../frontend && npm install
```

Tuỳ chọn: `cp .env.example .env`

## Chạy app

### macOS / Linux

```bash
chmod +x start.sh stop.sh status.sh start-backend-watchdog.sh

./start.sh                 # backend + Vite dev (:5173)
./start.sh --prod          # 1 process: UI static trên :8765
./start.sh --watchdog      # tự restart backend nếu chết
./start.sh --prod --watchdog

./status.sh
./stop.sh
```

Hoặc: `npm start` / `npm run start:prod` / `npm stop`

### Windows

```powershell
.\CHAY-APP.bat
.\TAT-APP.bat
```

### URL

| Mode | UI | API | Auth |
|------|----|-----|------|
| Dev | http://127.0.0.1:5173 | :8765 | :18923 |
| Prod (`--prod`) | http://127.0.0.1:8765 | :8765 | :18923 |

> Dùng **127.0.0.1** (tránh lỗi IPv6 `localhost` trên macOS).

## Chức năng giống G-Labs

| Tính năng | Nơi dùng |
|-----------|----------|
| Login browser → auto cookie | Settings → **Mở Chrome login Flow** |
| Dashboard stats | Menu **Dashboard** |
| Prompt Hub | Menu **Prompt Hub** |
| Import CSV prompts | Flow Ảnh / Flow Video → **Import CSV** |
| Pipeline Ảnh→Video | Flow Ảnh → **Ảnh→Video** |
| Tách frame video | Flow Video → **Tách frame** / **Frame từ KQ** |
| **Workflow + Project** | Menu **Workflow** — project lưu graph/nodes/preview; Tiếp tục / Tạo lại; chạy progressive |
| Multi-account + Webhook + Auth Helper | (đã có) |

### Workflow (giống G-Labs)

Node types: `prompt` · `reference` · `generate` · `video_generate` · `frame_extract`  
API: `GET/POST /api/workflows`, `POST /api/workflows/run`, `POST /api/workflows/{id}/run`

Playwright (login browser):

```bash
cd backend && source .venv/bin/activate
pip install playwright && playwright install chromium
```

## Ổn định vận hành (v0.2)

- Scripts start/stop/status + watchdog
- API key ổn định → `data/api_key.txt`
- Task history SQLite → `data/tasks.db`
- Atomic write: `accounts.json`, `ai_settings.json`
- Log rotate: `data/logs/backend.log`
- Health chi tiết + badge **Sẵn sàng gen** trên UI
- Session stale toast khi cookie Flow hỏng
- Retry policy tập trung (503/network trước khi xoay account)
- Batch async: `POST /api/batch/submit-async` + poll
- Export/import accounts + dọn output trong Settings
- Prod: `frontend/dist` serve trong FastAPI (1 process)
- Tests: UI Settings → **Chạy bài test**, hoặc CLI:

```bash
./test.sh           # all
./test.sh smoke     # nhanh
./test.sh api       # API TestClient
npm test
# hoặc khi app đang chạy:
curl -X POST http://127.0.0.1:8765/api/maintenance/run-tests \
  -H 'Content-Type: application/json' -d '{"suite":"all"}'
```

## Cấu trúc

```
g-labs-bw/
├── backend/           # FastAPI
├── frontend/          # React + Vite
├── extension-grok/
├── start.sh / stop.sh / status.sh
└── package.json       # npm start / build / test:smoke
```

## Lưu ý bảo mật

- Không commit `data/accounts.json`, `data/api_key.txt`, `data/ai_settings.json`, output, `.env`
- Export + secrets chỉ lưu local an toàn
