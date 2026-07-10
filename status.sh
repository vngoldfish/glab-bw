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

echo "G-Labs BW status"
echo "----------------"
check "Backend health" "http://127.0.0.1:8765/api/health"
check "Auth bridge" "http://127.0.0.1:18923/"
if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:5173/" 2>/dev/null; then
  echo "OK  Frontend      http://127.0.0.1:5173/"
else
  echo "DOWN Frontend      http://127.0.0.1:5173/"
fi

echo ""
echo "Listeners:"
lsof -nP -iTCP:8765,18923,5173 -sTCP:LISTEN 2>/dev/null || echo "  (none)"
