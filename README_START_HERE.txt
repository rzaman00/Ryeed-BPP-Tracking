BPP Prediction Suite v3.8.0

Requirements:
- Python 3.11 or newer.
- An internet connection for predictions, weather models, map tiles, and FAA data.
- Docker is not required.

Start on Windows:
1. Double-click START_BPP_PREDICTS.bat.
2. The application opens at http://127.0.0.1:8000/.
3. Keep the launcher window open while using Predicts.

Prediction and safety features:
- Burst and Float predictions with automatic inflation-based burst altitude.
- Optimal-site and optimal-ascent-rate searches.
- Operations Basic retains B/C/D, special-use, and TFR layers.
- Launch Readiness explains gust, precipitation, airspace, forecast-age, and
  landing/water decisions for every selected site.
- BPP Safety Rules provides locally saved operational thresholds.
- Forecast Models compares Best Match, NOAA GFS, ECMWF IFS, and DWD ICON.
- Winds Aloft plots model wind speed and direction by altitude.
- FAA data refreshes automatically every 15 minutes and can be refreshed from
  the Layers panel.

This build intentionally contains prediction and launch-planning functionality
only. Live tracking is being developed separately and has no runtime dependency
in this package.
