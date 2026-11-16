# Build report — BPP Prediction Suite v3.9.2

## New in v3.9.2

- **Ascent rate has no upper limit.** The 20 m/s cap (10 m/s for float rate) is
  removed from predictions, sweeps, and the optimal-site search; the rate only
  has to be above zero. The inflation model no longer refuses rates outside the
  2-3 m launch-diameter range: it extends the same equations to any diameter
  between lift-off and burst and marks the result as extrapolated. Rates that
  would need a balloon larger than its burst diameter still fail in Automatic
  mode, with a message to use a Manual burst altitude.
- **Animated launch themes**: Night Launch, Aurora, Water, David, and Lost now
  move (Electric already did). Animations stop when the device asks for reduced
  motion.

## New in v3.9.1

- **Altitude in meters and feet**: Burst Altitude and Float Altitude in the top
  bar, the Create Burst panel, and each Multiple Balloon card now have a meters
  box and a feet box side by side. Typing in either fills in the other. Requests
  to the server are unchanged (meters; Create Burst sends feet as before).
- **Past predictions** now reach back 7 days (was 48 hours). The archived GFS
  wind request covers 8 days so a launch 7 days back is inside its range.
- **Launch themes**: Electric, Water, David, and Lost. Operational status colors
  are untouched.

## New in v3.9.0

- **Create Burst** (Drawing Tools): click the map or type GPS coordinates, enter
  the burst altitude in feet and the time the balloon burst, and get a
  descent-only landing prediction. Burst points can be selected, renamed, edited,
  re-run, and deleted like other drawings. New endpoint `POST /api/predict-descent`.
- **Past predictions**: launch and burst times from the last 48 hours are accepted
  everywhere (Run Predicts, sweeps, optimal search, readiness, weather, forecast
  comparison). Tawhiri archived cycles are tried first; if none covers the time,
  hourly GFS winds above the site are used and the result is labelled as an
  approximation. The older NOAA reanalysis ended in March 2026 and could not
  cover recent dates.
- **Multiple Balloon** (Operations Advanced toolbar): each balloon has its own
  launch site, burst/float type, launch date and time, rates, altitude, and its
  own parameter sweep. All balloons and sweeps run together; each balloon is
  outlined in its own colour and a results table lists every landing.
- **Website hosting**: every request is relative to where the app is served, so
  it works at a domain root, under a sub-path, in an iframe (`?embed=1`), or with
  the API on another server. See `WEBSITE.md`, `deploy/`, and `Procfile`.

- **Phone layout**: on a narrow screen the map and ground track fill the
  screen. A `Parameters` tab at the top opens the launch settings, layers,
  drawing tools, toolbar, and summary; tapping it again hides them.

## Speed

- One pooled, kept-alive connection to Tawhiri instead of a new TLS connection
  for every prediction.
- Identical predictions inside three minutes are answered from memory, and
  identical predictions already in flight share one upstream call.
- FAA layers are parsed once and reused until the cache file changes; the
  airspace and landing spatial indexes and the water index are reused the same way.
- Airspace responses are prepared once and answered with `304 Not Modified` on
  reload. Static files revalidate instead of re-downloading.
- Optimal-site scoring builds trajectory segments once instead of twice per
  prediction. Measured against a local stand-in for Tawhiri, an 11-site,
  5-rate optimal search took about 1.1 s instead of 1.4 s.
- The map appears without waiting for the inflation and config requests.
- Map sources redraw once per animation frame; the 3-D curtain is only built
  while 3-D is on; moving the mouse while drawing no longer rebuilds side lists.
- Prediction batches run six at a time instead of four.

## Fixed

- The Parameter Sweep panel sat underneath the control strip, hiding its title
  and close button. Tool panels now open inside the map area.
- A launch a few hours in the past could fail when the newest model cycle
  started after it; earlier cycles are now tried.

Operational trajectory, airspace, and site-status colours, launch themes, safety
rules, and every existing control are unchanged.

## v3.8.1

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
