# BPP Predicts v2.6.0 — Standalone Predicts + Inflation Calculator

This build keeps the v2.4 operational predictor and adds a fully integrated inflation calculator based directly on the supplied `InflationCalculations2024.m`. No MATLAB installation is required.

## Application tabs

The local application has exactly two primary tabs:

- **Predicts** — launch-site, custom-site, live APRS, airspace, drawing, export, sweep, and trajectory workflows.
- **Inflation Calculator** — the MATLAB-equivalent launch inflation calculation.

The previous BPP website navigation links are removed from the local interface.

## Burst altitude

Burst predictions default to **Automatic (Inflation Calculator)**. The calculator output is copied into the burst-altitude field and refreshed whenever its launch conditions or desired ascent rate change. Switch the Burst Altitude selector to **Manual** to edit the field exactly as before.

The MATLAB model reports burst height **above launch site**, and v2.6 intentionally preserves that model/output rather than silently changing the equations.

## Launch-site labels

Past launch sites are displayed as:

`City - Location`

For example: `Clear Spring - Claud E. Kitchens Outdoor School at Fairview`.

## Inflation model provenance

The original supplied MATLAB source is bundled unchanged at `reference/InflationCalculations2024.m`. The Python port preserves the constants and equations: drag coefficient 0.25, gas constants, 2–3 m launch-diameter bracket, scale-lift calculation, PSI conversion, 10.5 m Hwoyee 1600 burst diameter, and the 7238.3 m exponential-density burst-height approximation.

## Start

Windows repository root:

```powershell
.\START_BPP_PREDICTS.bat
```

Verify: `http://127.0.0.1:8000/api/health` should report `2.6.0`.

Live APRS still requires `APRSFI_API_KEY` in `.env`. Prediction, APRS, map tiles, and live FAA data require internet access when those services are used.


## v2.6 Optimal Site

`Find Optimal Site` runs the current prediction settings from every loaded preset launch site. The ranking is lexicographic: a route with zero scored FAA-airspace intrusion wins; if no route is clear, the route with the least horizontal ground-track distance inside the union of Class B/C/D, Class E, SUA, and TFR polygons wins; distance to the University of Maryland College Park reference point breaks ties. Evaluated sites are outlined red and the winner green.

Parameter-sweep trajectories have a wider invisible hit target; click any dotted sweep path to see the exact swept ascent/descent rate or altitude value. Launch-site labels are displayed as city only, while full location/address remains available as hover metadata.
