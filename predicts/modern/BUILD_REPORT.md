# Build report — BPP Predicts v2.2.0

## Changes in this build

- Refreshed the existing operational interface rather than replacing its workflow.
- Added persistent light/dark UI themes; dark theme starts with the dark map basemap.
- Removed the legacy-predictor link from the modern header.
- Replaced HTML landing markers with MapLibre GeoJSON circle layers rendered at the exact final trajectory coordinate.
- Added an active landing halo/center target while keeping the geospatial center fixed.
- Changed preset launch-site normalization to prefer explicit latitude/longitude properties over stale or rounded geometry when available.
- Added versioned frontend asset URLs plus `Cache-Control: no-store` headers.
- Added `run_latest.py`; launch scripts stop older BPP Predicts instances, verify v2.2.0, avoid duplicate current servers, and open only the verified current build.
- Windows launch now performs first-run setup automatically.

## Preserved operational functionality

- Burst and stitched Float prediction workflows
- Explicit Run Predicts action
- Multi-site preset checklist
- Custom point and geofence drawing
- 2D / 3D map modes
- Esri Topography, World Imagery Hybrid, USGS Topo, and Esri Dark Gray
- Controlled / uncontrolled / TFR airspace
- School / restaurant / launch-location / POI reference layers
- National Address Database query
- KML and GeoJSON exports
- Parameter sweep
- APRS.fi live tracking and live re-prediction

## Validation completed

- `python -m py_compile app.py`: pass
- `python -m py_compile run_latest.py`: pass
- `node --check static/app.js`: pass
- Python unit tests: 5 passed
- `/api/health`: reports `2.2.0`
- Static frontend responses: `X-BPP-Build: 2.2.0` and no-cache headers present
- Index contains theme toggle and v2.2.0 build badge

## Real-machine checks still recommended

- Compare a few preset-site predictions against Tawhiri directly.
- Confirm materialized Git LFS reference layers on the target machine.
- Test APRS.fi with the team's API key.
- Confirm the Windows launcher can terminate any previously running older BPP Predicts process on port 8000.
