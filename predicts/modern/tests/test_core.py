from datetime import datetime, timezone

import pytest

from app import haversine_m, stage_feature, summarize, to_map_lon, to_tawhiri_lon


def test_longitude_conversion():
    assert to_tawhiri_lon(-77.0) == 283.0
    assert to_map_lon(283.0) == -77.0
    assert to_map_lon(-77.0) == -77.0


def test_haversine_positive():
    assert 110_000 < haversine_m((39.0, -77.0), (40.0, -77.0)) < 112_500


def test_summary():
    traj1 = [
        {"longitude": 283.0, "latitude": 39.0, "altitude": 100.0, "datetime": "2026-08-29T12:00:00Z"},
        {"longitude": 283.1, "latitude": 39.1, "altitude": 28000.0, "datetime": "2026-08-29T13:00:00Z"},
    ]
    traj2 = [
        {"longitude": 283.1, "latitude": 39.1, "altitude": 28000.0, "datetime": "2026-08-29T13:00:00Z"},
        {"longitude": 283.2, "latitude": 39.2, "altitude": 120.0, "datetime": "2026-08-29T14:00:00Z"},
    ]
    features = [
        stage_feature("ascent", traj1, {"mode": "burst"}),
        stage_feature("descent", traj2, {"mode": "burst"}),
    ]
    result = summarize(features, {"mode": "burst", "launch_name": "Test"})
    assert result["mode"] == "burst"
    assert result["max_altitude_m"] == 28000.0
    assert result["flight_duration_s"] == 7200
    assert round(result["landing"]["longitude"], 1) == -76.8
    assert len(result["stages"]) == 2


def test_normalize_launch_locations_legacy_properties():
    from app import normalize_launch_locations
    data = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            # Deliberately disagree with the explicit properties. Legacy presets can
            # contain geometry generated separately from their authoritative fields.
            "geometry": {"type": "Point", "coordinates": [-70.0, 35.0]},
            "properties": {"address": "Test School, Town, MD", "longitude": 282.5, "latitude": 39.5},
        }],
    }
    out = normalize_launch_locations(data)
    assert out["features"][0]["properties"]["name"] == "Test School"
    assert out["features"][0]["geometry"]["coordinates"] == [-77.5, 39.5]


def test_stitched_float_calls_two_standard_predictions(monkeypatch):
    import asyncio
    import app as appmod
    from app import LaunchPoint, PredictRequest

    calls = []

    async def fake_tawhiri(params):
        calls.append(dict(params))
        if len(calls) == 1:
            return {
                "request": {"dataset": "2026-08-29T18:00:00Z"},
                "prediction": [
                    {"stage": "ascent", "trajectory": [
                        {"longitude": 282.0, "latitude": 39.0, "altitude": 100, "datetime": "2026-08-29T20:00:00Z"},
                        {"longitude": 282.2, "latitude": 39.1, "altitude": 22000, "datetime": "2026-08-29T21:00:00Z"},
                    ]},
                    {"stage": "descent", "trajectory": []},
                ],
            }
        return {
            "request": {"dataset": "2026-08-29T18:00:00Z"},
            "prediction": [
                {"stage": "ascent", "trajectory": [
                    {"longitude": 282.2, "latitude": 39.1, "altitude": 22000, "datetime": "2026-08-29T21:00:00Z"},
                    {"longitude": 282.5, "latitude": 39.2, "altitude": 25600, "datetime": "2026-08-29T22:00:00Z"},
                ]},
                {"stage": "descent", "trajectory": [
                    {"longitude": 282.5, "latitude": 39.2, "altitude": 25600, "datetime": "2026-08-29T22:00:00Z"},
                    {"longitude": 282.8, "latitude": 39.3, "altitude": 120, "datetime": "2026-08-29T22:45:00Z"},
                ]},
            ],
        }

    monkeypatch.setattr(appmod, "tawhiri_request", fake_tawhiri)
    req = PredictRequest(
        mode="float",
        launch=LaunchPoint(name="Test", latitude=39.0, longitude=-78.0, altitude_m=100),
        launch_datetime=datetime(2026, 8, 29, 20, 0, tzinfo=timezone.utc),
        ascent_rate_ms=5.5,
        descent_rate_ms=9,
        float_altitude_m=22000,
        float_ascent_rate_ms=1,
        float_duration_min=60,
    )
    result = asyncio.run(appmod.run_float(req))
    assert len(calls) == 2
    assert calls[0]["profile"] == "standard_profile"
    assert calls[0]["burst_altitude"] == 22000
    assert calls[1]["launch_altitude"] == 22000
    assert calls[1]["burst_altitude"] == 25600
    assert [f["properties"]["stage"] for f in result["features"]] == ["ascent", "float", "descent"]
    assert abs(result["summary"]["landing"]["longitude"] + 77.2) < 1e-9


def test_normalize_callsigns_typed_multi():
    from app import normalize_callsigns

    assert normalize_callsigns("kc3skw-8, KC3SKW-9  kc3skw-8;KC3SKW-10") == [
        "KC3SKW-8", "KC3SKW-9", "KC3SKW-10"
    ]
    with pytest.raises(ValueError):
        normalize_callsigns("bad/callsign")


def test_live_prediction_uses_aprs_position_altitude_and_time(monkeypatch):
    import asyncio
    import app as appmod
    from app import LivePredictBatchRequest

    captured = {}

    async def fake_run_burst(req, meta):
        captured["launch"] = req.launch
        captured["launch_datetime"] = req.launch_datetime
        captured["meta"] = meta
        return {"type": "FeatureCollection", "features": [], "summary": {"launch": {}, "landing": {}}, "request": {}}

    monkeypatch.setattr(appmod, "run_burst", fake_run_burst)
    settings = LivePredictBatchRequest(callsigns=["KC3SKW-8"], mode="burst")
    station = {
        "callsign": "KC3SKW-8",
        "latitude": 39.1234,
        "longitude": -77.5678,
        "altitude_m": 5432.1,
        "time": 1788026400,
        "lasttime": 1788026400,
    }
    result = asyncio.run(appmod.build_live_prediction(settings, "KC3SKW-8", station))

    assert captured["launch"].latitude == 39.1234
    assert captured["launch"].longitude == -77.5678
    assert captured["launch"].altitude_m == 5432.1
    assert captured["meta"]["live_start_altitude_m"] == 5432.1
    assert result["live"]["used_position"]["altitude_m"] == 5432.1
    assert result["live"]["used_altitude_m"] == 5432.1
    assert int(captured["launch_datetime"].timestamp()) == 1788026400


def test_live_prediction_refuses_missing_altitude():
    import asyncio
    import app as appmod
    from app import LivePredictBatchRequest

    settings = LivePredictBatchRequest(callsigns=["KC3SKW-8"], mode="burst")
    station = {
        "callsign": "KC3SKW-8",
        "latitude": 39.1234,
        "longitude": -77.5678,
        "altitude_m": None,
        "time": 1788026400,
    }
    with pytest.raises(appmod.ExternalServiceError, match="no altitude"):
        asyncio.run(appmod.build_live_prediction(settings, "KC3SKW-8", station))


def test_live_batch_supports_arbitrary_callsigns_and_partial_errors(monkeypatch):
    import asyncio
    import app as appmod
    from app import LivePredictBatchRequest

    async def fake_fetch(callsigns, force=False):
        assert callsigns == ["TEST1-1", "TEST2-2"]
        return {
            "source": "aprs.fi",
            "source_url": "https://aprs.fi/",
            "fetched_at": "2026-08-29T22:00:00Z",
            "stations": {
                "TEST1-1": {"callsign": "TEST1-1", "latitude": 39.0, "longitude": -77.0, "altitude_m": 1000.0, "time": 1788031200},
                "TEST2-2": {"callsign": "TEST2-2", "latitude": 39.1, "longitude": -77.1, "altitude_m": 2000.0, "time": 1788031200},
            },
        }

    async def fake_build(settings, callsign, station):
        if callsign == "TEST2-2":
            raise appmod.ExternalServiceError("simulated station failure")
        return {"features": [], "summary": {}, "live": {"used_altitude_m": station["altitude_m"]}}

    monkeypatch.setattr(appmod, "fetch_aprs", fake_fetch)
    monkeypatch.setattr(appmod, "build_live_prediction", fake_build)
    req = LivePredictBatchRequest(callsigns=["test1-1", "test2-2"])
    result = asyncio.run(appmod.live_predict_batch(req))
    assert result["requested_callsigns"] == ["TEST1-1", "TEST2-2"]
    assert result["results"]["TEST1-1"]["live"]["used_altitude_m"] == 1000.0
    assert "TEST2-2" in result["errors"]


def test_bundled_launch_sites_include_operational_fallbacks():
    import app as appmod
    data, warning = appmod.load_geojson(appmod.BUNDLED_LAUNCH_FILE)
    out = appmod.normalize_launch_locations(data)
    names = {f["properties"]["name"] for f in out["features"]}
    assert len(out["features"]) >= 5
    assert "Claud E. Kitchens Outdoor School at Fairview" in names
    assert "Allegany College of Maryland" in names
    assert warning is None


def test_operational_launch_locations_survive_remote_failure(monkeypatch, tmp_path):
    import asyncio
    import app as appmod

    async def fail_remote(*args, **kwargs):
        raise appmod.ExternalServiceError("offline")

    monkeypatch.setattr(appmod, "fetch_json_url", fail_remote)
    monkeypatch.setattr(appmod, "LEGACY_DATA", tmp_path / "missing")
    monkeypatch.setattr(appmod, "LAUNCH_CACHE_FILE", tmp_path / "launch_cache.geojson")
    data, warnings, sources = asyncio.run(appmod.operational_launch_locations())
    assert len(data["features"]) >= 5
    assert "bundled" in sources
    assert any("online" in w.lower() or "not found" in w.lower() for w in warnings)


def test_controlled_airspace_combines_b_c_d(monkeypatch):
    import asyncio
    import app as appmod

    async def fake_fetch(where, layer_name):
        return {"type": "FeatureCollection", "features": [{"type":"Feature","geometry":{"type":"Polygon","coordinates":[]},"properties":{"bpp_airspace_layer":layer_name}}]}

    monkeypatch.setattr(appmod, "fetch_arcgis_airspace", fake_fetch)
    data = asyncio.run(appmod.fetch_controlled_airspace())
    assert len(data["features"]) == 3
    assert {f["properties"]["bpp_airspace_layer"] for f in data["features"]} == {"Class B", "Class C", "Class D"}


def test_airspace_uses_stale_cache_when_faa_unavailable(monkeypatch, tmp_path):
    import asyncio
    import json
    import app as appmod

    cache_dir = tmp_path / "airspace"
    cache_dir.mkdir()
    cached = {"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[]},"properties":{"LOCAL_TYPE":"CLASS_B"}}]}
    (cache_dir / "controlled.geojson").write_text(json.dumps(cached), encoding="utf-8")

    async def fail():
        raise appmod.ExternalServiceError("FAA offline")

    monkeypatch.setattr(appmod, "AIRSPACE_CACHE_DIR", cache_dir)
    monkeypatch.setattr(appmod, "fetch_controlled_airspace", fail)
    data, warning, source = asyncio.run(appmod.operational_airspace("controlled", force=True))
    assert len(data["features"]) == 1
    assert "cache" in source.lower()
    assert "refresh failed" in warning.lower()


def test_health_and_config_report_final_build():
    import asyncio
    import app as appmod
    h = asyncio.run(appmod.health())
    c = asyncio.run(appmod.config())
    assert h["version"] == "2.5.0"
    assert h["airspace"] == "FAA live services with disk cache"
    assert c["default_callsigns"] == appmod.DEFAULT_CALLSIGNS
    assert set(c["airspace_layers"]) == {"controlled", "class_e", "sua", "tfr"}


def test_ui_contract_has_required_controls_and_wiring():
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    html = (base / "static" / "index.html").read_text(encoding="utf-8")
    js = (base / "static" / "app.js").read_text(encoding="utf-8")
    required_ids = [
        "runPredicts", "refreshLive", "callsignPicker", "addCallsignButton", "customCallsign",
        "saveCustomCallsign", "callsignChips", "predictSiteList", "customPredictSiteList",
        "drawingToggle", "deleteDrawing", "deleteAllDrawings", "downloadDrawings", "saveDrawingName",
        "zoomPredicts", "downloadKml", "downloadGeofence", "openSweep", "queryAddresses", "aboutMap",
    ]
    for item in required_ids:
        assert f'id="{item}"' in html
        assert f"$('{item}')" in js or item in js
    for layer in ["controlled", "class_e", "sua", "tfr"]:
        assert f'data-layer="{layer}"' in html
    assert "orientedRectangle" in js
    assert "addPointDrawing" in js
    assert "predict_enabled:true" in js


def test_every_identified_ui_button_has_javascript_wiring():
    import re
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    html = (base / "static" / "index.html").read_text(encoding="utf-8")
    js = (base / "static" / "app.js").read_text(encoding="utf-8")
    button_ids = re.findall(r'<button[^>]+id="([^"]+)"', html)
    assert len(button_ids) >= 20
    for button_id in button_ids:
        assert button_id in js, f"Button {button_id} has no JS reference"


def test_inflation_calculator_matches_matlab_reference_values():
    import app as appmod
    req = appmod.InflationRequest(
        station_pressure_inhg=29.85, site_temperature_f=70,
        balloon_neck_mass_kg=1.605 + 0.650, payload_mass_kg=7.238 - 0.650,
        target_ascent_rate_ms=5.5,
    )
    r = appmod.calculate_inflation(req)
    assert r["expected_ascent_rate_ms"] == pytest.approx(5.5, abs=1e-9)
    assert r["required_scale_lift_lb"] == pytest.approx(20.716485, rel=1e-6)
    assert r["required_psi"] == pytest.approx(4143.2970, rel=1e-6)
    assert r["burst_altitude_m"] == pytest.approx(28826.4092, rel=1e-6)
    assert r["burst_altitude_ft"] == pytest.approx(94574.8363, rel=1e-6)
    assert r["burst_altitude_reference"] == "above launch site"


def test_inflation_calculator_rejects_unachievable_rate():
    import app as appmod
    with pytest.raises(ValueError, match="outside the range achievable"):
        appmod.calculate_inflation(appmod.InflationRequest(target_ascent_rate_ms=19.0))


def test_standalone_tabs_and_auto_manual_burst_contract():
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    html = (base / "static" / "index.html").read_text(encoding="utf-8")
    js = (base / "static" / "app.js").read_text(encoding="utf-8")
    assert 'id="predictsTab"' in html
    assert 'id="inflationTab"' in html
    assert 'id="inflationForm"' in html
    assert 'id="burstAltitudeMode"' in html
    assert '<option value="auto" selected>' in html
    assert '<option value="manual">' in html
    assert "calculateInflation" in js
    assert "setBurstAltitudeMode" in js
    assert "ensureAutomaticBurst" in js
    assert "bpp.umd.edu" not in html.lower()


def test_launch_labels_use_city_dash_location():
    from pathlib import Path
    js = (Path(__file__).resolve().parents[1] / "static" / "app.js").read_text(encoding="utf-8")
    assert "return `${city} - ${location}`" in js


def test_original_matlab_source_is_bundled_for_traceability():
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    matlab = base / "reference" / "InflationCalculations2024.m"
    assert matlab.exists()
    text = matlab.read_text(encoding="utf-8")
    assert "Burst_alt = 7238.3 * log(Rat)" in text
    assert "Lift_required*200" in text
