# Build report — BPP Prediction Suite v3.8.2

## Changes in this update

- Added synchronized manual burst-altitude fields in meters and feet.
- Preserved automatic calculator updates and previous manual values.
- Added the saved Emo launch theme with charcoal/crimson/silver styling.
- Updated launcher/build identifiers to 3.8.2.
- Made the Node syntax check explicitly use UTF-8 on Windows.
- Validation: 65 Python tests passed; UI-helper, geometry, and burst-unit Node
  checks passed. Browser verified 100,000 ft → 30,480 m, automatic/manual
  switching, and saved theme after reload.

## Features retained from finished

- Fixed the optimized-status/map mismatch: optimal-site results now include and
  display the exact best-ascent trajectory that produced each site color.
- Replaced blanket 2-D airspace rejection with a configurable three-part rule:
  no 3-D intrusion, at least 2,000 ft above the published ceiling, and at most
  10 minutes over the footprint.
- Expanded landing checks to every controlled B/C/D, SUA, and TFR polygon and
  added a conservative 5 mi landing buffer, catching inside/near-airspace cases.
- Added a 5 mi landing buffer around mapped large water while keeping rivers and
  streams outside the large-water hazard dataset.
- Added exact airspace overflight duration, vertical-clearance, nearest-airspace,
  and nearest-large-water evidence to readiness and launch-site details.

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

