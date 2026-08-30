BPP Predicts — current modern build v2.3.0
==========================================

WINDOWS QUICK START
1. Extract this ZIP into the Ryeed-BPP-Tracking repository (or use it standalone).
2. Double-click START_BPP_PREDICTS.bat.
3. On the first run, the launcher creates the Python environment and installs requirements.
4. The browser opens only after the backend verifies that v2.3.0 is running.

LIVE APRS IN v2.3
- Switch Mode to Live Track.
- Type one or more APRS callsigns into Callsign(s). Separate them with commas or spaces.
- Defaults: KC3SKW-8, KC3SKW-9, KC3SKW-10.
- Run Live Predict creates a prediction for every callsign with a current APRS packet.
- Every live prediction starts from the latest APRS latitude, longitude, AND altitude.
- If a station has no reported altitude, that callsign is skipped with an error instead of
  producing an inaccurate ground-level prediction.

IMPORTANT IF YOU USE THE EXISTING GITHUB REPOSITORY
Use this package's predicts\modern folder as the repository's one and only runnable
Predicts application folder:

  Ryeed-BPP-Tracking\predicts\modern

Keep the sibling BalloonPredictionMap folder only because the modern backend reads its
GeoJSON data. You do NOT need to run or open BalloonPredictionMap. The v2.3 launcher
stops older BPP Predicts servers and verifies the current build before opening a browser.

VERIFY THE BUILD
Open http://127.0.0.1:8000/api/health while the app is running. It should report:
  "version": "2.3.0"
