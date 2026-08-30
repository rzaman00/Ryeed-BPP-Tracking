# Build report — BPP Predicts v2.4.0 final operational package

## Functional changes

- Restored preset launch locations using local data, GitHub LFS-media retrieval/cache, and an offline fallback.
- Replaced fragile legacy airspace dependence with current FAA Class B/C/D/E, Special Use Airspace, and TFR services plus disk caching and stale-cache fallback.
- Made custom map points first-class launch sites with individual enable/disable controls and rename support.
- Reworked rectangle drawing into an arbitrary-orientation three-click workflow: baseline start, baseline end, width.
- Replaced free-text primary callsign entry with a dropdown/chip workflow plus an explicit **Add another callsign…** path.
- Preserved multi-callsign APRS fetching/prediction and mandatory live altitude seeding.
- Kept the v2.2/v2.3 page layout, dark mode, landing-target fix, strong trajectory rendering, responsive controls, prediction summary, Burst, stitched Float, KML/GeoJSON export, reference overlays, parameter sweep, and address lookup.
- Package contains only the modern runnable application; no legacy predictor is included.

## Automated validation completed

- Python syntax/compile: pass
- JavaScript syntax (`node --check`): pass
- Oriented-rectangle Node geometry tests: pass
- Python tests: **16 passed**
- UI contract test checks all identified button IDs are referenced by the JavaScript controller.
- Mock tests verify live APRS latitude + longitude + altitude + packet time seed Tawhiri.
- Mock tests verify partial multi-callsign failures do not block valid callsigns.
- Mock tests verify launch sites retain an offline fallback when remote/local LFS data is unavailable.
- Mock tests verify controlled FAA airspace combines Class B/C/D and falls back to cached data on upstream failure.

## Real service requirement

Actual APRS.fi live calls require the user's APRS.fi API key in `.env`. Actual Tawhiri, FAA, map tile, GitHub-media refresh, and other public-data calls require internet access. The code paths and failure/cache behavior are tested locally with mocks because this build environment does not have general outbound network access.
