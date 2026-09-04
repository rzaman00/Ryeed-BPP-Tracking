# BPP Predicts v3.8.0

Standalone UMD Balloon Payload Program launch planning, prediction, weather,
airspace, inflation, and readiness application.

## Run

Use `START_BPP_PREDICTS.bat` from the repository root. The launcher creates the
Python virtual environment when needed, verifies the server, and opens
`http://127.0.0.1:8000/`. Docker is not required.

## Forecast analysis

Run a prediction and choose `Forecast Models & Winds Aloft` in its summary.
The comparison requests Open-Meteo Best Match, NOAA GFS, ECMWF IFS, and DWD
ICON. It shows surface conditions, model landing-screening estimates, distance
from the model consensus, the conservative model, and pressure-level winds.
Tawhiri remains the primary BPP trajectory; dashed model tracks are explicitly
identified as launch-column screening estimates. Winds-aloft heights use the
standard approximate altitude for each pressure level.

## FAA data

Controlled B/C/D, Class E, special-use airspace, and active TFR data use local
disk caches. The server checks those caches every 15 minutes, refreshes expired
sources, preserves the last usable copy during an upstream outage, and exposes
freshness in the Layers panel. Operators can also request an immediate refresh.

## Safety and readiness

- Basic mode keeps launch site, date/time, ascent/descent rates, automatic burst
  altitude, Run Predicts, B/C/D, SUA, and TFR controls visible.
- Optimal search evaluates the complete ±0.5/±1.0 m/s sweep by default.
- Operational-airspace and Chesapeake/water crossings are conservative NO-GO
  conditions under the default policy.
- `BPP Safety Rules` stores configurable gust, precipitation, forecast-age,
  airspace, water, and landing thresholds in the local browser.
- Missing required safety evidence always produces NO-GO.

Verify the server at `http://127.0.0.1:8000/api/health`; the version is `3.8.0`.
