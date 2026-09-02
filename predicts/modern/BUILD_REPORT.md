# Build report — BPP Predicts v3.2.1

This build is a UI-stability release based on v3.0.1. It intentionally does not redesign the operational predictor.

## v3.2.1 fixes
- Fixed a browser-module syntax error that prevented the entire interface from starting.
- Added bounded parallel prediction and parameter-sweep execution.
- Cancelled superseded weather-map requests and reused backend HTTP connections for weather batches.
- Hardened Tawhiri trajectory validation and historical-float fallback behavior.
- Corrected hourly weather indexing when an upstream timestamp is malformed.

## Fixes
- Replaced native `<dialog>` elements with explicit contained modal panels for Launch Theme and Parameter Sweep.
- Added a dedicated Info tab and routed About Map there.
- Removed the History control-strip badge.
- Kept Launch Weather as a map mode with its own compact legend/card; it does not invoke any modal.
- Added robust close behavior (close button, backdrop, Escape) and guarantees only one modal can be visible.
- Updated dependency setup to rebuild a corrupted virtual environment/pip automatically.

## Regression checks
- No native `<dialog>` tags remain in the page.
- Launch Theme and Parameter Sweep are hidden until explicitly opened.
- Info, Predicts, and Inflation Calculator are mutually exclusive application views.
- Launch Weather changes map mode without opening a modal.
- Historical replay, 3D geofences, themes, optimal-site logic, live APRS, and inflation behavior remain present.
