# BPP Predicts v3.7.2

Standalone UMD Balloon Payload Program launch planning, prediction, weather, and
readiness application. The complete CHASE/ChaseMapper system is vendored beside it
in `predicts/chasemapper` and is opened from the `Live CHASE` top tab.

## Run

Use `START_BPP_PREDICTS.bat` from the repository root. It verifies the modern
server, starts the local ChaseMapper Docker service when Docker Desktop is
available, and opens `http://127.0.0.1:8000/`.

## Safety and readiness

- Basic mode keeps launch site, date/time, ascent/descent rates, automatic burst
  altitude, Run Predicts, B/C/D, SUA, and TFR controls visible.
- Optimal search evaluates the complete ±0.5/±1.0 m/s sweep by default and returns
  the best tested ascent rate.
- Site selection conservatively treats any requested operational-airspace
  footprint crossing as NO-GO while retaining a separate true 3-D metric.
- Chesapeake Bay track crossings and mapped-water landings are NO-GO.
- Readiness shows launch inputs and every gust, precipitation, airspace, forecast
  age, and landing/water factor, with a reason column and sortable comparison.

## Live CHASE

The separate server on port 5001 is the complete source architecture from
`huonghuy/chasemapper-aprs`, including chase-car GPS/navigation, APRS-IS, SPOT,
offline GFS, parcel/landowner lookup, recovery/geofences, profiles, configuration,
and its full Leaflet/Socket.IO interface. It runs under its included GPLv3 license.

The Live CHASE tab opens a local waiting page while Docker Desktop and the
ChaseMapper image start, then redirects automatically to port 5001.

Verify Predicts at `http://127.0.0.1:8000/api/health`; the version is `3.7.2`.
