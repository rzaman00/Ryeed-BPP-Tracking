# Integration — v3.2.0

1. Preserve `predicts/modern/.env` if it contains `APRSFI_API_KEY`.
2. Replace the existing `predicts/modern` directory with this release.
3. Replace the root `START_BPP_PREDICTS.bat` / `.ps1` launcher files.
4. Run `START_BPP_PREDICTS.bat`.
5. Confirm `http://127.0.0.1:8000/api/health` reports `3.2.0`.
6. For historical replay, use a launch date in the past. The UI no longer rejects dates merely because they are more than eight hours old.
7. For weather, select `Layers > Map Mode > Launch Weather` or select/run a launch site to display its launch-time conditions.
8. Draw an oriented rectangle, select it, set `3D upper bound (ft)`, then switch `Map Dimensions` to `3D`.
