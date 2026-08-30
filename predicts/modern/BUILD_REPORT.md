# Build report — BPP Predicts v2.6.0

Implemented on top of v2.4 final operational.

## Added
- Standalone top navigation with only Predicts and Inflation Calculator.
- Direct Python port of `InflationCalculations2024.m`; no MATLAB runtime dependency.
- Automatic burst altitude from inflation calculator by default.
- Manual burst-altitude mode retaining the prior workflow.
- Bidirectional desired-ascent-rate synchronization between Predicts and Inflation Calculator.
- Past launch-site labels standardized to `City - Location`.
- Original MATLAB file bundled unchanged for traceability.

## Preserved
- Burst and float prediction workflows.
- Multi-callsign APRS live predictions using latitude, longitude, altitude, and packet timestamp.
- FAA B/C/D/E, SUA, and TFR layers with cache.
- Custom launch points and selectable custom predicts.
- Oriented 3-click geofence rectangles.
- Light/dark mode, prediction summary, KML/GeoJSON export, parameter sweep, and drawing controls.

## Validation
- Python compilation.
- JavaScript syntax check.
- Oriented-rectangle geometry tests.
- 21 pytest tests, including numerical agreement with the supplied MATLAB equations.
- Local FastAPI health/index/inflation smoke test.
