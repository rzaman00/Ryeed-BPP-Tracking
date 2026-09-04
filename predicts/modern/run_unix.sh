#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "[BPP Predicts] First run detected. Setting up automatically..."
  ./setup_unix.sh
fi
exec .venv/bin/python run_latest.py
