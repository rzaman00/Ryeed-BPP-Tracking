from datetime import datetime, timedelta, timezone
import asyncio

from fastapi.testclient import TestClient

from app.main import app
from app.models import PredictionRequest, PredictProvider, TelemetryPoint
from app.prediction.offline import OfflinePredictor
from app.telemetry.engine import FlightEngine


def test_health():
    with TestClient(app) as client:
        r = client.get('/api/health')
        assert r.status_code == 200
        assert 'offline-vector' in r.json()['providers']


def test_offline_standard_prediction_lands():
    req = PredictionRequest(
        provider=PredictProvider.OFFLINE,
        launch_latitude=39.0, launch_longitude=-77.0, launch_altitude_m=100,
        ascent_rate_mps=5.5, burst_altitude_m=28000, descent_rate_mps=5.5,
    )
    result = asyncio.run(OfflinePredictor().predict(req))
    assert result.landing is not None
    assert result.points[0].stage == 'ascent'
    assert result.points[-1].stage == 'descent'
    assert result.points[-1].altitude_m == 0


def test_flight_engine_detects_ascent():
    e = FlightEngine(); t=datetime.now(timezone.utc)
    snap=None
    for i in range(8):
        snap=e.ingest(TelemetryPoint(callsign='TEST',timestamp=t+timedelta(seconds=i*10),latitude=39,longitude=-77,altitude_m=100+i*55,source='test'))
    assert snap.state.value == 'ASCENT'
    assert snap.smoothed_vertical_rate_mps > 5


def test_predict_api_offline():
    with TestClient(app) as client:
        r=client.post('/api/predict',json={
            'profile':'standard','provider':'offline','launch_latitude':39.0,'launch_longitude':-77.0,
            'launch_altitude_m':100,'launch_datetime':datetime.now(timezone.utc).isoformat(),
            'ascent_rate_mps':5.5,'burst_altitude_m':28000,'descent_rate_mps':5.5,
            'float_altitude_m':22000,'float_duration_min':60,'float_ascent_rate_mps':0.5,
            'fallback_wind_speed_mps':12,'fallback_wind_bearing_deg':70
        })
        assert r.status_code == 200
        body=r.json(); assert body['provider']=='offline-vector'; assert body['landing']


def test_ensemble_api_offline():
    with TestClient(app) as client:
        base={
            'profile':'standard','provider':'offline','launch_latitude':39.0,'launch_longitude':-77.0,
            'launch_altitude_m':100,'launch_datetime':datetime.now(timezone.utc).isoformat(),
            'ascent_rate_mps':5.5,'burst_altitude_m':28000,'descent_rate_mps':5.5,
            'float_altitude_m':22000,'float_duration_min':60,'float_ascent_rate_mps':0.5,
            'fallback_wind_speed_mps':12,'fallback_wind_bearing_deg':70
        }
        r=client.post('/api/predict/ensemble',json={'base':base,'members':5})
        assert r.status_code == 200
        body=r.json(); assert len(body['members'])==5; assert body['central']['landing']; assert body['spread']['p90_radius_m'] >= 0

def test_offline_descent_does_not_reascend():
    req = PredictionRequest(provider=PredictProvider.OFFLINE,launch_latitude=39,launch_longitude=-77,launch_altitude_m=12000,
        ascent_rate_mps=5.5,burst_altitude_m=12100,descent_rate_mps=6,current_vertical_rate_mps=-8)
    result=asyncio.run(OfflinePredictor().predict(req))
    assert result.points[0].stage == 'descent'
    assert all(p.stage == 'descent' for p in result.points)


def test_offline_float_and_experimental_profiles():
    base=dict(provider=PredictProvider.OFFLINE,launch_latitude=39,launch_longitude=-77,launch_altitude_m=100,
              ascent_rate_mps=5.5,burst_altitude_m=28000,descent_rate_mps=5.5,float_altitude_m=22000,float_duration_min=10)
    from app.models import PredictProfile
    fl=asyncio.run(OfflinePredictor().predict(PredictionRequest(profile=PredictProfile.FLOAT,**base)))
    ex=asyncio.run(OfflinePredictor().predict(PredictionRequest(profile=PredictProfile.EXPERIMENTAL_FLOAT,**base)))
    assert fl.landing is None and any(p.stage=='float' for p in fl.points)
    assert ex.landing is not None and any(p.stage=='float' for p in ex.points) and ex.points[-1].stage=='descent'

def test_source_fusion_prefers_high_quality_and_flags_disagreement():
    e=FlightEngine(); t=datetime.now(timezone.utc)
    e.ingest(TelemetryPoint(callsign='FUSE',timestamp=t,latitude=39,longitude=-77,altitude_m=1000,source='spot'))
    snap=e.ingest(TelemetryPoint(callsign='FUSE',timestamp=t,latitude=39.03,longitude=-77,altitude_m=1000,source='aprs-is'))
    assert snap.point.source == 'aprs-is'
    assert any('disagreement' in a.lower() for a in snap.alerts)
