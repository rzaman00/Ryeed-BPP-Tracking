# BPP Predicts 3.8.2

Based on the **finished** branch of rzaman00/Ryeed-BPP-Tracking.

## Enter burst altitude in feet

In the Burst Altitude control, select **Manual**, then type in **Feet (ft)**.
The meter field updates immediately; for example, **100,000 ft = 30,480 m**.
Editing meters also updates feet. Predictions, readiness, optimal-site analysis,
and forecast tools continue to use meters internally. Fractional feet are accepted.
The existing minimum of 1,000 m applies in either unit. Empty or lower inputs are
rejected when running a burst prediction.

**Automatic (Inflation Calculator)** still uses the calculator result. Both fields
update together and remain disabled until Manual is selected. Switching back to
Manual restores your previous manual altitude. Float altitude and altitude sweep
bounds retain their existing meter inputs.

## Emo theme

Choose **Launch Theme → Emo**. It uses charcoal panels, muted crimson details,
silver text, and a subtle striped header. Choosing it switches to dark mode;
the existing Light/Dark button can still change brightness. The theme selection
is saved in this browser through the existing theme setting.

Operational status, airspace, and trajectory colors keep their existing meanings.

## Run

Extract the complete ZIP, then run **START_BPP_PREDICTS.bat**. The launcher installs
the dependencies when needed and opens the app. The build badge and /api/health
report **3.8.2**. Internet is needed for first-time setup and the app's existing
map, weather, FAA, and prediction services.

When updating a Git checkout, copy this package's contents into that checkout,
keeping its existing .git folder and private .env file. Do not replace the checkout
with a fresh folder if you want to retain its Git connection. The ZIP contains no
Git metadata, local caches, virtual environment, or private .env file.

## Validation

Run the Python suite with `python -m pytest -q` inside predicts/modern.
JavaScript checks:

```sh
node tests/test_ui_helpers.mjs
node tests/test_geometry.mjs
node tests/test_burst_units.mjs
node --check static/app.js
```

The burst-unit checks exercise the UI handlers and prediction request builder,
including feet conversion, automatic/manual switching, empty inputs, and minimum
validation. Browser checks cover the new controls, theme persistence, and layout.

The repository's existing forecast/airspace/model limitations still apply. This
update does not deploy a website or push changes to GitHub automatically.
