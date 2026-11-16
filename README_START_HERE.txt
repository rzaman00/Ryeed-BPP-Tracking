BPP Prediction Suite v3.9.1

Requirements:
- Python 3.11 or newer.
- An internet connection for predictions, weather models, map tiles, and FAA data.
- Docker is not required.

Start on Windows:
1. Double-click START_BPP_PREDICTS.bat.
2. The application opens at http://127.0.0.1:8000/.
3. Keep the launcher window open while using Predicts.

New in v3.9.1:
- Burst and float altitude have a meters box and a feet box side by side
  (top bar, Create Burst, Multiple Balloon); typing in one fills in the other.
- Past predictions now reach back 7 days.
- Launch themes added: Electric, Water, David, Lost.

New in v3.9.0:
- Create Burst (Drawing Tools): mark where the balloon burst, enter its altitude
  in feet and burst time, and get the landing site.
- Past predictions (48 hours in v3.9.0, 7 days from v3.9.1).
- Multiple Balloon (Operations Advanced toolbar): run several balloons, each
  with its own time, parameters, and parameter sweep, at the same time.
- Faster predictions and map, and website hosting (predicts/modern/WEBSITE.md).

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
- Short airspace overflights are allowed only when the full crossing remains at
  least 2,000 ft above the published ceiling and lasts no more than 10 minutes.
- Predicted landings must remain at least 5 mi from B/C/D, SUA, TFR, and mapped
  large-water hazards. Rivers and streams are not treated as large water.
- Optimal-site colors now display the exact best-ascent trajectory that was
  scored, so a green/gold result cannot be paired with a different visible path.

This build intentionally contains prediction and launch-planning functionality
only. Live tracking is being developed separately and has no runtime dependency
in this package.
