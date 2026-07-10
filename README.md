# G-Labs BW

Ứng dụng automation tạo ảnh/video hàng loạt qua Google Flow (Veo) / Grok, với Auth Helper Chrome extension.

## Yêu cầu

- **Python 3.11+**
- **Node.js 18+**
- **Chrome** + extension **G-Labs Automation - Auth Helper** (Flow reCAPTCHA)
- Tab [Google Flow Lab](https://labs.google/fx/tools/flow) đã đăng nhập
- **(Grok)** Load unpacked extension `extension-grok/` + tab [grok.com/imagine](https://grok.com/imagine)

## Cài đặt

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Frontend

```bash
cd frontend
npm install
```

### Cấu hình (tuỳ chọn)

```bash
cp .env.example .env
```

## Chạy app

### macOS / Linux (khuyên dùng)

```bash
chmod +x start.sh stop.sh status.sh start-backend-watchdog.sh
./start.sh      # backend + frontend + mở browser
./status.sh     # kiểm tra health
./stop.sh       # tắt hết
```

Backend tự restart khi crash:

```bash
./start-backend-watchdog.sh
```

### Windows

```powershell
.\CHAY-APP.bat
# hoặc
.\start-all.ps1
```

Tắt:

```powershell
.\TAT-APP.bat
```

### URL

| Service | URL |
|---------|-----|
| Frontend | http://127.0.0.1:5173 |
| Backend API | http://127.0.0.1:8765 |
| Auth Bridge | http://127.0.0.1:18923 |
| Health | http://127.0.0.1:8765/api/health |

> Dùng **127.0.0.1** (không chỉ `localhost`) để tránh lỗi bind IPv6 trên macOS.

## Ổn định vận hành

- **API key** lưu `data/api_key.txt` — không đổi mỗi lần restart (webhook/n8n ổn định)
- **Task history** SQLite `data/tasks.db` — xem lại task sau restart
- **accounts.json** ghi atomic (temp + replace)
- **Log** rotate: `data/logs/backend.log`
- **Concurrency** mặc định 5 (giảm spam Google / captcha)
- Health trả thêm: extension, Flow tab, account sẵn sàng, disk free

## Cấu trúc dự án

```
g-labs-bw/
├── backend/          # FastAPI — API, Flow/Grok provider, auth bridge
├── frontend/         # React + Vite — giao diện
├── extension-grok/   # Chrome extension phụ trợ Grok
├── data/             # Runtime (không commit secrets/output)
├── start.sh / stop.sh / status.sh
├── start-backend-watchdog.sh
├── start-all.ps1     # Windows
└── CHAY-APP.bat
```

## Tính năng chính

- **Flow Ảnh / Video** — batch, hàng chờ, multi-account rotation
- **Grok Imagine** — cookie web + Auth Helper
- **Ảnh tham chiếu** — thư viện `@ten_anh`
- **Webhook API** — n8n / automation
- **Auth Helper** — reCAPTCHA / session bridge

## Lưu ý bảo mật

- Không commit `data/accounts.json`, `data/api_key.txt`, `data/ai_settings.json`, ảnh output, hoặc `.env`
- `API_KEY` tạo tự động lần đầu và ghi `data/api_key.txt`
