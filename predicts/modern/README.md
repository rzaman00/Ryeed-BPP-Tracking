# BPP Predicts v3.6.0 — Responsive Mission UI

This build keeps the proven operational predictor and makes its dense map UI easier to operate:
- A Readiness tab exposes GO/CAUTION/NO-GO decisions and every underlying safety factor.
- A sortable comparison table places weather, trajectory, landing, airspace, and Ventusky data side by side.
- Operations Basic is the clean default and keeps automatic burst altitude, SUA, and TFRs visible; Operations Advanced restores Float, sweeps, drawing, 3-D, reference, and utility controls.
- Live Tracking is a separate top-level workspace backed by a read-only APRS-IS stream with no API key.
- Readiness weather explicitly requests the full forecast window and retries with GFS when the best-match model has a gap.
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

# BPP Predicts v3.6.0

Standalone University of Maryland Balloon Payload Program prediction and launch-planning application.

## Run on Windows
From the repository root, double-click `START_BPP_PREDICTS.bat`, or run it from a terminal. The launcher verifies `/api/health` before opening the browser and prevents an older local BPP build from being mistaken for this release.

## Major capabilities
- Burst and stitched-float trajectories.
- Integrated MATLAB-equivalent inflation calculator and automatic/manual burst altitude.
- Preset and custom launch sites, custom oriented geofences, 2-D/3-D map modes.
- FAA Class B/C/D/E, SUA and TFR layers with altitude-aware scoring.
- Live APRS-IS multi-callsign tracking and prediction using packet latitude, longitude, altitude and time.
- Fast/current and all-site optimal-site searches with optional ascent-rate sweep.
- Transparent launch-readiness summaries and sortable selected-site comparison.
- Basic and Advanced operational control modes.
- Current and future prediction dates within the seven-day model window.
- Launch weather: wind, gusts, rain and temperature plus a dedicated weather map mode.
- Launch-specific visual themes without altering operational/safety colors.
- KML/geofence export, parameter sweep, address query, drawing tools, and prediction summaries.

## APRS
No API key is required. The server opens a read-only APRS-IS connection to `rotate.aprs2.net:14580`, applies a callsign budlist filter, retains each received trail, and reconnects automatically. Optional server/login overrides are documented in `.env.example`.

The connection approach follows the UMD-focused [CHASE/ChaseMapper APRS implementation](https://github.com/huonghuy/chasemapper-aprs).

## Verify
Open `http://127.0.0.1:8000/api/health`; `version` must be `3.6.0`.
