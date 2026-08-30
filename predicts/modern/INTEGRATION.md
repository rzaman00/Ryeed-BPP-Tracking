# Integration plan — v2.3.0

Use this folder as the only runnable Predicts application:

```text
Ryeed-BPP-Tracking/predicts/modern
```

The sibling `predicts/BalloonPredictionMap` directory may remain only as a source of legacy GeoJSON data. The launch scripts never start it.

1. Replace the old `predicts/modern` folder with this one.
2. From the repository root run `git lfs pull` once.
3. Run `predicts\modern\run_windows.bat` or top-level `START_BPP_PREDICTS.bat`.
4. Verify `/api/health` reports version `2.3.0`.
5. Add `APRSFI_API_KEY` to `.env` for live operation.
6. In Live Track, enter one or more callsigns and confirm the displayed latitude/longitude/altitude match aprs.fi before running live predicts.

The v2.3 launcher checks for older BPP Predicts servers before launch and opens the browser only after v2.3.0 is verified healthy.
