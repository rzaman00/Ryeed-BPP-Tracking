#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "[BPP Predicts v3.8.1] Checking local Python environment..."
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ -x .venv/bin/python ]]; then
  if ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
    echo "[BPP Predicts] Existing pip is broken. Rebuilding the virtual environment..."
    rm -rf .venv
  fi
fi
if [[ ! -x .venv/bin/python ]]; then
  "$PYTHON_BIN" -m venv .venv
fi
.venv/bin/python -m ensurepip --upgrade >/dev/null 2>&1 || true
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -c 'import fastapi, uvicorn, httpx, dotenv, pydantic, shapely'
[[ -f .env ]] || cp .env.example .env
echo "Setup complete."
