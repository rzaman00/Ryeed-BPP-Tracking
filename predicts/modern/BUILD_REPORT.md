# Build report — BPP Prediction Suite v3.8.0

- Added four-source forecast-model comparison: Open-Meteo Best Match, NOAA GFS,
  ECMWF IFS, and DWD ICON.
- Added model agreement, consensus distance, conservative-model labeling, and
  dashed landing-screening tracks without replacing the primary Tawhiri result.
- Added a responsive winds-aloft SVG chart with exact altitude, speed, and wind
  direction values available from each plotted point.
- Added automatic FAA cache checks every 15 minutes, visible freshness, manual
  refresh, and stale-cache fallback behavior.
- Added a separate BPP Safety Rules top tab with persistent local thresholds for
  gusts, rain, forecast age, airspace, water, and landing risk.
- Connected saved safety rules to every readiness status, reason, criterion, and
  input-staleness check.
- Removed the Live CHASE tab, waiting route, Docker launcher logic, separate
  launch scripts, documentation, tests, and the complete vendored ChaseMapper
  directory. The package now has one server and one startup path.
