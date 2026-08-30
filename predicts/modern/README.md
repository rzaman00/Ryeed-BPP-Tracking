# BPP Predicts v2.9.0 — Standalone Predicts + Inflation Calculator

This build keeps the v2.4 operational predictor and adds a fully integrated inflation calculator based directly on the supplied `InflationCalculations2024.m`. No MATLAB installation is required.

## Application tabs

The local application has exactly two primary tabs:

- **Predicts** — launch-site, custom-site, live APRS, airspace, drawing, export, sweep, and trajectory workflows.
- **Inflation Calculator** — the MATLAB-equivalent launch inflation calculation.

The previous BPP website navigation links are removed from the local interface.

## Burst altitude

Burst predictions default to **Automatic (Inflation Calculator)**. The calculator output is copied into the burst-altitude field and refreshed whenever its launch conditions or desired ascent rate change. Switch the Burst Altitude selector to **Manual** to edit the field exactly as before.

The MATLAB model reports burst height **above launch site**, and v2.9 intentionally preserves that model/output rather than silently changing the equations.

## Launch-site labels

Past launch sites are displayed by **city only**. Duplicate city entries from the online/cache/bundled sources are collapsed so operational locations such as Clear Spring and Cumberland appear once.

## Inflation model provenance

The original supplied MATLAB source is bundled unchanged at `reference/InflationCalculations2024.m`. The Python port preserves the constants and equations: drag coefficient 0.25, gas constants, 2–3 m launch-diameter bracket, scale-lift calculation, PSI conversion, 10.5 m Hwoyee 1600 burst diameter, and the 7238.3 m exponential-density burst-height approximation.

## Start

Windows repository root:

```powershell
.\START_BPP_PREDICTS.bat
```

Verify: `http://127.0.0.1:8000/api/health` should report `2.9.0`.

Live APRS still requires `APRSFI_API_KEY` in `.env`. Prediction, APRS, map tiles, and live FAA data require internet access when those services are used.


## v2.9 Optimal-site workflow

- **Find Optimal: Current Sites** checks selected preset sites plus every manually drawn launch point.
- **Find Optimal: All Sites** checks the complete preset list after strict city de-duplication: one row per launch city.
- The **Optimal ascent sweep** toggle chooses current-rate-only (fast) or current ±0.5/±1.0 m/s. Automatic Burst recalculates the inflation model for each tested rate.
- Airspace conflicts are scored in 3-D. A horizontal crossing does **not** count when the balloon is above that FAA polygon's upper altitude at the actual crossing.
- **Gold is reserved only for a viable preferred site**: Clear Spring first, otherwise Hancock.
- **Green** = any other viable site with no scored 3-D conflict and a safe landing.
- **Red** = airspace conflict/no-go; Clear Spring or Hancock are also red when they are not viable.
- There is no blue status and geographic distance is not calculated or used for ranking.
- Restricted controlled airspace, SUA, and TFR polygons remain landing no-go zones.
- Parameter-sweep dotted lines remain clickable and identify the exact swept value.
