#!/usr/bin/env bash
# G-Labs BW — run test suite
# Usage:
#   ./test.sh           # all tests
#   ./test.sh smoke     # smoke only
#   ./test.sh api       # API tests
#   ./test.sh -v        # verbose
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VENV_PY="$ROOT/backend/.venv/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  VENV_PY="$(command -v python3 || true)"
fi
if [[ -z "${VENV_PY}" ]]; then
  echo "ERROR: Python not found"
  exit 1
fi

# ensure pytest
if ! "$VENV_PY" -c "import pytest" 2>/dev/null; then
  echo "Installing pytest..."
  "$VENV_PY" -m pip install -q pytest pytest-asyncio
fi

SUITE="all"
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    smoke|api|all) SUITE="$arg" ;;
    -v|--verbose) VERBOSE=1 ;;
    -h|--help)
      echo "Usage: ./test.sh [all|smoke|api] [-v]"
      exit 0
      ;;
  esac
done

case "$SUITE" in
  smoke) TARGET="backend/tests/test_smoke.py" ;;
  api)   TARGET="backend/tests/test_api.py" ;;
  *)     TARGET="backend/tests" ;;
esac

ARGS=(-m pytest "$TARGET" --asyncio-mode=auto -ra)
if [[ "$VERBOSE" -eq 1 ]]; then
  ARGS+=(-v --tb=short)
else
  ARGS+=(-q)
fi

echo "========================================"
echo "  G-Labs BW tests — suite=$SUITE"
echo "========================================"
export PYTHONPATH="$ROOT/backend"
set +e
"$VENV_PY" "${ARGS[@]}"
CODE=$?
set -e
echo ""
if [[ "$CODE" -eq 0 ]]; then
  echo "RESULT: PASS"
else
  echo "RESULT: FAIL (exit $CODE)"
fi
exit "$CODE"
