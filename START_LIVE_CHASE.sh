#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/predicts/chasemapper"
command -v docker >/dev/null 2>&1 || { echo "Docker is required for the complete Live CHASE system."; exit 1; }
docker compose up -d --build
echo "Live CHASE is starting at http://127.0.0.1:5001/"
