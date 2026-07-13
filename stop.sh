#!/usr/bin/env bash
# G-Labs BW — stop backend + frontend + watchdog
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$ROOT/data/run"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "  kill port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    sleep 0.4
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

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

echo "Stopping G-Labs BW..."
for p in "$API_PORT" "$AUTH_BRIDGE_PORT" 5173; do kill_port "$p"; done

if [[ -d "$PID_DIR" ]]; then
  for f in "$PID_DIR"/*.pid; do
    [[ -f "$f" ]] || continue
    pid="$(cat "$f" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "  kill pid $pid ($f)"
      kill "$pid" 2>/dev/null || true
      # watchdog may have children
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$f"
  done
fi

echo "Done."
