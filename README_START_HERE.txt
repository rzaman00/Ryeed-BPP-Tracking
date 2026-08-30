BPP Predicts v2.9.0 — standalone operational build

Run on Windows:
  Double-click START_BPP_PREDICTS.bat

Or from PowerShell at the repository root:
  .\START_BPP_PREDICTS.bat

The application opens at http://127.0.0.1:8000 only after /api/health confirms v2.9.0.

Top-level application tabs:
  - Predicts
  - Inflation Calculator

The old BPP website navigation is intentionally removed. This local app is its own interface.
Prediction/map/APRS data still use their operational online services when those features are requested.

Burst altitude:
  - Automatic is the default and uses the integrated InflationCalculations2024.m equation port.
  - Manual restores the normal editable burst-altitude field.

Live APRS requires APRSFI_API_KEY in predicts\modern\.env.


v2.9 highlights
---------------
- Find Optimal: Current Sites = selected presets + every manually drawn launch point.
- Find Optimal: All Sites = all loaded historical preset sites.
- Optimal ascent sweep is OFF by default for speed. Turn it on to test current ±0.5/±1.0 m/s.
- Gold = viable preferred Clear Spring/Hancock only; Green = other viable clear sites; Red = airspace conflict/no-go. No blue status and no distance ranking.
- Airspace scoring is altitude-aware where FAA vertical limits are available.
- Bottom Parameter Sweep / download toolbar is pinned on-screen.
