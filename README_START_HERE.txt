BPP Predicts v3.3.0 — Responsive launch-planning UI

Install:
1. Save predicts\modern\.env if it contains your APRS.fi key.
2. Replace the previous predicts\modern folder with this package's predicts\modern folder.
3. Restore .env.
4. Double-click START_BPP_PREDICTS.bat.
5. Confirm http://127.0.0.1:8000/api/health reports version 3.3.0.

What changed in v3.3.0:
- Maryland, Night Launch, and Aurora now theme the complete top and bottom chrome.
- Header tabs and prediction controls wrap dynamically instead of clipping.
- Geofence editing uses a dedicated focus layout with no summary overlap.
- Weather uses white dry markers, blue rain markers, and gust-severity rings.
- Weather and optimal-site legends are docked in separate map regions.
- Optimal-site colors persist while selecting sites or editing controls and clear only when Run Predicts starts.
- Layer groups collapse to reduce map clutter.

All v3.0 operational functionality is preserved: historical replay, weather, themes, 3D geofences, optimal-site search, altitude-aware airspace scoring, live APRS, inflation calculator, exports, parameter sweep, custom launch sites, Burst/Float, and dark mode.
