#!/usr/bin/env bash
set -euo pipefail
LAT="${1:-39.0}"
LON="${2:--77.0}"
OUT="${3:-./gfs}"
mkdir -p "$OUT"
python3 -m cusfpredict.gfs --lat="$LAT" --lon="$LON" --latdelta=10 --londelta=10 -f 24 -m 0p50 -o "$OUT"
