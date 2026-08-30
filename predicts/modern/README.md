# BPP Predicts v2.7.0 — Standalone Predicts + Inflation Calculator

This build keeps the v2.4 operational predictor and adds a fully integrated inflation calculator based directly on the supplied `InflationCalculations2024.m`. No MATLAB installation is required.

## Application tabs

The local application has exactly two primary tabs:

- **Predicts** — launch-site, custom-site, live APRS, airspace, drawing, export, sweep, and trajectory workflows.
- **Inflation Calculator** — the MATLAB-equivalent launch inflation calculation.

The previous BPP website navigation links are removed from the local interface.

## Burst altitude

Burst predictions default to **Automatic (Inflation Calculator)**. The calculator output is copied into the burst-altitude field and refreshed whenever its launch conditions or desired ascent rate change. Switch the Burst Altitude selector to **Manual** to edit the field exactly as before.

The MATLAB model reports burst height **above launch site**, and v2.7 intentionally preserves that model/output rather than silently changing the equations.

## Launch-site labels

Past launch sites are displayed by **city only**. Duplicate city entries from the online/cache/bundled sources are collapsed so operational locations such as Clear Spring and Cumberland appear once.

## Inflation model provenance

The original supplied MATLAB source is bundled unchanged at `reference/InflationCalculations2024.m`. The Python port preserves the constants and equations: drag coefficient 0.25, gas constants, 2–3 m launch-diameter bracket, scale-lift calculation, PSI conversion, 10.5 m Hwoyee 1600 burst diameter, and the 7238.3 m exponential-density burst-height approximation.

## Start

Windows repository root:

```powershell
.\START_BPP_PREDICTS.bat
```

Verify: `http://127.0.0.1:8000/api/health` should report `2.7.0`.

Live APRS still requires `APRSFI_API_KEY` in `.env`. Prediction, APRS, map tiles, and live FAA data require internet access when those services are used.


## v2.7 Optimal-site workflow

- **Find Optimal: Current Sites** checks the preset launch sites currently selected for predicts plus every manually drawn launch point. This is the fast operational check.
- **Find Optimal: All Sites** checks the complete deduplicated historical preset list (normally 16 sites when the full BPP launch-location source is available).
- Each site is tested at the requested ascent rate and practical ±0.5 / ±1.0 m/s adjustments. With Automatic Burst enabled, the integrated inflation model recalculates burst altitude for each tested ascent rate.
- **Gold** = overall best available. **Blue** = viable preferred Clear Spring/Hancock. **Green** = viable because a tested ascent rate clears scored airspace and the landing is outside high-risk airspace. **Red** = no-go/manual review because the tested adjustments do not produce a clear/safe result.
- Restricted controlled airspace, SUA, and TFR polygons are treated as high-risk landing zones.
- Clicking an evaluated site shows its status, best tested ascent rate, intrusion distance, and distance from UMD.
- The status legend appears after predictions/optimal analysis.
- Parameter-sweep dotted lines remain clickable and identify the exact swept ascent/descent rate or altitude.
