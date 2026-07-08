# G-Labs BW

Ứng dụng automation tạo ảnh/video hàng loạt qua Google Flow (Veo), với Auth Helper Chrome extension.

## Yêu cầu

- **Python 3.11+**
- **Node.js 18+**
- **Chrome** + extension **G-Labs Automation - Auth Helper**
- Tab [Google Flow Lab](https://labs.google/fx/tools/flow) đã đăng nhập

## Cài đặt

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Frontend

```powershell
cd frontend
npm install
```

### Cấu hình (tuỳ chọn)

```powershell
copy .env.example .env
```

## Chạy app

Mở **hai** cửa sổ PowerShell tại thư mục dự án:

```powershell
.\start-backend.ps1
```

```powershell
.\start-frontend.ps1
```

- Frontend: http://localhost:5173
- Backend API: http://127.0.0.1:8765
- Auth Bridge: http://127.0.0.1:18923

## Cấu trúc dự án

```
g-labs-bw/
├── backend/          # FastAPI — API, Flow provider, auth bridge
├── frontend/         # React + Vite — giao diện
├── data/             # Dữ liệu runtime (không commit — xem .gitignore)
│   └── G-Labs BW/
│       ├── image_output/      # Ảnh đã tạo
│       └── reference_images/  # Thư viện ảnh tham chiếu (@tên)
├── start-backend.ps1
└── start-frontend.ps1
```

## Tính năng chính

- **Flow Ảnh** — batch tạo ảnh, hàng chờ, chạy đồng thời
- **Ảnh tham chiếu** — thư viện dùng chung, gọi trong prompt bằng `@ten_anh`
- **Webhook API** — tích hợp n8n / automation bên ngoài
- **Auth Helper** — đồng bộ cookie/token từ Chrome

## Đẩy lên GitHub

```powershell
git init
git add .
git commit -m "Initial commit: G-Labs BW"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## Lưu ý bảo mật

- Không commit `data/accounts.json`, ảnh output, hoặc `.env`
- `API_KEY` được tạo tự động khi backend khởi động lần đầu