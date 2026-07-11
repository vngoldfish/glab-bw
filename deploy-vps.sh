#!/usr/bin/env bash
# ============================================================
#  G-Labs BW — Script Deploy lên VPS Ubuntu/Debian
#  Chạy lần đầu trên VPS: bash deploy-vps.sh
#  Chạy cập nhật code:    bash deploy-vps.sh --update
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MODE_UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update|-u) MODE_UPDATE=1 ;;
    --help|-h)
      echo "Dùng: bash deploy-vps.sh [--update]"
      echo "  (Không tham số): Cài lần đầu"
      echo "  --update: Cập nhật code + restart"
      exit 0
      ;;
  esac
done

# ─── Màu sắc ─────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
err()  { echo -e "${RED}✗ $*${NC}"; exit 1; }
step() { echo -e "\n${GREEN}══ $* ══${NC}"; }

# ─── Kiểm tra .env ───────────────────────────────────────────
if [[ ! -f "$ROOT/.env" ]]; then
  warn ".env chưa tồn tại. Tạo từ .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
  warn ">>> HÃY CHỈNH .env TRƯỚC KHI TIẾP TỤC <<<"
  warn "Mở file: nano $ROOT/.env"
  warn "Điền VPS_DOMAIN=yourdomain.com và các giá trị cần thiết"
  echo ""
  read -p "Bạn đã chỉnh .env chưa? (yes/no): " yn
  if [[ "$yn" != "yes" ]]; then
    err "Hủy deploy. Hãy chỉnh .env rồi chạy lại."
  fi
fi

# ─── Đọc cấu hình từ .env ────────────────────────────────────
source_env() {
  local key="$1" default="${2:-}"
  grep -E "^${key}=" "$ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" || echo "$default"
}
VPS_DOMAIN=$(source_env "VPS_DOMAIN" "")
APP_PORT=$(source_env "PORT" "8765")

if [[ "$MODE_UPDATE" -eq 0 ]]; then
  # ═══════════════════════════════════════════════════════════
  #  CÀI LẦN ĐẦU
  # ═══════════════════════════════════════════════════════════

  step "1. Cập nhật hệ thống và cài phụ thuộc"
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3 python3-pip python3-venv nodejs npm nginx certbot python3-certbot-nginx curl git
  ok "Đã cài: python3, nodejs, npm, nginx, certbot"

  step "2. Tạo Python venv và cài packages"
  if [[ ! -d "$ROOT/backend/.venv" ]]; then
    python3 -m venv "$ROOT/backend/.venv"
  fi
  "$ROOT/backend/.venv/bin/pip" install -q --upgrade pip
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  ok "Python packages đã cài"

  step "3. Build frontend"
  (cd "$ROOT/frontend" && npm ci --silent && npm run build)
  ok "Frontend đã build → frontend/dist/"

  step "4. Cấu hình systemd service (auto-start khi VPS reboot)"
  VENV_PY="$ROOT/backend/.venv/bin/python"
  CURRENT_USER=$(whoami)

  sudo tee /etc/systemd/system/glabs-bw.service > /dev/null <<EOF
[Unit]
Description=G-Labs BW Backend API
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$ROOT
Environment=PYTHONPATH=$ROOT/backend
ExecStart=$VENV_PY -m uvicorn app.main:app --host 0.0.0.0 --port $APP_PORT
Restart=always
RestartSec=5
StandardOutput=append:$ROOT/data/logs/backend.console.log
StandardError=append:$ROOT/data/logs/backend.console.log

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable glabs-bw
  ok "Systemd service đã cài: glabs-bw"

  if [[ -n "$VPS_DOMAIN" ]]; then
    step "5. Cấu hình Nginx reverse proxy cho domain: $VPS_DOMAIN"
    sudo tee /etc/nginx/sites-available/glabs-bw > /dev/null <<EOF
server {
    listen 80;
    server_name $VPS_DOMAIN www.$VPS_DOMAIN;

    # Tăng giới hạn upload (cho ảnh/video)
    client_max_body_size 200M;

    # Timeout lớn hơn cho video generation (có thể >60s)
    proxy_read_timeout 660;
    proxy_connect_timeout 60;
    proxy_send_timeout 660;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # WebSocket support (nếu cần sau này)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
    sudo ln -sf /etc/nginx/sites-available/glabs-bw /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    ok "Nginx đã cấu hình cho $VPS_DOMAIN"

    echo ""
    warn "Bước tiếp theo: Cài SSL/HTTPS (tùy chọn nhưng khuyên dùng):"
    echo "  sudo certbot --nginx -d $VPS_DOMAIN -d www.$VPS_DOMAIN"
    echo "  (Certbot tự động gia hạn SSL miễn phí mỗi 90 ngày)"
  else
    warn "VPS_DOMAIN trống — bỏ qua cấu hình Nginx/SSL"
    warn "Ứng dụng sẽ chạy trực tiếp tại: http://VPS_IP:$APP_PORT"
  fi

  step "6. Khởi động service"
  mkdir -p "$ROOT/data/logs" "$ROOT/data/run"
  sudo systemctl start glabs-bw
  sleep 3
  if curl -fsS -m 5 "http://127.0.0.1:$APP_PORT/api/health" > /dev/null 2>&1; then
    ok "Backend đang chạy tại :$APP_PORT"
  else
    err "Backend không start được — kiểm tra log: journalctl -u glabs-bw -n 50"
  fi

else
  # ═══════════════════════════════════════════════════════════
  #  CẬP NHẬT CODE (--update)
  # ═══════════════════════════════════════════════════════════

  step "Cập nhật code từ Git"
  git pull origin main
  ok "Code đã pull"

  step "Cài packages mới (nếu có)"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
  (cd "$ROOT/frontend" && npm ci --silent)
  ok "Dependencies đã cập nhật"

  step "Rebuild frontend"
  (cd "$ROOT/frontend" && npm run build)
  ok "Frontend đã rebuild → frontend/dist/"

  step "Restart service"
  sudo systemctl restart glabs-bw
  sleep 3
  if curl -fsS -m 5 "http://127.0.0.1:$APP_PORT/api/health" > /dev/null 2>&1; then
    ok "Service đã restart thành công"
  else
    err "Service không start — kiểm tra: journalctl -u glabs-bw -n 50"
  fi
fi

# ─── Kiểm tra CORS cuối cùng ─────────────────────────────────
echo ""
step "Kiểm tra cấu hình CORS"
CORS_CHECK=$(curl -s "http://127.0.0.1:$APP_PORT/api/cors-status" 2>/dev/null || echo "{}")
echo "$CORS_CHECK" | python3 -m json.tool 2>/dev/null || echo "$CORS_CHECK"

# ─── Tóm tắt ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✓ Deploy hoàn tất!${NC}"
echo ""
if [[ -n "$VPS_DOMAIN" ]]; then
  echo "  Ứng dụng:  https://$VPS_DOMAIN"
  echo "  API:       https://$VPS_DOMAIN/api/health"
  echo "  CORS:      https://$VPS_DOMAIN/api/cors-status"
else
  echo "  Ứng dụng:  http://$(curl -s ifconfig.me 2>/dev/null || echo "VPS_IP"):$APP_PORT"
  echo "  API:       http://VPS_IP:$APP_PORT/api/health"
  echo "  CORS:      http://VPS_IP:$APP_PORT/api/cors-status"
fi
echo ""
echo "  Xem log:   journalctl -u glabs-bw -f"
echo "  Restart:   sudo systemctl restart glabs-bw"
echo "  Stop:      sudo systemctl stop glabs-bw"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
