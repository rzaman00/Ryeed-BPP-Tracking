BPP Predicts v3.4.1 — Responsive launch-planning UI

Install:
1. Save predicts\modern\.env if it contains your APRS.fi key.
2. Replace the previous predicts\modern folder with this package's predicts\modern folder.
3. Restore .env.
4. Double-click START_BPP_PREDICTS.bat.
5. Confirm http://127.0.0.1:8000/api/health reports version 3.4.1.

What changed in v3.4.1:
- Restored the complete original 11-site launch-location file with street addresses.
- Restored the original POI file so the POI layer loads without a missing-file alert.
- Made packaged launch data authoritative and removed false launch-time cache warnings.
- Simplified Country Desert to flat sand/tan colors and Summer Beach to flat blue, sun, and sand.
- Added a Pride launch theme.
- Run Predicts follows light/dark mode.
- Gust severity uses BPP's 0–5, 5–15, and over-15 mph thresholds.
- Launch markers show weather first, then address/details, with a direct Ventusky link.
- Time and time zone share one clock popover to make room for Float controls.
- Clear All deselects every launch site.
- Added Country Desert, Summer Beach, and Pride launch themes.
- Past predictions are disabled; launch times are limited to now through seven days ahead.
- Info now follows the active light/dark theme.

Weather, themes, 3D geofences, optimal-site search, altitude-aware airspace scoring, live APRS, inflation calculator, exports, parameter sweep, custom launch sites, Burst/Float, and dark mode remain available.
