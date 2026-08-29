BPP Predicts — current modern build v2.2.0
==========================================

WINDOWS QUICK START
1. Extract this ZIP.
2. Double-click START_BPP_PREDICTS.bat.
3. On the first run, the launcher creates the Python environment and installs requirements.
4. The browser opens only after the backend verifies that v2.2.0 is running.

IMPORTANT IF YOU USE THE EXISTING GITHUB REPOSITORY
For the complete preset launch-site and reference-layer data, use this package's
predicts\modern folder as the repository's one and only modern application folder:

  Ryeed-BPP-Tracking\predicts\modern

Keep the sibling BalloonPredictionMap folder only because the modern backend reads its
GeoJSON data. You do NOT need to run or open BalloonPredictionMap. The v2.2 interface
has no legacy-predictor navigation link, and run_windows.bat stops older BPP Predicts
servers before starting the current build.

WHAT CHANGED IN v2.2.0
- Updated modern interface styling with rounded/translucent controls and cleaner typography.
- Light/dark theme toggle; dark mode also starts with the dark map basemap.
- Predicted landing targets are now native MapLibre WebGL point layers, not HTML markers.
  This keeps the red target centered on the exact final prediction coordinate at every zoom.
- Legacy preset coordinates prefer explicit latitude/longitude properties when available.
- Frontend assets are served with no-cache headers and versioned URLs to prevent stale UI.
- New current-build launcher verifies v2.2.0 before opening the browser and avoids running
  an older BPP Predicts server at the same time.
- The old "legacy predicts" navigation item was removed from the modern UI.

VERIFY THE BUILD
Open http://127.0.0.1:8000/api/health while the app is running. It should report:
  "version": "2.2.0"

If port 8000 is occupied by an unrelated program, the launcher automatically picks a free
nearby port and opens the correct URL for you.
