# Integration — v3.8.1

1. Install Python 3.11 or newer.
2. Run `START_BPP_PREDICTS.bat` from the repository root.
3. Confirm `3.8.1` at `http://127.0.0.1:8000/api/health`.
4. Run a prediction, open Forecast Models & Winds Aloft, and confirm at least
   two available forecast models for the selected site and launch hour.
5. Open BPP Safety Rules, save a test threshold, and confirm Readiness reports
   that inputs changed.
6. In Layers, confirm the FAA freshness card and manual refresh action.
7. Run Find Optimal and confirm checked sites switch to the exact best-ascent
   paths shown in their summary rows.
8. Confirm a landing inside or within the configured 5 mi B/C/D/SUA/TFR buffer
   is red/NO-GO, while a short path more than 2,000 ft above an airspace ceiling
   can remain viable.

No Docker, APRS, ChaseMapper, live-tracking API key, or second server is required.
