from pathlib import Path
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
    assert h["version"] == "3.2.0"
    assert h["airspace"] == "FAA live services with disk cache"
    assert c["default_callsigns"] == appmod.DEFAULT_CALLSIGNS
    assert set(c["airspace_layers"]) == {"controlled", "class_e", "sua", "tfr"}


def test_ui_contract_has_required_controls_and_wiring():
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    html = (base / "static" / "index.html").read_text(encoding="utf-8")
    js = (base / "static" / "app.js").read_text(encoding="utf-8")
    required_ids = [
        "runPredicts", "findOptimalCurrent", "findOptimalAll", "optimalAscentSweep", "refreshLive", "callsignPicker", "addCallsignButton", "customCallsign",
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


def test_launch_labels_use_city_only():
    from pathlib import Path
    helper = (Path(__file__).resolve().parents[1] / "static" / "ui_helpers.mjs").read_text(encoding="utf-8")
    assert "if (city) return city" in helper
    assert " - ${location}" not in helper


def test_original_matlab_source_is_bundled_for_traceability():
    from pathlib import Path
    base = Path(__file__).resolve().parents[1]
    matlab = base / "reference" / "InflationCalculations2024.m"
    assert matlab.exists()
    text = matlab.read_text(encoding="utf-8")
    assert "Burst_alt = 7238.3 * log(Rat)" in text
    assert "Lift_required*200" in text



def test_optimal_site_score_detects_airspace_intrusion_and_clear_path():
    import app as appmod
    airspace = {
        "controlled": {"type":"FeatureCollection","features":[{
            "type":"Feature","properties":{},
            "geometry":{"type":"Polygon","coordinates":[[[-77.2,38.9],[-76.9,38.9],[-76.9,39.1],[-77.2,39.1],[-77.2,38.9]]]}
        }]},
        "class_e": {"type":"FeatureCollection","features":[]},
        "sua": {"type":"FeatureCollection","features":[]},
        "tfr": {"type":"FeatureCollection","features":[]},
    }
    indexes = appmod.build_airspace_spatial_indexes(airspace)
    crossing = {"features":[{"geometry":{"type":"LineString","coordinates":[[-77.3,39.0,0],[-76.8,39.0,1000]]}}]}
    clear = {"features":[{"geometry":{"type":"LineString","coordinates":[[-78.0,39.5,0],[-77.8,39.5,1000]]}}]}
    a = appmod.score_prediction_against_airspace(crossing,indexes)
    b = appmod.score_prediction_against_airspace(clear,indexes)
    assert a["airspace_intrusion_m"] > 10_000
    assert a["clear_of_airspace"] is False
    assert "controlled" in a["conflict_layers"]
    assert b["airspace_intrusion_m"] == 0
    assert b["clear_of_airspace"] is True


def test_optimal_site_sort_uses_preference_and_never_distance():
    import app as appmod
    candidates = [
        {"site_id":"winchester","site_name":"Winchester","viable":True,"best_airspace_intrusion_m":0,"ascent_rate_adjustment_ms":0,"umd_distance_m":1},
        {"site_id":"clear","site_name":"Clear Spring","preferred":True,"viable":True,"best_airspace_intrusion_m":0,"ascent_rate_adjustment_ms":0,"umd_distance_m":999999},
        {"site_id":"conflict","site_name":"Conflict","viable":False,"best_airspace_intrusion_m":10,"ascent_rate_adjustment_ms":0,"umd_distance_m":0},
    ]
    candidates.sort(key=appmod.optimal_site_sort_key)
    assert [c["site_id"] for c in candidates] == ["clear","winchester","conflict"]
    # Distance is not part of the key: two equally viable non-preferred sites tie.
    a={"site_name":"A","viable":True,"ascent_rate_adjustment_ms":0,"umd_distance_m":1}
    b={"site_name":"B","viable":True,"ascent_rate_adjustment_ms":0,"umd_distance_m":999999}
    assert appmod.optimal_site_sort_key(a) == appmod.optimal_site_sort_key(b)


def test_optimal_site_endpoint_does_not_use_distance_tiebreak(monkeypatch):
    import asyncio
    import app as appmod
    appmod._OPTIMAL_RESULT_CACHE.clear()
    empty = {"type":"FeatureCollection","features":[]}
    controlled = {"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-80,40],[-79.9,40],[-79.9,40.1],[-80,40.1],[-80,40]]]}}]}
    async def fake_airspace(layer, force=False): return (controlled if layer=="controlled" else empty, None, "test")
    async def fake_run(req, meta=None):
        lon=req.launch.longitude;lat=req.launch.latitude
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,0],[lon+0.01,lat,1000]]},"properties":{"stage":"ascent"}}],"summary":{"landing":{"longitude":lon+0.01,"latitude":lat},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(
        launch_sites=[
            appmod.OptimalSiteCandidate(site_id="far",name="Far",latitude=39.7,longitude=-78.0),
            appmod.OptimalSiteCandidate(site_id="near",name="Near",latitude=39.05,longitude=-77.1),
        ], launch_datetime=datetime.now(timezone.utc), airspace_layers=["controlled"], ascent_rate_sweep_ms=[5.5],
    )
    result=asyncio.run(appmod.optimal_site(req))
    assert [x["site_id"] for x in result["ranking"]] == ["far","near"]
    assert result["optimal_site_id"] == "far"
    assert result["gold_site_id"] is None
    assert all(item["site_status"]=="viable" for item in result["ranking"])
    assert all("umd_distance_m" not in item for item in result["ranking"])


def test_ui_contract_has_optimal_site_and_sweep_clickability():
    from pathlib import Path
    base=Path(__file__).resolve().parents[1]
    html=(base/"static"/"index.html").read_text(encoding="utf-8")
    js=(base/"static"/"app.js").read_text(encoding="utf-8")
    assert 'id="findOptimalCurrent"' in html
    assert 'id="findOptimalAll"' in html
    assert 'id="optimalResult"' in html
    assert "findOptimalSite" in js
    assert "siteStatusLegend" in html
    assert "sweep-hitbox" in js
    assert "formatSweepParameter" in js
    assert "site-best" in (base/"static"/"styles.css").read_text(encoding="utf-8")



def test_launch_collection_deduplicates_duplicate_cities():
    import app as appmod
    a={"type":"FeatureCollection","features":[
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.94,39.66]},"properties":{"name":"Fairview","address":"12808 Draper Road, Clear Spring, MD 21722"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-78.73,39.65]},"properties":{"name":"Allegany","address":"12401 Willowbrook Rd, Cumberland, MD 21502"}},
    ]}
    b={"type":"FeatureCollection","features":[
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.941,39.661]},"properties":{"name":"Clear Spring fallback","city":"Clear Spring"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-78.731,39.651]},"properties":{"name":"Cumberland fallback","city":"Cumberland"}},
    ]}
    merged=appmod.merge_launch_collections(appmod.normalize_launch_locations(a),appmod.normalize_launch_locations(b))
    assert len(merged["features"])==2
    assert {appmod.launch_city(f) for f in merged["features"]}=={"Clear Spring","Cumberland"}


def test_default_optimal_sweep_is_current_then_small_adjustments():
    import app as appmod
    assert appmod.default_ascent_rate_sweep(5.5)==[5.5,5.0,6.0,4.5,6.5]


def test_high_risk_landing_detects_restricted_airspace():
    import app as appmod
    collections={
        "controlled":{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"LOCAL_TYPE":"R"},"geometry":{"type":"Polygon","coordinates":[[[-77.2,39.0],[-77.0,39.0],[-77.0,39.2],[-77.2,39.2],[-77.2,39.0]]]}}]},
        "sua":{"type":"FeatureCollection","features":[]},"tfr":{"type":"FeatureCollection","features":[]},"class_e":{"type":"FeatureCollection","features":[]},
    }
    idx=appmod._high_risk_airspace_index(collections)
    inside={"summary":{"landing":{"longitude":-77.1,"latitude":39.1}}}
    outside={"summary":{"landing":{"longitude":-78.0,"latitude":39.1}}}
    assert appmod.landing_in_high_risk_airspace(inside,idx) is True
    assert appmod.landing_in_high_risk_airspace(outside,idx) is False


def test_optimal_site_reserves_gold_for_clear_spring_or_hancock(monkeypatch):
    import asyncio
    import app as appmod
    appmod._OPTIMAL_RESULT_CACHE.clear()
    empty={"type":"FeatureCollection","features":[]}
    controlled={"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-80,40],[-79.9,40],[-79.9,40.1],[-80,40.1],[-80,40]]]}}]}
    async def fake_airspace(layer,force=False): return (controlled if layer=="controlled" else empty,None,"test")
    async def fake_run(req,meta=None):
        lon,lat=req.launch.longitude,req.launch.latitude
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,0],[lon+.01,lat,1000]]},"properties":{"stage":"ascent"}}],"summary":{"landing":{"longitude":lon+.01,"latitude":lat},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(launch_sites=[
        appmod.OptimalSiteCandidate(site_id="win",name="Winchester",latitude=39.02,longitude=-76.94),
        appmod.OptimalSiteCandidate(site_id="hancock",name="Hancock",latitude=39.69,longitude=-78.19,preferred=True),
        appmod.OptimalSiteCandidate(site_id="clear",name="Clear Spring",latitude=39.66,longitude=-77.94,preferred=True),
    ],launch_datetime=datetime.now(timezone.utc),airspace_layers=["controlled"],ascent_rate_sweep_ms=[5.5])
    result=asyncio.run(appmod.optimal_site(req))
    statuses={x["site_id"]:x["site_status"] for x in result["ranking"]}
    assert result["gold_site_id"] == "clear"
    assert statuses["clear"] == "best"
    assert statuses["hancock"] == "viable"
    assert statuses["win"] == "viable"
    assert "preferred" not in statuses.values()


def test_ui_has_two_optimal_buttons_three_status_colors_and_no_blue():
    from pathlib import Path
    base=Path(__file__).resolve().parents[1]
    html=(base/"static"/"index.html").read_text(encoding="utf-8")
    js=(base/"static"/"app.js").read_text(encoding="utf-8")
    css=(base/"static"/"styles.css").read_text(encoding="utf-8")
    assert 'id="findOptimalCurrent"' in html and 'id="findOptimalAll"' in html
    assert 'id="siteStatusLegend"' in html
    assert "selectedPresetSites(),...allCustomPointTargets()" in js
    assert "scope==='all'?[...state.launchLocations]" in js
    for status in ["site-best","site-viable","site-nogo"]: assert status in css
    assert "site-preferred" not in css
    assert "status-blue" not in css and "Blue —" not in html
    for color in ["Gold — preferred + viable (Clear Spring / Hancock)","Green — viable / clear at crossing altitude","Red — conflict at balloon altitude / landing no-go"]: assert color in html


def test_optimal_site_can_become_viable_with_ascent_rate_adjustment(monkeypatch):
    import asyncio
    import app as appmod
    controlled={"type":"FeatureCollection","features":[{"type":"Feature","properties":{"LOCAL_TYPE":"CLASS_B"},"geometry":{"type":"Polygon","coordinates":[[[-77.2,38.95],[-77.0,38.95],[-77.0,39.05],[-77.2,39.05],[-77.2,38.95]]]}}]}
    empty={"type":"FeatureCollection","features":[]}
    async def fake_airspace(layer,force=False): return (controlled if layer=="controlled" else empty,None,"test")
    async def fake_run(req,meta=None):
        # Current 5.5 m/s crosses the polygon. 5.0 m/s is shifted north and clears it.
        lat=39.0 if abs(req.ascent_rate_ms-5.5)<1e-9 else 39.2
        lon=-77.3
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,0],[-76.9,lat,1000]]},"properties":{"stage":"ascent"}}],"summary":{"landing":{"longitude":-76.9,"latitude":lat},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(
        launch_sites=[appmod.OptimalSiteCandidate(site_id="x",name="Test",latitude=39.0,longitude=-77.3)],
        launch_datetime=datetime.now(timezone.utc),airspace_layers=["controlled"],ascent_rate_ms=5.5,ascent_rate_sweep_ms=[5.5,5.0],
    )
    result=asyncio.run(appmod.optimal_site(req));site=result["ranking"][0]
    assert site["viable"] is True
    assert site["best_ascent_rate_ms"] == 5.0
    assert site["site_status"] == "viable"
    assert result["gold_site_id"] is None
    assert site["tested_ascent_rates_ms"] == [5.0,5.5] or set(site["tested_ascent_rates_ms"]) == {5.0,5.5}



def test_v29_altitude_aware_airspace_does_not_flag_path_above_class_d():
    import app as appmod
    airspace={"controlled":{"type":"FeatureCollection","features":[{
        "type":"Feature","properties":{"LOWER_VAL":0,"UPPER_VAL":3000,"LOWER_UOM":"FT","UPPER_UOM":"FT"},
        "geometry":{"type":"Polygon","coordinates":[[[-77.2,38.9],[-76.9,38.9],[-76.9,39.1],[-77.2,39.1],[-77.2,38.9]]]}
    }]}}
    idx=appmod.build_airspace_spatial_indexes(airspace)
    high={"features":[{"geometry":{"type":"LineString","coordinates":[[-77.3,39.0,5000],[-76.8,39.0,5000]]}}]}
    low={"features":[{"geometry":{"type":"LineString","coordinates":[[-77.3,39.0,300],[-76.8,39.0,300]]}}]}
    assert appmod.score_prediction_against_airspace(high,idx)["clear_of_airspace"] is True
    assert appmod.score_prediction_against_airspace(low,idx)["airspace_intrusion_m"] > 10000


def test_v29_distance_cannot_make_winchester_gold():
    import app as appmod
    candidates=[
        {"site_id":"win","site_name":"Winchester","viable":True,"best_airspace_intrusion_m":0,"ascent_rate_adjustment_ms":0.0,"umd_distance_m":1},
        {"site_id":"hancock","site_name":"Hancock","preferred":True,"viable":True,"best_airspace_intrusion_m":0,"ascent_rate_adjustment_ms":0.0,"umd_distance_m":999999},
    ]
    candidates.sort(key=appmod.optimal_site_sort_key)
    assert candidates[0]["site_id"] == "hancock"


def test_v29_optimal_ui_has_speed_toggle_solid_status_and_restored_bottom_toolbar():
    from pathlib import Path
    base=Path(__file__).resolve().parents[1]
    html=(base/"static"/"index.html").read_text(encoding="utf-8")
    js=(base/"static"/"app.js").read_text(encoding="utf-8")
    css=(base/"static"/"styles.css").read_text(encoding="utf-8")
    assert 'id="optimalAscentSweep"' in html
    assert 'id="optimalSweepModeLabel"' in html
    assert "if(!$('optimalAscentSweep')?.checked)return [current]" in js
    assert "airspace_layers:optimalAirspaceLayers()" in js
    assert "const layers=['controlled','sua','tfr']" in js
    for control in ["zoomPredicts","downloadKml","downloadGeofence","openSweep","queryAddresses","aboutMap"]:
        assert f'id="{control}"' in html
    assert ".bottom-tools{display:flex!important;visibility:visible!important" in css
    assert ".predict-site.site-viable{background:#1f9d55!important" in css
    assert ".predict-site.site-nogo{background:#b92332!important" in css
    assert ".site-status-legend{left:390px" in css


def test_v29_current_rate_only_evaluates_one_scenario_per_site(monkeypatch):
    import asyncio
    import app as appmod
    appmod._OPTIMAL_RESULT_CACHE.clear()
    empty={"type":"FeatureCollection","features":[]}
    controlled={"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-80,40],[-79.9,40],[-79.9,40.1],[-80,40.1],[-80,40]]]}}]}
    async def fake_airspace(layer,force=False): return (controlled if layer=="controlled" else empty,None,"test")
    calls=[]
    async def fake_run(req,meta=None):
        calls.append((req.launch.name,req.ascent_rate_ms))
        lon=req.launch.longitude;lat=req.launch.latitude
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,0],[lon+.01,lat,1000]]},"properties":{"stage":"ascent"}}],"summary":{"landing":{"longitude":lon+.01,"latitude":lat},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(
        launch_sites=[appmod.OptimalSiteCandidate(site_id="a",name="A",latitude=39,longitude=-77),appmod.OptimalSiteCandidate(site_id="b",name="B",latitude=39.1,longitude=-77.1)],
        launch_datetime=datetime.now(timezone.utc),airspace_layers=["controlled"],ascent_rate_ms=5.5,ascent_rate_sweep_ms=[5.5],
    )
    result=asyncio.run(appmod.optimal_site(req))
    assert len(calls)==2
    assert result["ascent_rate_sweep_ms"] == [5.5]


def test_v29_deduplicates_every_preset_city():
    import app as appmod
    a={"type":"FeatureCollection","features":[
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.0,39.0]},"properties":{"city":"Example City","name":"Site A"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.1,39.1]},"properties":{"city":"Example City","name":"Site B"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.94,39.66]},"properties":{"city":"Clear Spring","name":"Operational"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-77.95,39.67]},"properties":{"city":"Clear Spring","name":"Fallback"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-78.19,39.69]},"properties":{"city":"Hancock","name":"A"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-78.20,39.70]},"properties":{"city":"Hancock","name":"B"}},
    ]}
    merged=appmod.merge_launch_collections(a)
    cities=[appmod.launch_city(f) for f in merged["features"]]
    assert cities.count("Example City") == 1
    assert cities.count("Clear Spring") == 1
    assert cities.count("Hancock") == 1


def test_v29_identical_optimal_request_uses_short_cache(monkeypatch):
    import asyncio
    import app as appmod
    appmod._OPTIMAL_RESULT_CACHE.clear()
    controlled={"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[-80,40],[-79.9,40],[-79.9,40.1],[-80,40.1],[-80,40]]]}}]}
    async def fake_airspace(layer,force=False): return controlled,None,"test"
    calls=[]
    async def fake_run(req,meta=None):
        calls.append(req.launch.name)
        lon=req.launch.longitude;lat=req.launch.latitude
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[lon,lat,0],[lon+.01,lat,1000]]},"properties":{"stage":"ascent"}}],"summary":{"landing":{"longitude":lon+.01,"latitude":lat},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(launch_sites=[appmod.OptimalSiteCandidate(site_id="a",name="A",latitude=39,longitude=-77)],launch_datetime=datetime.now(timezone.utc),airspace_layers=["controlled"],ascent_rate_sweep_ms=[5.5])
    first=asyncio.run(appmod.optimal_site(req));second=asyncio.run(appmod.optimal_site(req))
    assert first["cache_hit"] is False and second["cache_hit"] is True
    assert len(calls)==1


def test_v29_crossing_altitude_uses_airspace_ceiling_not_2d_footprint():
    import app as appmod
    airspace={"controlled":{"type":"FeatureCollection","features":[{
        "type":"Feature","properties":{"LOWER_VAL":0,"UPPER_VAL":10000,"LOWER_UOM":"FT","UPPER_UOM":"FT","LOCAL_TYPE":"CLASS_D"},
        "geometry":{"type":"Polygon","coordinates":[[[-77.2,38.9],[-77.0,38.9],[-77.0,39.1],[-77.2,39.1],[-77.2,38.9]]]}
    }]}}
    idx=appmod.build_airspace_spatial_indexes(airspace)
    # The line crosses the polygon horizontally at ~20,000 ft MSL: clear overflight.
    above={"features":[{"geometry":{"type":"LineString","coordinates":[[-77.3,39.0,6100],[-76.9,39.0,6100]]}}]}
    # Same 2-D crossing at ~5,000 ft MSL: conflict.
    inside={"features":[{"geometry":{"type":"LineString","coordinates":[[-77.3,39.0,1524],[-76.9,39.0,1524]]}}]}
    assert appmod.score_prediction_against_airspace(above,idx)["clear_of_airspace"] is True
    assert appmod.score_prediction_against_airspace(inside,idx)["clear_of_airspace"] is False


def test_v29_nonviable_preferred_site_is_red_and_no_blue(monkeypatch):
    import asyncio
    import app as appmod
    appmod._OPTIMAL_RESULT_CACHE.clear()
    controlled={"type":"FeatureCollection","features":[{"type":"Feature","properties":{"LOWER_VAL":0,"UPPER_VAL":10000,"LOWER_UOM":"FT","UPPER_UOM":"FT","LOCAL_TYPE":"CLASS_D"},"geometry":{"type":"Polygon","coordinates":[[[-78.3,39.5],[-77.8,39.5],[-77.8,39.9],[-78.3,39.9],[-78.3,39.5]]]}}]}
    async def fake_airspace(layer,force=False): return controlled,None,"test"
    async def fake_run(req,meta=None):
        if req.launch.name=="Hancock":
            return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-78.25,39.7,100],[-77.9,39.7,100]]}}],"summary":{"landing":{"longitude":-77.9,"latitude":39.7},"ground_distance_m":1000}}
        return {"features":[{"type":"Feature","geometry":{"type":"LineString","coordinates":[[-77.5,39.2,5000],[-77.4,39.2,5000]]}}],"summary":{"landing":{"longitude":-77.4,"latitude":39.2},"ground_distance_m":1000}}
    monkeypatch.setattr(appmod,"operational_airspace",fake_airspace);monkeypatch.setattr(appmod,"run_burst",fake_run)
    req=appmod.OptimalSiteRequest(launch_sites=[
        appmod.OptimalSiteCandidate(site_id="h",name="Hancock",latitude=39.7,longitude=-78.2,preferred=True),
        appmod.OptimalSiteCandidate(site_id="w",name="Winchester",latitude=39.2,longitude=-77.5),
    ],launch_datetime=datetime.now(timezone.utc),airspace_layers=["controlled"],ascent_rate_sweep_ms=[5.5])
    result=asyncio.run(appmod.optimal_site(req))
    byid={x["site_id"]:x for x in result["ranking"]}
    assert byid["h"]["site_status"] == "no-go"
    assert byid["w"]["site_status"] == "viable"
    assert result["gold_site_id"] is None


# v3.0 historical replay, weather, theme, and 3-D geofence regression tests

def test_v30_launch_window_allows_historical_dates_and_keeps_future_guard():
    import app as appmod
    from fastapi import HTTPException
    # Deep historical replay is now intentionally accepted instead of the old 8-hour cutoff.
    appmod.validate_launch_window(datetime(1950, 6, 1, 12, 0, tzinfo=timezone.utc))
    with pytest.raises(HTTPException, match="1948"):
        appmod.validate_launch_window(datetime(1947, 12, 31, 23, 0, tzinfo=timezone.utc))
    with pytest.raises(HTTPException, match="7 days"):
        appmod.validate_launch_window(datetime.now(timezone.utc) + appmod.timedelta(days=8))


def test_v30_historical_tawhiri_requests_archived_dataset(monkeypatch):
    import asyncio
    import app as appmod
    seen=[]
    async def fake(params):
        seen.append(dict(params))
        return {"request":{"dataset":params.get("dataset")},"prediction":[{"stage":"ascent","trajectory":[]}]}
    monkeypatch.setattr(appmod,"tawhiri_request",fake)
    launch=datetime(2020,5,4,13,27,tzinfo=timezone.utc)
    result,historical=asyncio.run(appmod.tawhiri_for_launch({"profile":"standard_profile"},launch))
    assert historical is True
    assert seen[0]["dataset"].startswith("2020-05-04T12:00:00")
    assert result["request"]["dataset"] == seen[0]["dataset"]


def test_v30_ncss_csv_parser_and_wind_interpolation():
    import app as appmod
    text=("time,latitude,longitude,level,uwnd\n"
          "2020-01-01T00:00:00Z,39,-77,1000,2\n"
          "2020-01-01T00:00:00Z,39,-77,500,10\n"
          "2020-01-01T06:00:00Z,39,-77,1000,4\n"
          "2020-01-01T06:00:00Z,39,-77,500,14\n")
    profiles=appmod._parse_ncss_csv(text,"uwnd")
    assert len(profiles)==2
    t=datetime(2020,1,1,3,0,tzinfo=timezone.utc)
    # 1000 hPa is mapped to ~110 m. Halfway in time gives 3 m/s.
    assert appmod._wind_at(profiles,t,110)==pytest.approx(3.0)
    # At the 500 hPa mapped height, halfway in time gives 12 m/s.
    assert appmod._wind_at(profiles,t,5570)==pytest.approx(12.0)


def test_v30_historical_reanalysis_builds_burst_trajectory(monkeypatch):
    import asyncio
    import app as appmod
    # Constant eastward wind profile at all supported pressure levels/times.
    times=[datetime(2020,1,1,h,tzinfo=timezone.utc) for h in (0,6,12,18)]
    u={t:{level:10.0 for level in appmod.NCEP_PRESSURE_HEIGHT_M} for t in times}
    v={t:{level:0.0 for level in appmod.NCEP_PRESSURE_HEIGHT_M} for t in times}
    async def fake_fetch(variable,*_args,**_kwargs): return u if variable=='uwnd' else v
    monkeypatch.setattr(appmod,'_fetch_ncep_variable',fake_fetch)
    req=appmod.PredictRequest(
        mode='burst',launch=appmod.LaunchPoint(name='Replay',latitude=39.0,longitude=-77.0,altitude_m=100),
        launch_datetime=datetime(2020,1,1,6,0,tzinfo=timezone.utc),ascent_rate_ms=5.5,descent_rate_ms=9,
        burst_altitude_m=1000,
    )
    r=asyncio.run(appmod.run_historical_reanalysis(req))
    assert r['summary']['historical'] is True
    assert 'NCEP/NCAR' in r['summary']['historical_source']
    assert [f['properties']['stage'] for f in r['features']] == ['ascent','descent']
    assert r['summary']['landing']['longitude'] > -77.0


def test_v30_sfRA_standard_pressure_180000_normalizes_to_fl180():
    import app as appmod
    meters=appmod._parse_altitude_value_m(180000,'FT','STD',upper=True)
    assert meters == pytest.approx(18000*0.3048,rel=1e-12)
    data=appmod.annotate_airspace_verticals({"type":"FeatureCollection","features":[{
        "type":"Feature","geometry":{"type":"Polygon","coordinates":[]},"properties":{
            "NAME":"WASHINGTON, DC METROPOLITAN AREA SPECIAL FLIGHT RULES AREA",
            "UPPER_VAL":180000,"UPPER_UOM":"FT","UPPER_CODE":"STD","LOWER_VAL":0,"LOWER_CODE":"SFC"
        }}]},'controlled')
    assert data['features'][0]['properties']['bpp_upper_m'] == pytest.approx(5486.4)


def test_v30_weather_archive_parses_wind_gust_rain(monkeypatch):
    import asyncio
    import app as appmod
    appmod._weather_cache.clear()
    payload={
        'latitude':39.0,'longitude':-77.0,
        'hourly':{
            'time':['2020-01-01T11:00','2020-01-01T12:00','2020-01-01T13:00'],
            'temperature_2m':[40,41,42],'precipitation':[0,0.02,0], 'rain':[0,0.02,0],
            'weather_code':[0,61,0],'wind_speed_10m':[5,8,6],'wind_direction_10m':[270,280,290],
            'wind_gusts_10m':[10,17,12],'surface_pressure':[1010,1009,1008],
        }
    }
    class Resp:
        def raise_for_status(self): pass
        def json(self): return payload
    class Client:
        def __init__(self,*a,**k): pass
        async def __aenter__(self): return self
        async def __aexit__(self,*a): pass
        async def get(self,*a,**k): return Resp()
    monkeypatch.setattr(appmod.httpx,'AsyncClient',Client)
    r=asyncio.run(appmod.fetch_launch_weather(39,-77,datetime(2020,1,1,12,0,tzinfo=timezone.utc)))
    assert r['source'] == 'Open-Meteo Historical Weather'
    assert r['wind_speed_mph'] == 8
    assert r['wind_gust_mph'] == 17
    assert r['rain'] is True
    assert r['rain_in'] == pytest.approx(.02)


def test_v32_frontend_uses_minimal_stable_controls():
    from pathlib import Path
    base=Path(__file__).resolve().parents[1]
    html=(base/'static'/'index.html').read_text(encoding='utf-8')
    js=(base/'static'/'app.js').read_text(encoding='utf-8')
    css=(base/'static'/'styles.css').read_text(encoding='utf-8')
    for item in ['launchThemeSelect','weatherMapLegend','drawingUpperAltitude','saveDrawingAltitude','infoTab','infoView','sweepPanel']:
        assert f'id="{item}"' in html
    assert 'launchThemeButton' not in html and 'launchThemeDialog' not in html
    assert 'modalBackdrop' not in html and '<dialog' not in html.lower()
    assert 'name="mapmode" value="weather"' in html
    assert "setMapMode" in js and "refreshWeatherMap" in js
    assert "upper_altitude_m:3048" in js
    assert "fill-extrusion-height" in js and "upper_altitude_m" in js
    assert "applyLaunchTheme" in js and "restoreLaunchTheme" in js
    assert "openModal(" not in js and "showModal(" not in js
    assert "--launch-primary" in css


def test_v30_build_contract_and_docs():
    import asyncio
    import app as appmod
    from pathlib import Path
    h=asyncio.run(appmod.health());c=asyncio.run(appmod.config())
    assert h['version']=='3.2.0'
    assert c['historical_predicts_from']=='1948-01-01'
    assert c['weather'] is True
    base=Path(__file__).resolve().parents[2]
    assert '3.2.0' in (base.parent/'VERSION.txt').read_text(encoding='utf-8')


def test_v32_no_prompt_modal_or_history_hint():
    base=Path(__file__).resolve().parents[1]
    html=(base/'static'/'index.html').read_text(encoding='utf-8')
    js=(base/'static'/'app.js').read_text(encoding='utf-8')
    assert '<dialog' not in html.lower()
    assert 'historical-hint' not in html
    assert 'data-app-view="info"' in html
    for token in ['openModal(', 'closeModal(', 'showModal(', 'prompt(', 'alert(', 'confirm(']:
        assert token not in js
    assert "setAppView('info')" in js
    assert "launchThemeSelect" in js and "sweepPanel" in js
