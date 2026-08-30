# Integration — v2.9.0

Replace the previous `predicts/modern` directory with this one and keep the root launchers from this package.

1. Copy/extract package into the repository root.
2. Put an APRS.fi key in `predicts/modern/.env` if live tracking is needed.
3. Run `START_BPP_PREDICTS.bat`.
4. Confirm `/api/health` reports `2.9.0`.
5. On Predicts, Burst Altitude defaults to Automatic (Inflation Calculator).
6. Use the Inflation Calculator tab to change station pressure, temperature, balloon/neck mass, payload mass, or desired ascent rate.
7. Switch Burst Altitude to Manual whenever an operator needs to override the calculator.
