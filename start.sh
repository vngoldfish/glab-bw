#!/usr/bin/env bash
# G-Labs BW — start backend + frontend (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/data/logs"
PID_DIR="$ROOT/data/run"
mkdir -p "$LOG_DIR" "$PID_DIR"

BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.console.log"
FRONTEND_LOG="$LOG_DIR/frontend.console.log"

VENV_PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  VENV_PY="$(command -v python3 || true)"
fi
if [[ -z "${VENV_PY}" ]]; then
  echo "ERROR: Python not found. Create backend/.venv first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found (need Node.js 18+)."
  exit 1
fi

port_pid() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}'
}

kill_port() {
  local port="$1"
  local pid
  pid="$(port_pid "$port" || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "  stop port $port (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  fi
}

wait_http() {
  local url="$1"
  local name="$2"
  local max="${3:-30}"
  local i
  for ((i = 1; i <= max; i++)); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      echo "  $name OK"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $name did not become ready: $url"
  return 1
}

echo ""
echo "========================================"
echo "  G-Labs BW — starting"
echo "========================================"
echo ""

echo "[1/4] Free ports 8765, 18923, 5173..."
for p in 8765 18923 5173; do kill_port "$p"; done
sleep 1

echo "[2/4] Backend API :8765 + Auth :18923..."
(
  cd "$ROOT"
  export PYTHONPATH="$ROOT/backend"
  nohup "$VENV_PY" -m uvicorn app.main:app --host 127.0.0.1 --port 8765 \
    >>"$BACKEND_LOG" 2>&1 &
  echo $! >"$BACKEND_PID_FILE"
)
wait_http "http://127.0.0.1:8765/api/health" "Backend" 25

echo "[3/4] Frontend :5173..."
(
  cd "$ROOT/frontend"
  nohup npm run dev -- --host 127.0.0.1 --port 5173 \
    >>"$FRONTEND_LOG" 2>&1 &
  echo $! >"$FRONTEND_PID_FILE"
)
wait_http "http://127.0.0.1:5173/" "Frontend" 30

echo "[4/4] Open browser..."
if command -v open >/dev/null 2>&1; then
  open "http://127.0.0.1:5173" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:5173" || true
fi

echo ""
echo "========================================"
echo "  App:     http://127.0.0.1:5173"
echo "  Backend: http://127.0.0.1:8765"
echo "  Auth:    http://127.0.0.1:18923"
echo "  Logs:    $LOG_DIR"
echo "  Stop:    ./stop.sh"
echo "========================================"
echo ""
