# Build report — BPP Predicts v2.7.0

## Added in v2.7
- Two optimal-site searches: **Current Sites** (selected presets + all manually drawn points) and **All Sites** (complete deduplicated preset list; normally 16 from the historical source).
- Site viability testing across the current ascent rate and practical ±0.5 / ±1.0 m/s adjustments.
- Automatic-burst searches recalculate the inflation-model burst altitude for each tested ascent rate.
- Operational site colors: gold overall best, blue preferred viable Clear Spring/Hancock, green viable, red no-go/manual review.
- Landing no-go check for restricted controlled airspace, SUA, and TFR polygons.
- Launch-site city de-duplication so Clear Spring and Cumberland appear only once.
- Launch-site status legend shown with prediction/optimal results.

## Preserved
- Standalone Predicts + Inflation Calculator tabs.
- Burst/float predicts, automatic/manual burst altitude, multi-callsign APRS live predicts, FAA layers, custom points, oriented geofences, parameter sweeps, KML/GeoJSON exports, 2D/3D, and dark mode.

## Validation
- Python compilation passed.
- JavaScript syntax check passed.
- Geometry and UI-helper Node tests passed.
- 31 Python automated tests passed, including duplicate-city handling, ascent-rate viability adjustment, restricted-airspace landing checks, preferred-site coloring, and both optimal-site button contracts.
- Local FastAPI health/config/launch/inflation smoke tests passed.
