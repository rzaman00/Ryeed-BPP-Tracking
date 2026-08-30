# BPP Predicts — Current Modern Build v2.3.0

This folder is the current local BPP Predicts application. v2.3.0 keeps the v2.2 visual design and operational workflow, while making live APRS prediction fully multi-callsign and explicitly altitude-aware.

## What changed in v2.3.0

- **Typed live callsigns:** the Live Track control is now a text field. Enter one or more APRS callsigns separated by commas, spaces, semicolons, or new lines.
- The default field is pre-filled with `KC3SKW-8, KC3SKW-9, KC3SKW-10`, but live tracking is no longer hard-coded to only those three stations.
- **Multi-callsign live predicts:** one Run Live Predict action can create predictions for every callsign entered. Successful stations are plotted together and listed separately in the prediction summary.
- **3D APRS seed position:** every live prediction starts from the latest APRS latitude, longitude, **and altitude**. If the latest packet has no altitude, the app refuses to run a misleading ground-level prediction for that callsign and reports the issue.
- The APRS packet timestamp is used as the prediction start time, and the returned live metadata records the exact position/altitude used.
- The live status card now shows all requested callsigns with packet age, phase, and altitude while preserving the existing compact layout.
- The previous v2.2 modern UI, dark mode, landing-marker alignment fix, responsive layout, airspace rendering, drawing tools, parameter sweep, KML export, Burst mode, and stitched Float mode are retained.
- `run_latest.py` now verifies **v2.3.0** before opening the browser and continues to stop older BPP Predicts servers so only the newest modern build runs.

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

### Verify that the newest build is running

Open:

```text
http://127.0.0.1:8000/api/health
```

The response should contain:

```json
"version": "2.3.0"
```

## APRS live tracking

Edit `.env` and set:

```text
APRSFI_API_KEY=your_key_here
```

Then choose **Live Track**. Type callsigns such as:

```text
KC3SKW-8, KC3SKW-9, KC3SKW-10
```

or any other valid APRS callsign(s) you need to follow. Up to 8 callsigns can be tracked/predicted in one request. The backend sends the callsigns to aprs.fi, records each latest packet, and seeds Tawhiri from that packet's latitude, longitude, altitude, and timestamp.

A live prediction is intentionally not run when APRS.fi returns a location without altitude. This prevents the predictor from silently treating a balloon already in flight as if it were at ground level.

## Existing BPP data

For the full preset launch-site and reference-layer set, keep this modern folder at:

```text
Ryeed-BPP-Tracking/predicts/modern
```

and keep the existing sibling data directory at:

```text
Ryeed-BPP-Tracking/predicts/BalloonPredictionMap/BalloonBaseMap/assets/data/
```

The modern app reads GeoJSON data from that location, but the legacy BalloonPredictionMap application is never launched. From a fresh clone, run `git lfs pull` once from the repository root.

## Prediction behavior

### Burst

Uses SondeHub-hosted Tawhiri's standard profile.

### Float

Uses the BPP stitched-float approach: ascent to float altitude, a second slow-ascent segment treated as float, then normal descent.

## Tests

From this directory:

```bash
PYTHONPATH=. pytest -q
```

The tests cover coordinate conversion, landing summarization, launch-site normalization, stitched Float behavior, callsign parsing, and altitude-aware live prediction seeding.
