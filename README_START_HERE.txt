BPP Predicts v3.2.0 — UI stability + Info tab

Install:
1. Save predicts\modern\.env if it contains your APRS.fi key.
2. Replace the previous predicts\modern folder with this package's predicts\modern folder.
3. Restore .env.
4. Double-click START_BPP_PREDICTS.bat.
5. Confirm http://127.0.0.1:8000/api/health reports version 3.2.0.

What changed from v3.0.1:
- Removed the control-strip History badge; historical prediction support is now documented in Info.
- Added an Info tab beside Inflation Calculator with a concise feature guide.
- Rebuilt Launch Theme as a contained custom modal instead of a native browser dialog.
- Rebuilt Parameter Sweep with the same stable modal system.
- About Map now opens the Info tab instead of a long modal.
- Launch Weather remains an inline map mode with its own compact legend/weather card; it never opens a modal.
- Added explicit modal close/backdrop/Escape behavior so hidden dialog content cannot spill over the map.
- Strengthened Windows setup so a corrupted pip/.venv is automatically rebuilt.

All v3.0 operational functionality is preserved: historical replay, weather, themes, 3D geofences, optimal-site search, altitude-aware airspace scoring, live APRS, inflation calculator, exports, parameter sweep, custom launch sites, Burst/Float, and dark mode.
