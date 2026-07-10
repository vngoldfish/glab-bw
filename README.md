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
| **Dựng video (NLE)** | Menu **Dựng video** — timeline đa track (Video/Audio/Text), phụ đề nhiều kiểu, BGM, xuất MP4 FFmpeg |
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

## Hướng dẫn Gọi API từ xa (Remote API & Webhook Integration)

Ứng dụng hỗ trợ gọi từ các công cụ tự động hóa như **n8n**, **Make.com**, hoặc lệnh `curl` từ xa. Máy chủ tự động lắng nghe trên mọi giao diện mạng (`0.0.0.0`) sau khi chạy `./start.sh`.

### 1. Xác thực (Authentication)
Mọi yêu cầu gửi đến API từ xa cần đính kèm API Key (được lưu tại `data/api_key.txt`) thông qua Header:
```http
X-API-Key: <MÃ_API_KEY_CỦA_BẠN>
```

### 2. Các API Quản lý & Chạy Workflow từ xa

#### a) Lấy danh sách Workflow đã lưu
- **Endpoint:** `GET /api/webhook/workflows`
- **Lệnh mẫu:**
  ```bash
  curl -H "X-API-Key: <API_KEY>" http://<IP_MÁY_CHỦ>:8765/api/webhook/workflows
  ```

#### b) Kích hoạt chạy Workflow (Run Workflow)
- **Endpoint:** `POST /api/webhook/workflows/{workflow_id}/run`
- **Body JSON:**
  - `async_mode` (boolean, mặc định: `true`): Trả về `run_id` ngay lập tức để poll trạng thái, hoặc chạy đồng bộ đợi kết quả hoàn thành nếu đặt là `false`.
  - `project_id` (string, tùy chọn): Chỉ định project lưu trữ output.
  - `node_overrides` (object, tùy chọn): Ghi đè dữ liệu đầu vào của các nút (ví dụ: đổi prompt tạo ảnh/video).
- **Lệnh mẫu (ghi đè prompt của nút `n_prompt`):**
  ```bash
  curl -X POST -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
      "async_mode": true,
      "node_overrides": {
        "n_prompt": {
          "prompt": "A beautiful majestic flying dragon in clouds, cinematic 4k"
        }
      }
    }' \
    http://<IP_MÁY_CHỦ>:8765/api/webhook/workflows/workflows_sample_id/run
  ```
- **Phản hồi:** Trả về mã chạy `run_id` và URL kiểm tra trạng thái (`poll_url`).

#### c) Kiểm tra trạng thái chạy Workflow (Poll Run Status)
- **Endpoint:** `GET /api/webhook/workflows/runs/{run_id}`
- **Lệnh mẫu:**
  ```bash
  curl -H "X-API-Key: <API_KEY>" http://<IP_MÁY_CHỦ>:8765/api/webhook/workflows/runs/<RUN_ID>
  ```
- **Phản hồi:** Chi tiết trạng thái của từng Node (`node_results`) cùng log thực thi trực tiếp và liên kết tệp tin kết quả.

### 3. Tải lên tệp Media & Ghép Video từ xa

#### a) Upload tệp tin lên Server (Upload Asset)
Sử dụng API này để tải lên các tệp tin âm thanh, hình ảnh tham chiếu hoặc video gốc trước khi chạy ghép nối.
- **Endpoint:** `POST /api/webhook/upload` (dạng multipart/form-data)
- **Lệnh mẫu:**
  ```bash
  curl -X POST -H "X-API-Key: <API_KEY>" \
    -F "file=@/path/to/sound.mp3" \
    http://<IP_MÁY_CHỦ>:8765/api/webhook/upload
  ```
- **Phản hồi:** Trả về đường dẫn cục bộ (`path`) và URL tải về của tệp tin vừa upload trên máy chủ (ví dụ: `/api/files/G-Labs BW/webhook_uploads/abc.mp3`).

#### b) Ghép nối video & lồng nhạc, phụ đề từ xa (Assemble Video)
- **Endpoint:** `POST /api/webhook/video/assemble`
- **Body JSON:** Nhận cấu trúc giống như tính năng dựng video tại giao diện UI, hỗ trợ nhiều clip, nhạc nền và các lớp phụ đề dạng timeline.
- **Lệnh mẫu:**
  ```bash
  curl -X POST -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{
      "clips": [
        { "url": "/api/files/G-Labs BW/video_output/clip1.mp4" },
        { "url": "/api/files/G-Labs BW/video_output/clip2.mp4" }
      ],
      "audios": [
        { "url": "/api/files/G-Labs BW/webhook_uploads/background_music.mp3", "start": 0, "volume": 0.5 }
      ],
      "texts": [
        { "text": "Intro G-Labs", "start": 0, "end": 2, "style": "title" }
      ]
    }' \
    http://<IP_MÁY_CHỦ>:8765/api/webhook/video/assemble
  ```

### 4. Kiểm tra trạng thái tài khoản tự động (Check Account Health)
- **Endpoint:** `GET /api/webhook/accounts`
- Trả về danh sách tài khoản liên kết (Flow / Grok), trạng thái hoạt động và thời gian cooldown nếu có để bộ điều phối ngoài chủ động xoay vòng tài khoản.

