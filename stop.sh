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

echo "Stopping G-Labs BW..."
for p in 8765 18923 5173; do kill_port "$p"; done

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
