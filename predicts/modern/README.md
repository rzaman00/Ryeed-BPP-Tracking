# BPP Predicts — Final Operational Build v2.4.0

This is the modern-only local BPP prediction application. It preserves the v2.2/v2.3 interface while closing the operational gaps around launch sites, airspace, drawing tools, and live APRS tracking.

## Highlights

- **Preset launch sites restored:** local resolved BPP GeoJSON is preferred. If it is not present, the backend retrieves the public BPP launch-location file through GitHub's LFS media service, caches it, and merges an offline fallback so the UI never collapses to a single site.
- **Current airspace:** Class B/C/D, Class E, Special Use Airspace, and TFR data are proxied from FAA services and cached to disk. A stale cache is used if the FAA feed is temporarily unavailable.
- **Custom launch sites work end-to-end:** draw a point and it is immediately listed as an enabled custom prediction site. Custom sites can be individually selected, renamed, predicted, included in parameter sweeps, exported, and deleted.
- **Oriented rectangles:** rectangle drawing is a three-click workflow: baseline start → baseline end (direction + length) → width. The result is a rotated GeoJSON polygon with length, width, and area metadata. `Esc` cancels a draft.
- **Callsign dropdown:** defaults are `KC3SKW-8`, `KC3SKW-9`, `KC3SKW-10`. Select from the dropdown, remove chips, or choose **Add another callsign…** for any valid APRS station. Up to 8 can be active.
- **Altitude-aware live predicts:** every live prediction starts from the latest APRS latitude, longitude, altitude, and APRS packet timestamp. A station with no altitude is rejected instead of silently assuming 0 m.
- **Modern-only launcher:** `run_latest.py` verifies `2.4.0` before opening the browser and stops older BPP Predicts servers it finds on the normal local ports.

## Run on Windows

From the package root, double-click `START_BPP_PREDICTS.bat`, or from this folder run:

```powershell
.\run_windows.bat
```

The first run creates `.venv` and installs the Python requirements automatically.

## APRS setup

Copy `.env.example` to `.env` if setup has not already done so, then set:

```text
APRSFI_API_KEY=your_key_here
```

Restart the app. In **Live Track**, use the callsign dropdown to add the stations you want, then **Refresh APRS** or **Run Live Predict**.

## Data behavior

The application does not run or require the old BalloonPredictionMap frontend. Historical/reference GeoJSON can be read from a resolved sibling checkout when one exists, but missing LFS data is transparently resolved from public repository media or an internal fallback/cache. FAA airspace is refreshed independently from authoritative services.

## Verify the current build

Open `http://127.0.0.1:8000/api/health`. It should report:

```json
"version": "2.4.0"
```

## Validation

Run:

```bash
PYTHONPATH=. pytest -q
node tests/test_geometry.mjs
node --check static/app.js
python -m compileall -q .
```

The test suite covers prediction math, stitched Float behavior, live APRS 3D seeding, multi-callsign partial failures, launch-site fallback/merge behavior, FAA airspace composition/cache fallback, required UI controls, all identified UI button wiring, and arbitrary-orientation rectangle geometry.
