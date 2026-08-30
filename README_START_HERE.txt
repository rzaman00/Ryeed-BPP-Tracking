BPP Predicts v2.5.0 — standalone operational build

Run on Windows:
  Double-click START_BPP_PREDICTS.bat

Or from PowerShell at the repository root:
  .\START_BPP_PREDICTS.bat

The application opens at http://127.0.0.1:8000 only after /api/health confirms v2.5.0.

Top-level application tabs:
  - Predicts
  - Inflation Calculator

The old BPP website navigation is intentionally removed. This local app is its own interface.
Prediction/map/APRS data still use their operational online services when those features are requested.

Burst altitude:
  - Automatic is the default and uses the integrated InflationCalculations2024.m equation port.
  - Manual restores the normal editable burst-altitude field.

Live APRS requires APRSFI_API_KEY in predicts\modern\.env.
