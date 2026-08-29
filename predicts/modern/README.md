# BPP Predicts — Current Modern Build v2.2.0

This folder is the current local BPP Predicts application. It keeps the familiar operational prediction workflow while modernizing the interface and fixing the landing-target alignment issue.

## What changed in v2.2.0

- Refreshed modern interface with cleaner typography, rounded panels, improved spacing, and translucent map controls.
- Light/dark theme toggle. The selected theme is remembered; dark mode also starts with the dark map basemap.
- **Landing alignment fix:** predicted landing targets are rendered as native MapLibre GeoJSON circle layers at the exact final trajectory coordinate. They no longer use DOM/HTML markers that can visually drift from the line as map scale changes.
- Launch-location normalization now prefers explicit legacy `latitude`/`longitude` properties when they exist, avoiding stale or rounded geometry for preset launch sites.
- The modern header no longer links to the legacy predictor.
- Static frontend files use versioned URLs and no-cache response headers so an old browser cache cannot masquerade as the newest build.
- `run_windows.bat` now uses `run_latest.py`, which checks for running BPP Predicts instances, stops older builds, verifies **v2.2.0**, and only then opens the browser.
- First run is automatic: `run_windows.bat` runs setup if the virtual environment does not exist.

## Windows — recommended

From this folder:

```powershell
.\run_windows.bat
```

That is the normal command for every run. On the first run it automatically creates `.venv` and installs the Python requirements.

If this package is extracted with its top-level launcher, you can instead double-click:

```text
START_BPP_PREDICTS.bat
```

The launcher normally uses:

```text
http://127.0.0.1:8000
```

If an unrelated program owns port 8000, it chooses a nearby free port and opens the correct URL automatically.

### Verify that the newest build is running

Open:

```text
http://127.0.0.1:8000/api/health
```

The response should contain:

```json
"version": "2.2.0"
```

## macOS / Linux

```bash
./run_unix.sh
```

It also performs setup automatically when `.venv` is missing.

## Existing BPP data

For the full preset launch-site and reference-layer set, keep this modern folder at:

```text
Ryeed-BPP-Tracking/predicts/modern
```

and keep the existing sibling data directory at:

```text
Ryeed-BPP-Tracking/predicts/BalloonPredictionMap/BalloonBaseMap/assets/data/
```

The modern app reads the GeoJSON files from that location, but **you do not need to run or open the legacy BalloonPredictionMap application**. If the repository was freshly cloned, run `git lfs pull` once from the repository root so the large GeoJSON files are materialized.

Without those legacy data files, the app still runs and supports custom launch points, but it uses a small fallback launch-site list and omits unavailable reference layers.

## APRS live tracking

Edit `.env` and set:

```text
APRSFI_API_KEY=your_key_here
```

The key remains server-side. APRS.fi requests are proxied through the local FastAPI backend.

## Prediction behavior

### Burst

Uses SondeHub-hosted Tawhiri's standard profile.

### Float

Uses the BPP stitched-float approach:

1. Predict ascent to the requested float altitude.
2. Start a second standard prediction at that point.
3. Treat the second prediction's slow ascent as the float segment for the requested duration.
4. Keep the normal descent from that second prediction.

The result is ascent + float + descent.

## Tests

From this directory:

```bash
PYTHONPATH=. pytest -q
```

The core tests cover longitude conversion, distance calculations, final landing summarization, launch-location normalization, and the stitched-float workflow.
