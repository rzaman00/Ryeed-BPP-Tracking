# BPP Predicts v3.4.0 — Responsive Mission UI

This build keeps the proven operational predictor and makes its dense map UI easier to operate:
- Launch themes are a header dropdown and now style the complete top and bottom chrome.
- Launch Weather uses distinct white dry markers, blue rain markers, and gust-severity rings.
- Clicking a launch marker shows weather, address, coordinates, and a Ventusky link in one card.
- BPP gust categories are Low 0–5 mph, Medium 5–15 mph, and High above 15 mph.
- Time and time zone share one clock popover, and Clear All deselects every site.
- Country Desert and Summer Beach join the existing launch themes.
- Prediction times are limited to now through seven days ahead.
- Header tabs and prediction controls wrap dynamically instead of clipping.
- Geofence editing, prediction summaries, weather, and optimal status occupy separate map zones.
- Optimal-site colors persist through normal map interaction until a new predicts run begins.
- Secondary layer groups are collapsible.

All established prediction, optimal-site, APRS, airspace, inflation-calculator, export, and drawing functionality is retained.

# BPP Predicts v3.4.0

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
- Current and future prediction dates within the seven-day model window.
- Launch weather: wind, gusts, rain and temperature plus a dedicated weather map mode.
- Launch-specific visual themes without altering operational/safety colors.
- KML/geofence export, parameter sweep, address query, drawing tools, and prediction summaries.

## APRS
Create `predicts/modern/.env` from `.env.example` and set `APRSFI_API_KEY=...`. Never commit a real API key.

## Verify
Open `http://127.0.0.1:8000/api/health`; `version` must be `3.4.0`.
