# Build report — BPP Predicts v2.9.0

## Added/fixed in v2.9
- Strict preset de-duplication: exactly one displayed preset per city; bundled canonical coordinates win for core BPP sites.
- 3-D airspace scoring explicitly compares balloon altitude at each polygon crossing with the FAA floor/ceiling; overflight above the ceiling is not a conflict.
- Removed University of Maryland/distance ranking entirely.
- Gold is reserved exclusively for a viable Clear Spring or Hancock result (Clear Spring has first preference when both are viable).
- All other viable sites are green. Any non-viable site, including Clear Spring/Hancock, is red. Blue status is removed.
- Current-sites/all-sites optimal buttons, current-rate-only speed mode, optional ±0.5/±1.0 m/s sweep, short result cache, full-row status colors, separate legend, restored bottom toolbar, and clickable parameter sweeps are preserved.

## Preserved from prior builds
- Standalone Predicts + Inflation Calculator tabs.
- MATLAB-equivalent inflation model with automatic/manual burst altitude.
- Burst/float predicts, custom launch points, oriented geofences, FAA layers/cache, multi-callsign APRS live predicts with altitude, KML/GeoJSON exports, 2D/3D, dark mode, and prediction summaries.

## Validation
See `tests/` for regression coverage of launch-site de-duplication, altitude-aware airspace overflight, preferred-only gold assignment, no-distance ranking, current/all optimal searches, sweep modes, live tracking, geometry, and the retained operational tools.
