BPP Predicts — final operational modern build v2.4.0
==================================================

WINDOWS QUICK START
1. Extract this ZIP anywhere (or copy it over your repository root).
2. Double-click START_BPP_PREDICTS.bat.
3. On first run, the launcher creates a Python virtual environment and installs requirements.
4. The browser opens only after the backend verifies that v2.4.0 is actually running.

WHAT IS INCLUDED
- Restored preset BPP launch sites. The app uses resolved local data when available, otherwise it
  loads/caches the public BPP launch-site data and has an offline fallback list.
- Current FAA airspace: Class B/C/D, optional Class E, Special Use Airspace, and TFRs. FAA data
  is cached locally so a temporary network failure can use the last successful copy.
- Fully working custom launch points. Draw a point and it immediately appears under
  Layers > Predicts > Custom launch sites, enabled and ready to predict.
- Oriented rectangle/geofence drawing: click the start of a baseline, click the end to choose any
  direction and length, then click to set width. Press Esc while drawing to cancel.
- Live APRS callsign dropdown. The three BPP callsigns are available by default; use
  "Add another callsign…" to add any other valid APRS callsign. Multiple callsigns can be active.
- Live predictions seed Tawhiri from each station's latest APRS latitude, longitude, altitude,
  and packet timestamp. Missing altitude is treated as an error instead of assuming ground level.
- Burst + stitched Float, dark mode, exact landing targets, summary cards, KML/GeoJSON export,
  parameter sweep, reference layers, 2D/3D map, address queries, and auto live re-predict remain.

APRS SETUP
Open predicts\modern\.env and set:
  APRSFI_API_KEY=your_key_here
Then restart START_BPP_PREDICTS.bat.

ONLY THE NEWEST VERSION RUNS
This ZIP contains only the modern application. START_BPP_PREDICTS.bat launches
predicts\modern\run_latest.py, which checks local BPP Predicts servers, stops older builds,
and opens the browser only after /api/health reports version 2.4.0.

VERIFY THE BUILD
Open http://127.0.0.1:8000/api/health while it is running. Look for:
  "version": "2.4.0"
