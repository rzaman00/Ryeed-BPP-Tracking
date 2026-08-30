#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "[BPP Predicts v2.3.0] Setting up local Python environment..."
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env. Add APRSFI_API_KEY there to enable live tracking."
fi
echo "Setup complete. Run ./run_unix.sh"
