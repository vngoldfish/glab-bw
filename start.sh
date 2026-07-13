#!/usr/bin/env bash
# G-Labs BW — start backend (+ optional Vite frontend)
# Usage:
#   ./start.sh              # backend + vite dev (default)
#   ./start.sh --prod       # backend only, serve frontend/dist on :8765
#   ./start.sh --watchdog   # restart backend if health dies
#   ./start.sh --prod --watchdog
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Read AUTH_BRIDGE_PORT and API_PORT from .env dynamically, fallbacks to defaults
AUTH_BRIDGE_PORT=18923
API_PORT=8765
if [[ -f "$ROOT/.env" ]]; then
  LINE=$(grep -E "^AUTH_BRIDGE_URL=" "$ROOT/.env" | cut -d= -f2- || true)
  if [[ -n "$LINE" ]]; then
    PORT_PART=$(echo "$LINE" | grep -oE ":[0-9]+" | tr -d ":" || true)
    if [[ -n "$PORT_PART" ]]; then
      AUTH_BRIDGE_PORT="$PORT_PART"
    fi
  fi
  PORT_LINE=$(grep -E "^PORT=" "$ROOT/.env" | cut -d= -f2- || true)
  if [[ -n "$PORT_LINE" ]]; then
    API_PORT="$PORT_LINE"
  fi
fi

PROD=0
WATCHDOG=0
for arg in "$@"; do
  case "$arg" in
    --prod|-p) PROD=1 ;;
    --watchdog|-w) WATCHDOG=1 ;;
    --help|-h)
      echo "Usage: ./start.sh [--prod] [--watchdog]"
      exit 0
      ;;
  esac
done

LOG_DIR="$ROOT/data/logs"
PID_DIR="$ROOT/data/run"
mkdir -p "$LOG_DIR" "$PID_DIR"

BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
WATCHDOG_PID_FILE="$PID_DIR/watchdog.pid"
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

start_backend_once() {
  (
    cd "$ROOT"
    export PYTHONPATH="$ROOT/backend"
    nohup "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" \
      >>"$BACKEND_LOG" 2>&1 &
    echo $! >"$BACKEND_PID_FILE"
  )
}

echo ""
echo "========================================"
echo "  G-Labs BW — starting"
if [[ "$PROD" -eq 1 ]]; then echo "  mode: PROD (static UI on :8765)"; fi
if [[ "$WATCHDOG" -eq 1 ]]; then echo "  watchdog: on"; fi
echo "========================================"
echo ""

if [[ "$PROD" -eq 1 ]]; then
  if [[ ! -f "$ROOT/frontend/dist/index.html" ]]; then
    echo "[build] frontend/dist missing — running npm run build..."
    if ! command -v npm >/dev/null 2>&1; then
      echo "ERROR: npm required to build frontend"
      exit 1
    fi
    (cd "$ROOT/frontend" && npm run build)
  fi
fi

echo "[1/4] Free ports $API_PORT, $AUTH_BRIDGE_PORT, 5173..."
for p in "$API_PORT" "$AUTH_BRIDGE_PORT" 5173; do kill_port "$p"; done
# stop old watchdog if any
if [[ -f "$WATCHDOG_PID_FILE" ]]; then
  wp="$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)"
  if [[ -n "${wp:-}" ]]; then kill "$wp" 2>/dev/null || true; fi
  rm -f "$WATCHDOG_PID_FILE"
fi
sleep 1

echo "[2/4] Backend API :$API_PORT + Auth :$AUTH_BRIDGE_PORT..."
start_backend_once
wait_http "http://127.0.0.1:$API_PORT/api/health" "Backend" 25

if [[ "$WATCHDOG" -eq 1 ]]; then
  echo "  starting backend watchdog..."
  (
    while true; do
      if ! curl -fsS -m 2 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') watchdog: backend DOWN — restart" >>"$LOG_DIR/watchdog.log"
        for p in "$API_PORT" "$AUTH_BRIDGE_PORT"; do
          pid="$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null || true)"
          if [[ -n "$pid" ]]; then kill $pid 2>/dev/null || true; fi
        done
        sleep 1
        start_backend_once
        sleep 3
      fi
      sleep 5
    done
  ) &
  echo $! >"$WATCHDOG_PID_FILE"
fi

UI_URL="http://127.0.0.1:5173"
if [[ "$PROD" -eq 1 ]]; then
  echo "[3/4] Prod UI served by backend (skip Vite)"
  UI_URL="http://127.0.0.1:$API_PORT"
  wait_http "http://127.0.0.1:$API_PORT/" "Static UI" 10 || true
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found (need Node.js 18+)."
    exit 1
  fi
  echo "[3/4] Frontend Vite :5173..."
  (
    cd "$ROOT/frontend"
    nohup npm run dev -- --host 0.0.0.0 --port 5173 \
      >>"$FRONTEND_LOG" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )
  wait_http "http://127.0.0.1:5173/" "Frontend" 30
fi

echo "[4/4] Open browser..."
if command -v open >/dev/null 2>&1; then
  open "$UI_URL" || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$UI_URL" || true
fi

echo ""
echo "========================================"
echo "  App:     $UI_URL"
echo "  Backend: http://127.0.0.1:$API_PORT"
echo "  Auth:    http://127.0.0.1:$AUTH_BRIDGE_PORT"
echo "  Logs:    $LOG_DIR"
echo "  Stop:    ./stop.sh"
echo "========================================"
echo ""
