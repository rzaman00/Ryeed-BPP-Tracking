"""Quick no-network validation of the installed application core."""
from datetime import datetime, timezone
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from app.main import app

base = {
    "profile":"standard","provider":"offline","launch_latitude":39.0046,"launch_longitude":-76.8755,
    "launch_altitude_m":25,"launch_datetime":datetime.now(timezone.utc).isoformat(),"ascent_rate_mps":5.5,
    "burst_altitude_m":28000,"descent_rate_mps":5.5,"float_altitude_m":22000,"float_duration_min":60,
    "float_ascent_rate_mps":0.5,"fallback_wind_speed_mps":12,"fallback_wind_bearing_deg":70,
}
with TestClient(app) as c:
    health=c.get('/api/health'); health.raise_for_status()
    pred=c.post('/api/predict',json=base); pred.raise_for_status()
    ens=c.post('/api/predict/ensemble',json={"base":base,"members":5}); ens.raise_for_status()
    p=pred.json(); e=ens.json()
    assert p['landing'] and len(p['points']) > 10 and len(e['members']) == 5
    print('PASS')
    print('providers:', ', '.join(health.json()['providers']))
    print('offline landing:', round(p['landing']['latitude'],5), round(p['landing']['longitude'],5))
    print('ensemble P90 spread (m):', round(e['spread']['p90_radius_m']))
