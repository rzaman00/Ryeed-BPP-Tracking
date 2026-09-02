# Integration — v3.4.0

1. Preserve `predicts/modern/.env` if it contains `APRSFI_API_KEY`.
2. Replace the existing `predicts/modern` directory with this release.
3. Replace the root `START_BPP_PREDICTS.bat` / `.ps1` launcher files.
4. Run `START_BPP_PREDICTS.bat`.
5. Confirm `http://127.0.0.1:8000/api/health` reports `3.4.0`.
6. Choose a launch time from now through seven days ahead; past predicts are intentionally disabled.
7. For weather, select `Layers > Map Mode > Launch Weather` or click a launch marker for weather, address details, and its Ventusky link.
8. Draw an oriented rectangle, select it, set `3D upper bound (ft)`, then switch `Map Dimensions` to `3D`.
