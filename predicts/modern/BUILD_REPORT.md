# Build report — BPP Predicts Modern v0.1

## Scope

This build is an additive replacement candidate for the BPP prediction interface. The current `predicts/BalloonPredictionMap` implementation is intentionally left untouched during local validation.

## Requirement coverage

| Requested change | Implementation |
| --- | --- |
| APRS.fi live tracking | Python proxy uses one batch request for KC3SKW-8, KC3SKW-9, KC3SKW-10; browser never sees the API key |
| Live predicts | Re-predict from the selected tracker's latest APRS latitude/longitude/altitude; optional 2-minute auto re-predict |
| Modern appearance | New dark operational dashboard, compact controls, clear visual hierarchy |
| Trajectory strongest visual element | Thick stage-colored line with dark casing; airspace deliberately low-opacity |
| Obvious landing point | Pulsing red landing marker plus persistent predicted-landing card |
| Flight-summary card | Flight time, maximum altitude, ground distance, model dataset, stage durations, landing time/coordinates |
| Modern navigation | Responsive top navigation with Predict and Live Track workspaces |
| Responsive | Desktop, tablet, and mobile breakpoints |
| Cleaner airspace | Only operational controlled/special-use/TFR overlays are loaded; reduced opacity, thin outlines, layer toggles |
| Flight path information | Stage list plus hover waypoints with stage, altitude, and time |
| Prediction summary | Included in landing/flight summary card |
| Only Burst and Float | User-facing predictor contains exactly Burst and Float; Float uses BPP's stitched-float logic |
| Preserve current functionality | Existing legacy code is not deleted or overwritten; KML export, custom coordinates, 2D/3D viewing remain in the new interface, and the existing map remains available during transition |

## Technical decisions

- **Frontend:** plain HTML/CSS/JavaScript + MapLibre GL JS. This keeps the code understandable and avoids a framework/build-chain dependency.
- **Backend:** FastAPI/Python. Used for APRS credentials, Tawhiri requests, normalization, summaries, caching, and local serving.
- **Prediction engine:** SondeHub-hosted Tawhiri remains authoritative, matching the current BPP code.
- **Float:** two standard Tawhiri predictions are stitched: normal ascent to float altitude, then slow ascent for the requested float duration followed by normal descent.
- **Airspace/launch data:** reuses the existing BPP GeoJSON files, so the team's current data pipeline remains authoritative.
- **Security:** `.env` is ignored; APRS API key is server-side only.

## Validation performed

- Python bytecode compilation: pass
- JavaScript syntax check (`node --check`): pass
- Unit tests: **5 passed**
- Local FastAPI smoke test: health and launch-location endpoints pass
- Isolated Chromium UI render with MapLibre/API mocks: desktop, mobile, prediction-summary, and live-tracking states render without page errors
- Burst/Float API schemas checked against the existing BPP predictor code and current SondeHub Tawhiri documentation
- APRS batching and HTTPS endpoint checked against current aprs.fi API documentation

## Environment limitation

The coding container cannot make arbitrary outbound network connections, so a real Tawhiri forecast and a real APRS.fi request cannot be executed here. The external API contracts were verified against the current BPP source and published API documentation, while network-dependent behavior is isolated behind tested service functions. The first run on a normal internet-connected computer is the required integration test.

## First local acceptance test

1. Put this `modern` directory at `Ryeed-BPP-Tracking/predicts/modern`.
2. From the repository root, run `git lfs pull` so the existing launch/airspace GeoJSON files are materialized.
3. Open PowerShell in `predicts/modern`.
4. Run `./setup_windows.ps1`.
5. Add `APRSFI_API_KEY` to `.env` if testing live tracking.
6. Run `./run_windows.ps1`.
7. Confirm `http://127.0.0.1:8000` opens.
8. Run the same Burst inputs in the legacy and modern predictor and compare trajectory/landing.
9. Run the same Float inputs and compare ascent/float/descent.
10. Test each APRS callsign and a live prediction.

## Do not deploy yet

Production has not been touched. Keep the modern build local until the acceptance test is complete.
