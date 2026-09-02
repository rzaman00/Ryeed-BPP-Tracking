# BPP Predicts v3.3.0 — Responsive Mission UI

This build keeps the proven operational predictor and makes its dense map UI easier to operate:
- Launch themes are a header dropdown and now style the complete top and bottom chrome.
- Launch Weather uses distinct white dry markers, blue rain markers, and gust-severity rings.
- Header tabs and prediction controls wrap dynamically instead of clipping.
- Geofence editing, prediction summaries, weather, and optimal status occupy separate map zones.
- Optimal-site colors persist through normal map interaction until a new predicts run begins.
- Secondary layer groups are collapsible.

All established prediction, optimal-site, APRS, airspace, inflation-calculator, export, and drawing functionality is retained.

# BPP Predicts v3.3.0

Standalone University of Maryland Balloon Payload Program prediction and launch-planning application.

## Run on Windows
From the repository root, double-click `START_BPP_PREDICTS.bat`, or run it from a terminal. The launcher verifies `/api/health` before opening the browser and prevents an older local BPP build from being mistaken for this release.

## Major capabilities
- Burst and stitched-float trajectories.
- Integrated MATLAB-equivalent inflation calculator and automatic/manual burst altitude.
- Preset and custom launch sites, custom oriented geofences, 2-D/3-D map modes.
- FAA Class B/C/D/E, SUA and TFR layers with altitude-aware scoring.
- Live APRS multi-callsign prediction using packet latitude, longitude, altitude and time.
- Fast/current and all-site optimal-site searches with optional ascent-rate sweep.
- Historical replay: archived Tawhiri model cycles first, NOAA/PSL NCEP/NCAR Reanalysis fallback for older dates supported by that archive.
- Launch weather: wind, gusts, rain and temperature plus a dedicated weather map mode.
- Launch-specific visual themes without altering operational/safety colors.
- KML/geofence export, parameter sweep, address query, drawing tools, and prediction summaries.

## Historical-data note
Surface weather archives cover a wider historical period than the upper-air replay engine. This application intentionally requires compatible upper-air wind data for a historical balloon trajectory; its explicit lower bound is 1948. Very old replay results and NOAA fallback results are labelled as historical reconstructions.

## APRS
Create `predicts/modern/.env` from `.env.example` and set `APRSFI_API_KEY=...`. Never commit a real API key.

## Verify
Open `http://127.0.0.1:8000/api/health`; `version` must be `3.3.0`.
