#!/usr/bin/env bash
# G-Labs BW — health snapshot
set -euo pipefail

check() {
  local name="$1"
  local url="$2"
  if out="$(curl -fsS -m 2 "$url" 2>/dev/null)"; then
    echo "OK  $name  $url"
    if command -v python3 >/dev/null 2>&1; then
      echo "$out" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("   ", {k:d.get(k) for k in list(d)[:12]})' 2>/dev/null || echo "    $out"
    else
      echo "    $out"
    fi
  else
    echo "DOWN $name  $url"
  fi
}

ROOT="$(cd "$(dirname "$0")" && pwd)"
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

echo "G-Labs BW status"
echo "----------------"
check "Backend health" "http://127.0.0.1:$API_PORT/api/health"
check "Auth bridge" "http://127.0.0.1:$AUTH_BRIDGE_PORT/"
if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:5173/" 2>/dev/null; then
  echo "OK  Frontend      http://127.0.0.1:5173/"
else
  echo "DOWN Frontend      http://127.0.0.1:5173/"
fi

echo ""
echo "Listeners:"
lsof -nP -iTCP:"$API_PORT","$AUTH_BRIDGE_PORT",5173 -sTCP:LISTEN 2>/dev/null || echo "  (none)"
