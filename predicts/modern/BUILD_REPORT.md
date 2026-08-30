# Build report — BPP Predicts v2.3.0

## Changes in this build

- Preserved the v2.2 UI and operational workflow; no major visual redesign.
- Replaced the fixed live callsign selector with a typed multi-callsign field.
- Added callsign normalization/deduplication and a configurable maximum of 8 live stations.
- Added query-scoped APRS caching so arbitrary callsign groups do not reuse unrelated cached station data.
- Added multi-callsign APRS status/history rendering.
- Added `/api/live/predict-batch` so all entered callsigns are fetched from APRS once and predicted together.
- Live predictions require APRS altitude and use latitude + longitude + altitude as the Tawhiri launch state.
- APRS packet time is used as the live prediction start time and returned metadata records the exact 3D position used.
- Partial batch failures are supported: a station with missing data/altitude does not prevent other callsigns from predicting.
- Bumped the modern-only launcher/build verification to v2.3.0.

## Preserved functionality

- v2.2 modern light/dark UI
- Exact georeferenced landing targets
- Burst and stitched Float
- Multi-site preset predictions and custom launch drawings
- 2D/3D map modes, airspace/reference layers, geofences, KML/GeoJSON export
- Parameter sweep and National Address Database query
- Auto APRS refresh and auto live re-predict

## Validation completed

- `python -m py_compile app.py`: pass
- `python -m py_compile run_latest.py`: pass
- `node --check static/app.js`: pass
- Python unit tests: **9 passed**
- FastAPI health/config/static-header smoke check: pass
- `/api/health` reports `2.3.0`
- Mock live prediction confirms reported APRS latitude, longitude, altitude, and packet time are used as the prediction seed
- Mock multi-callsign batch confirms arbitrary callsigns and partial station failures are handled independently

## Real-machine checks recommended

- Add the team's `APRSFI_API_KEY` to `.env`.
- Test with one callsign and with KC3SKW-8, KC3SKW-9, KC3SKW-10 together.
- Confirm each live status row shows the same altitude as aprs.fi.
- Confirm prediction summary rows show the live start altitude and all successful trajectories are visible simultaneously.
