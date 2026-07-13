#!/usr/bin/env bash
# Keep backend API alive (restart on crash). Frontend is separate (./start.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/watchdog.log"
VENV_PY="$ROOT/backend/.venv/bin/python"
[[ -x "$VENV_PY" ]] || VENV_PY="$(command -v python3)"

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

export PYTHONPATH="$ROOT/backend"

log() {
  local line
  line="$(date '+%Y-%m-%d %H:%M:%S') $*"
  echo "$line" | tee -a "$LOG"
}

backend_up() {
  curl -fsS -m 2 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1
}

kill_ports() {
  for port in "$API_PORT" "$AUTH_BRIDGE_PORT"; do
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill $pids 2>/dev/null || true
      sleep 0.3
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  done
}

log "Watchdog started (API :$API_PORT + Auth :$AUTH_BRIDGE_PORT)"
proc=""

while true; do
  if ! backend_up; then
    log "DOWN — restarting uvicorn"
    if [[ -n "${proc:-}" ]] && kill -0 "$proc" 2>/dev/null; then
      kill "$proc" 2>/dev/null || true
    fi
    kill_ports
    sleep 1
    (
      cd "$ROOT"
      "$VENV_PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$API_PORT" \
        >>"$LOG_DIR/backend.console.log" 2>&1
    ) &
    proc=$!
    ok=0
    for _ in $(seq 1 20); do
      sleep 1
      if backend_up; then
        ok=1
        break
      fi
      if ! kill -0 "$proc" 2>/dev/null; then
        break
      fi
    done
    if [[ "$ok" -eq 1 ]]; then
      log "UP pid=$proc"
    else
      log "FAILED — retry in 5s"
      sleep 5
      continue
    fi
  fi
  sleep 5
done
