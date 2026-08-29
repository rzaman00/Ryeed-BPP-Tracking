from datetime import datetime, timezone

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
            "geometry": None,
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
