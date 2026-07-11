# 📖 Hướng Dẫn Sử Dụng G-Labs BW

> **G-Labs BW** — Ứng dụng tạo ảnh & video AI hàng loạt bằng Google Flow (Veo), Grok (xAI), Meta AI. Hỗ trợ Workflow tự động, Dựng video (NLE), Webhook/n8n tích hợp.

---

## 📋 Mục Lục

1. [Cài đặt lần đầu](#1-cài-đặt-lần-đầu)
2. [Chạy ứng dụng](#2-chạy-ứng-dụng)
3. [Các tính năng chính](#3-các-tính-năng-chính)
4. [Tạo ảnh & video lẻ](#4-tạo-ảnh--video-lẻ)
5. [Workflow — Tự động hóa nâng cao](#5-workflow--tự-động-hóa-nâng-cao)
6. [Dựng video (NLE)](#6-dựng-video-nle)
7. [API & Webhook](#7-api--webhook)
8. [Tích hợp n8n](#8-tích-hợp-n8n)
9. [Cài đặt & Tài khoản](#9-cài-đặt--tài-khoản)
10. [Lên VPS — Deploy Production](#10-lên-vps--deploy-production)
11. [Cấu hình CORS](#11-cấu-hình-cors)
12. [Bảo trì & Xử lý lỗi](#12-bảo-trì--xử-lý-lỗi)

---

## 1. Cài Đặt Lần Đầu

### Yêu cầu hệ thống
- **Python 3.11+**
- **Node.js 18+** và npm
- **Chrome browser** + Extension **G-Labs Automation - Auth Helper**
- Tab [Google Flow Lab](https://labs.google/fx/tools/flow) đã đăng nhập sẵn

### Bước 1 — Clone và cài phụ thuộc

```bash
# Clone repo
git clone https://github.com/vngoldfish/glab-bw.git
cd glab-bw

# Cài Python packages
cd backend
python3 -m venv .venv
source .venv/bin/activate      # macOS/Linux
# hoặc: .venv\Scripts\activate  # Windows
pip install -r requirements.txt
cd ..

# Cài Node packages
cd frontend && npm install && cd ..
```

### Bước 2 — Cấu hình (tùy chọn)

```bash
cp .env.example .env
# Chỉnh sửa .env nếu cần thay đổi PORT, API_KEY, ...
```

> Nếu không tạo `.env`, ứng dụng vẫn chạy bình thường với cấu hình mặc định.

### Bước 3 — Cài Playwright (nếu dùng tính năng Login Browser)

```bash
cd backend
source .venv/bin/activate
pip install playwright && playwright install chromium
```

---

## 2. Chạy Ứng Dụng

### macOS / Linux

```bash
# Cấp quyền chạy (lần đầu)
chmod +x start.sh stop.sh status.sh

# Chạy chế độ DEV (backend :8765 + Vite dev :5173)
./start.sh

# Chạy chế độ PROD (1 process duy nhất trên :8765)
./start.sh --prod

# Chạy với watchdog (tự restart nếu backend chết)
./start.sh --prod --watchdog

# Kiểm tra trạng thái
./status.sh

# Dừng tất cả
./stop.sh
```

### Windows

```batch
CHAY-APP.bat    ← Khởi động
TAT-APP.bat     ← Dừng
```

### URL Truy Cập

| Chế độ | Địa chỉ UI | API |
|--------|-----------|-----|
| Dev | http://127.0.0.1:5173 | http://127.0.0.1:8765 |
| Prod (`--prod`) | http://127.0.0.1:8765 | http://127.0.0.1:8765 |
| Tài liệu API (Swagger) | — | http://127.0.0.1:8765/docs |

> ⚠️ Dùng `127.0.0.1` thay vì `localhost` để tránh lỗi IPv6 trên macOS.

---

## 3. Các Tính Năng Chính

| Tính năng | Menu | Mô tả |
|-----------|------|-------|
| 🎨 Tạo ảnh lẻ | Flow Ảnh | Tạo ảnh bằng Google Flow / Grok |
| 🎬 Tạo video lẻ | Flow Video | Tạo video Veo 3 từ text hoặc ảnh |
| 🔗 Workflow | Workflow | Tự động hóa pipeline ảnh → video |
| ✂️ Dựng video | Dựng video | Timeline NLE ghép clip, nhạc, phụ đề |
| 📚 Thư viện | Projects | Quản lý dự án và output |
| 🔑 Tài khoản | Cài đặt | Quản lý tài khoản Google/Grok |
| 📡 Webhook | Webhook | Tích hợp n8n/Make.com |
| 📖 Tài liệu API | API Docs | Hướng dẫn và test API trực tiếp |

---

## 4. Tạo Ảnh & Video Lẻ

### Tạo ảnh (Flow Ảnh / Grok)

1. Vào menu **Flow Ảnh** hoặc **Grok**
2. Nhập prompt mô tả hình ảnh
3. Chọn model và tỉ lệ khung hình
4. Nhấn **Tạo ảnh**
5. Kết quả lưu tự động vào `data/G-Labs BW/image_output/`

**Tính năng Import CSV:**
```csv
prompt,aspect_ratio,count
"A red dragon flying over mountains",16:9,2
"A cute cat sleeping on a sofa",1:1,1
```
Nhấn **Import CSV** → hàng loạt prompt chạy lần lượt.

### Tạo video (Flow Video)

Các chế độ:
- **Text → Video**: Chỉ cần prompt
- **Ảnh → Video** (`start_image`): Dùng ảnh làm khung đầu
- **Ảnh đầu + Ảnh cuối** (`start_end_image`): Video chuyển từ ảnh A sang ảnh B
- **Nhân vật ref** (`components`): Giữ nhất quán nhân vật từ ảnh tham chiếu

### Tách frame từ video

Vào **Flow Video → Tách frame** để trích xuất:
- Khung đầu, khung giữa, khung cuối
- Dùng **khung cuối** làm ảnh đầu cho video tiếp theo (Video-to-Video chain)

---

## 5. Workflow — Tự Động Hóa Nâng Cao

Workflow là hệ thống kéo-thả node, tự động chạy pipeline Prompt → Ảnh → Video → Tách frame liên tục.

### 5.1 Các loại Node

| Node | Màu | Chức năng |
|------|-----|-----------|
| **Prompt** | 🟣 Tím | Chứa nội dung prompt |
| **Ảnh có sẵn** | 🔵 Xanh lam | Ảnh tham chiếu nhân vật |
| **Tạo ảnh** | 🟢 Xanh lá | Sinh ảnh từ prompt |
| **Tạo video** | 🟡 Vàng | Sinh video từ ảnh/prompt |
| **Tách frame** | 🔴 Hồng | Trích frame từ video |

### 5.2 Các cổng kết nối (Handles)

Mỗi node có các chấm tròn màu ở hai bên — kéo từ chấm này sang chấm kia để nối:

**Node Tạo ảnh:**
- ← `Prompt` (nhận prompt từ node Prompt)
- ← `Ảnh ref` (nhận ảnh tham chiếu)
- `Ảnh kết quả →` (xuất ảnh sang node khác)

**Node Tạo video:**
- ← `Prompt` (văn bản mô tả video)
- ← `Ảnh đầu` (khung đầu tiên)
- ← `Nhân vật ref` (giữ nhất quán nhân vật)
- ← `Khung cuối` (khung cuối từ video trước)
- `Video kết quả →` (xuất sang Tách frame)

**Node Tách frame:**
- ← `Video gốc` (nhận video từ Tạo video)
- `Mọi frame →` (tất cả frame)
- `Khung đầu →` (frame đầu tiên)
- `Khung cuối →` (frame cuối — dùng nối video tiếp)

### 5.3 Pipeline Video-to-Video chuỗi

```
[Prompt 1] → [Tạo video 1] → [Tách frame] → [Tạo video 2] → [Tách frame] → ...
                                    ↓ Khung cuối ↗
```

Mặc định **Tách frame** lấy khung cuối → tự động nối cảnh mượt mà.

### 5.4 Nút AI viết Prompt

Trên mỗi node Prompt và node Tạo video (khi không nối Prompt node), có nút **✦ AI**:
- Nhập ý tưởng ngắn → AI viết thành prompt chuyên nghiệp
- AI đọc ngữ cảnh toàn pipeline để viết cho khớp

### 5.5 Chạy Workflow

- **Chạy tất cả**: Chạy toàn bộ node
- **Tạo lại**: Chỉ chạy lại node thất bại
- **Tiếp tục**: Bỏ qua node đã hoàn thành, chạy tiếp

### 5.6 Tạo nhiều Workflow từ Prompts hàng loạt

Nhấn **+ Tạo hàng loạt** → Nhập danh sách prompt theo cú pháp:

```
--- Box 1 ---
[001] Cảnh mở đầu: nhân vật đứng giữa đô thị
[002] Cảnh 2: nhân vật bước lên tòa nhà cao

--- Box 2 ---
[001] Cảnh hành động: đuổi theo xe trên phố
```

---

## 6. Dựng Video (NLE)

Trình biên tập video đa track với giao diện timeline.

### Các tính năng:
- **Nhiều track video**: Ghép nhiều clip theo thứ tự
- **Track nhạc nền**: Điều chỉnh âm lượng, fade in/out
- **Track phụ đề**: Nhiều kiểu style (tiêu đề, thông thường, nền tối...)
- **Thêm media**: Từ project, từ thư mục output, upload từ máy
- **Xuất MP4**: Dùng FFmpeg, hỗ trợ độ phân giải 720p/1080p

### Các bước cơ bản:
1. Vào menu **Dựng video**
2. Tạo project mới hoặc mở project cũ
3. Kéo clip vào timeline
4. Thêm nhạc nền (tùy chọn)
5. Thêm phụ đề (tùy chọn)
6. Nhấn **Xuất video**

---

## 7. API & Webhook

### 7.1 Xác thực

Mọi API từ xa cần header:
```http
X-API-Key: <your-api-key>
```

Lấy API key tại: **Cài đặt → Webhook → API Key** hoặc xem file `data/api_key.txt`.

### 7.2 Các API chính

#### Tạo ảnh
```bash
curl -X POST http://127.0.0.1:8765/api/image/generate \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A beautiful sunset over mountains",
    "model": "nano_banana_2_lite",
    "aspect_ratio": "16:9",
    "count": 1
  }'
```

#### Tạo video
```bash
curl -X POST http://127.0.0.1:8765/api/video/generate \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A dragon flying over clouds, cinematic",
    "model": "veo_31_fast",
    "aspect_ratio": "16:9",
    "mode": "text_to_video"
  }'
```

#### Kiểm tra kết quả task
```bash
# Lấy task_id từ response của lệnh tạo ảnh/video
curl http://127.0.0.1:8765/api/status/<task_id> \
  -H "X-API-Key: <API_KEY>"

curl http://127.0.0.1:8765/api/result/<task_id> \
  -H "X-API-Key: <API_KEY>"
```

#### Chạy Workflow từ xa
```bash
# 1. Lấy danh sách workflow
curl http://127.0.0.1:8765/api/webhook/workflows \
  -H "X-API-Key: <API_KEY>"

# 2. Chạy workflow (async)
curl -X POST http://127.0.0.1:8765/api/webhook/workflows/<workflow_id>/run \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "async_mode": true,
    "node_overrides": {
      "prompt_node_id": {
        "prompt": "New prompt override"
      }
    }
  }'

# 3. Kiểm tra trạng thái run
curl http://127.0.0.1:8765/api/webhook/workflows/runs/<run_id> \
  -H "X-API-Key: <API_KEY>"
```

#### Upload file & Ghép video
```bash
# Upload file
curl -X POST http://127.0.0.1:8765/api/webhook/upload \
  -H "X-API-Key: <API_KEY>" \
  -F "file=@/path/to/audio.mp3"

# Ghép video
curl -X POST http://127.0.0.1:8765/api/webhook/video/assemble \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "clips": [
      {"url": "/api/files/G-Labs BW/video_output/clip1.mp4"},
      {"url": "/api/files/G-Labs BW/video_output/clip2.mp4"}
    ],
    "audios": [{"url": "/api/files/G-Labs BW/webhook_uploads/music.mp3", "volume": 0.6}],
    "texts": [{"text": "Intro", "start": 0, "end": 3, "style": "title"}]
  }'
```

### 7.3 Kiểm tra CORS & Health

```bash
# Health check
curl http://127.0.0.1:8765/api/health

# Kiểm tra cấu hình CORS hiện tại
curl http://127.0.0.1:8765/api/cors-status
```

---

## 8. Tích Hợp n8n

### Bước 1: Lấy API Key

Vào **Cài đặt → Webhook** → copy API Key.

### Bước 2: Tạo Credential trong n8n

1. Mở n8n → **Credentials → New**
2. Chọn **Header Auth**
3. Name: `G-Labs BW`
4. Header Name: `X-API-Key`
5. Header Value: `<your-api-key>`

### Bước 3: Dùng HTTP Request node

**Tạo ảnh:**
- Method: `POST`
- URL: `http://your-server:8765/api/image/generate`
- Authentication: Header Auth → G-Labs BW
- Body: JSON
  ```json
  {
    "prompt": "{{ $json.prompt }}",
    "aspect_ratio": "16:9",
    "count": 1
  }
  ```

**Poll kết quả (dùng Loop + Wait node):**
- Method: `GET`
- URL: `http://your-server:8765/api/status/{{ $json.task_id }}`
- Loop cho đến khi `status == "completed"`

### Bước 4: Workflow n8n mẫu — Tạo ảnh → Video tự động

```
Trigger → HTTP (tạo ảnh) → Wait 30s → HTTP (poll status) → 
IF completed → HTTP (tạo video từ ảnh) → Wait 90s → HTTP (poll video) → Done
```

---

## 9. Cài Đặt & Tài Khoản

### Thêm tài khoản Google Flow

1. Vào **Cài đặt → Tài khoản**
2. Nhấn **Thêm tài khoản**
3. Chọn **Đăng nhập qua Chrome** — trình duyệt mở tự động
4. Đăng nhập vào Google Account tại trang Flow Lab
5. Cookie được lưu tự động

### Multi-account (chạy song song)

Thêm nhiều tài khoản → Server tự xoay vòng khi tài khoản bị rate-limit hoặc captcha.

### Mô hình AI hỗ trợ

| Model | Nhà cung cấp | Dùng cho |
|-------|-------------|---------|
| `nano_banana_2_lite` | Google Flow | Tạo ảnh (nhanh) |
| `imagen_3_0` | Google Flow | Tạo ảnh (chất lượng cao) |
| `veo_31_fast` | Google Flow | Tạo video (nhanh) |
| `veo_31_quality` | Google Flow | Tạo video (chất lượng cao) |
| `omni_flash` | Google Flow | Tạo video (Gemini) |
| Grok | xAI | Tạo ảnh qua Grok |
| Meta AI | Meta | Tạo ảnh qua Meta |

---

## 10. Lên VPS — Deploy Production

### Chuẩn bị

- VPS Ubuntu 20.04+ hoặc Debian 11+
- Tối thiểu 2GB RAM, 20GB disk
- Domain đã trỏ về IP VPS (nếu muốn dùng HTTPS)
- SSH vào VPS

### Deploy tự động (1 lệnh)

```bash
# Clone repo về VPS
git clone https://github.com/vngoldfish/glab-bw.git
cd glab-bw

# Tạo .env và điền domain
cp .env.example .env
nano .env
# → Điền: VPS_DOMAIN=yourdomain.com, HOST=0.0.0.0

# Chạy deploy tự động
bash deploy-vps.sh
```

Script sẽ tự động:
1. ✅ Cài Python venv, Node.js, Nginx, Certbot
2. ✅ Build frontend
3. ✅ Cài systemd service (auto-start khi reboot)
4. ✅ Cài Nginx reverse proxy
5. ✅ Kiểm tra CORS sau deploy

### Cài SSL miễn phí

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

### Cập nhật code sau này

```bash
bash deploy-vps.sh --update
# → git pull + rebuild frontend + restart service tự động
```

### Kiến trúc khi lên VPS

```
Internet :443 (HTTPS)
    ↓
Nginx (reverse proxy)
    ↓
FastAPI :8765 (localhost only)
    ├── /api/*     → API
    ├── /assets/*  → Frontend static
    └── /*         → React SPA
```

---

## 11. Cấu Hình CORS

CORS kiểm soát website nào được phép gọi API từ trình duyệt.

### Tóm tắt nhanh

| Biến `.env` | Tác dụng | Ví dụ |
|------------|---------|-------|
| `VPS_DOMAIN` | Tự thêm http+https+www | `VPS_DOMAIN=myapp.com` |
| `CORS_ORIGINS` | Nhiều domain thủ công | `CORS_ORIGINS=https://a.com,https://b.com` |
| `CORS_ALLOW_ALL` | Mở toàn bộ (⚠️ nguy hiểm) | `CORS_ALLOW_ALL=true` |

### Local (mặc định)

Không cần cấu hình gì — server tự cho phép `localhost:5173` và `127.0.0.1:8765`.

### VPS với domain

```bash
# .env
VPS_DOMAIN=myapp.example.com
```

Server tự sinh: `https://myapp.example.com`, `http://myapp.example.com`, `https://www.myapp.example.com`

### Kiểm tra CORS đang cấu hình

```bash
curl http://your-server:8765/api/cors-status | python3 -m json.tool
```

---

## 12. Bảo Trì & Xử Lý Lỗi

### Dọn dẹp output cũ

**Qua UI:** Cài đặt → Bảo trì → Dọn dẹp output

**Qua API:**
```bash
curl -X POST http://127.0.0.1:8765/api/maintenance/cleanup-outputs \
  -H "X-API-Key: <API_KEY>"
```

### Kiểm tra dung lượng ổ đĩa

```bash
curl http://127.0.0.1:8765/api/maintenance/disk
```

### Xem logs

```bash
# Trên máy local:
tail -f data/logs/backend.console.log

# Trên VPS (systemd):
journalctl -u glabs-bw -f
journalctl -u glabs-bw -n 100   # 100 dòng gần nhất
```

### Các lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|-----|------------|-----------|
| `Video needs prompt` | Node video không có prompt | Nhập prompt vào ô nhập hoặc nối node Prompt |
| `PROMINENT_PEOPLE_FILTER_FAILED` | Prompt chứa tên người nổi tiếng | Đổi prompt, dùng nhân vật hư cấu |
| `Session expired` | Cookie Flow đã hết hạn | Cài đặt → Đăng nhập lại tài khoản |
| `Backend offline` | Server chưa chạy | Chạy `./start.sh` hoặc kiểm tra `./status.sh` |
| `CORS policy blocked` | Domain chưa được thêm vào CORS | Thêm `CORS_ORIGINS=domain` vào `.env` |

### Restart server

```bash
# Local:
./stop.sh && ./start.sh --prod

# VPS:
sudo systemctl restart glabs-bw
```

### Chạy bộ kiểm thử

```bash
# CLI:
./test.sh all

# Qua API:
curl -X POST http://127.0.0.1:8765/api/maintenance/run-tests \
  -H "Content-Type: application/json" \
  -d '{"suite": "all"}'
```

---

## 📁 Cấu Trúc Thư Mục

```
glab-bw/
├── backend/
│   ├── app/
│   │   ├── api/          ← FastAPI routes
│   │   ├── core/         ← Config, logging, task queue
│   │   ├── models/       ← Data models
│   │   ├── providers/    ← AI providers
│   │   └── services/     ← Business logic
│   ├── .venv/            ← Python virtual env
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/        ← Các trang chính
│   │   ├── components/   ← UI components
│   │   └── api.ts        ← API client
│   └── dist/             ← Production build
├── data/
│   ├── G-Labs BW/
│   │   ├── projects/     ← Dự án và output
│   │   ├── image_output/ ← Ảnh lẻ
│   │   ├── video_output/ ← Video lẻ
│   │   └── grok_output/  ← Ảnh Grok
│   ├── api_key.txt       ← API key (không commit)
│   ├── accounts.json     ← Tài khoản (không commit)
│   └── tasks.db          ← SQLite task history
├── .env.example          ← Mẫu cấu hình
├── .env                  ← Cấu hình thực (không commit Git)
├── start.sh              ← Khởi động app
├── stop.sh               ← Dừng app
├── status.sh             ← Kiểm tra trạng thái
├── deploy-vps.sh         ← Deploy lên VPS
└── HUONG-DAN.md          ← File này
```

---

## 🔒 Bảo Mật

- File `.env`, `data/accounts.json`, `data/api_key.txt` **không được commit lên Git**
- Trên VPS: không mở port 8765 ra internet trực tiếp — dùng Nginx làm proxy
- Không bao giờ bật `CORS_ALLOW_ALL=true` trên server public
- API Key chỉ hiện 4 ký tự cuối trong UI để tránh lộ

---

*Cập nhật lần cuối: 2026-07-11*
