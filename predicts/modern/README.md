# BPP Predicts — Modern Local Build

This folder is a standalone, local-development version of the UMD Balloon Payload Program prediction map. It is intentionally additive: the existing `predicts/BalloonPredictionMap` implementation is left untouched.

## What this build adds

- Modern responsive desktop/mobile layout
- Strong, high-contrast balloon trajectory rendering
- Very prominent predicted landing marker and landing card
- Prediction summary and per-stage flight information
- User-facing **Burst** and **Float** modes only
- Float mode preserves BPP's stitched-float strategy so descent is still predicted
- APRS.fi live tracking for `KC3SKW-8`, `KC3SKW-9`, and `KC3SKW-10`
- Live re-prediction from the most recent APRS position
- Cleaner, subdued airspace rendering using the existing BPP GeoJSON files when Git LFS data is present
- KML export of the active prediction
- Local Python API so APRS API keys never need to be exposed in browser JavaScript
- Health/config endpoints and graceful handling when Git LFS or APRS credentials are missing

## Run locally

From this directory:

```bash
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

Then open:

```text
http://127.0.0.1:8000
```

### APRS live tracking

Edit `.env` and add your APRS.fi API key:

```text
APRSFI_API_KEY=your_key_here
```

The browser never receives this key. Requests are proxied through the local Python server.

### Existing BPP GeoJSON / Git LFS

This app reads launch locations and airspace from the existing BPP files under:

```text
../BalloonPredictionMap/BalloonBaseMap/assets/data/
```

Those files are tracked with Git LFS. If a clone contains only LFS pointer text, run from the repository root:

```bash
git lfs install
git lfs pull
```

The app will still start without those files, but it will use a small fallback launch-site list and will omit unavailable airspace layers.

## Prediction behavior

### Burst

Uses the same SondeHub Tawhiri endpoint as the current BPP code (`https://api.v2.sondehub.org/tawhiri`) with the standard profile.

### Float

Preserves the BPP stitched-float approach documented in the existing project:

1. Standard prediction to the requested float altitude; only its ascent segment is retained.
2. A second standard prediction begins at the first segment's final point.
3. The second ascent uses the requested slow float ascent rate for the requested duration and is relabeled `float`.
4. The second prediction's normal descent is retained.

This provides ascent + float + descent, unlike Tawhiri's native float profile, which does not predict descent.

## Live prediction behavior

The backend polls APRS.fi and keeps a small in-memory history for each BPP callsign. New live predictions start from the latest reported latitude, longitude, altitude, and current timestamp. A flight-phase selector is included because APRS.fi's current-location API does not provide a reliable full vertical-rate history when the local server has just started.

- `Auto / Ascending`: predicts the remaining ascent and descent from the current position.
- `Descending`: uses a near-immediate burst approximation so Tawhiri transitions to descent from approximately the current position/altitude.

## Production note

This directory is designed for local validation first. Do not copy it into the production Apache document root until the team has tested the behavior, confirmed APRS.fi API use/credits, reviewed airspace data freshness, and chosen a deployment method for the Python API (systemd + uvicorn/gunicorn + Apache reverse proxy is one option).
