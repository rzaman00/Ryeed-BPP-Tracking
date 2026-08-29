# Integration plan — v2.2.0

Use this folder as the only runnable Predicts application:

```text
Ryeed-BPP-Tracking/predicts/modern
```

The sibling `predicts/BalloonPredictionMap` directory may remain in the repository **only as a source of legacy GeoJSON data**. The modern UI no longer links to it, and the launch scripts never start it.

1. Delete or rename the old `predicts/modern` folder.
2. Copy this `predicts/modern` folder into its place.
3. From the repository root run `git lfs pull` once so the existing large GeoJSON data files are materialized.
4. Run `predicts\modern\run_windows.bat` (or the top-level `START_BPP_PREDICTS.bat`). First-run setup is automatic.
5. Verify `/api/health` reports version `2.2.0`.
6. Test preset-site Burst/Float predictions, custom points, geofences, layers, KML, parameter sweep, and APRS if configured.

The v2.2 launcher checks for older BPP Predicts servers before launch and opens the browser only after v2.2.0 is verified healthy.
