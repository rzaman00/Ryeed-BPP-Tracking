# Build report — BPP Predicts v3.4.1

This build is a responsive UI release on top of the v3.2.1 stability and performance fixes. The backend/frontend architecture and operational predictor are unchanged.

## v3.4.1 fixes
- Restored the original 11 launch locations and their addresses as packaged local data.
- Restored the two original POIs and removed false missing-file warnings for both datasets.
- Prefer packaged launch data over remote/cache/fallback variants, without a startup network fetch.
- Reworked Country Desert and Summer Beach as flat-color themes and added Pride.
- Made Run Predicts light in light mode while preserving running/success feedback.
- Applied BPP gust thresholds: Low 0–5 mph, Medium 5–15 mph, High above 15 mph.
- Added one launch-site card with weather, address, coordinates, source, optimal status, and a coordinate-linked Ventusky action.
- Combined time and time zone in a clock popover and added Clear All for launch sites.
- Added Country Desert and Summer Beach chrome themes.
- Disabled unreliable past predictions in the UI and API launch window.
- Made Info use the shared light/dark surface tokens.
- Added complete Maryland-flag, star-and-moon Night Launch, and animated Aurora chrome themes.
- Replaced the clipping control strip with a dynamically wrapping layout.
- Docked map overlays and added a geofence focus state that prevents inspector/summary overlap.
- Added white dry-weather markers, blue rain markers, and low-to-high gust rings.
- Separated weather and optimal-status legends and reduced trajectory emphasis in weather mode.
- Preserved optimal-site colors through clicks and control edits; only a new normal predicts run clears them.
- Made Basemap and Reference layer sections collapsible by default.
- Reused one details popup so feature cards cannot stack on top of each other.
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
- Past launch times are rejected while current/future predicts, 3D geofences, themes, optimal-site logic, live APRS, and inflation behavior remain present.
