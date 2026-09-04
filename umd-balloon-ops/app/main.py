from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT, settings
from .database import Database
from .events import EventHub
from .geo.airspace import AirspaceService
from .geo.recovery import RecoveryService
from .mathutils import bearing_deg, haversine_m, linear_slope
from .models import APRSWatchRequest, BatchPredictionRequest, EnsemblePredictionRequest, FlightState, IridiumWebhook, PredictProfile, PredictionRequest, SimulationRequest, SpotWatchRequest, TelemetryPoint, WatchRequest
from .prediction.manager import PredictionManager
from .telemetry.engine import FlightEngine
from .telemetry.simulator import Simulator
from .telemetry.sondehub import SondeHubWatcher
from .telemetry.spot import SpotWatcher
from .telemetry.aprs import APRSISWatcher

app = FastAPI(title=settings.app_name, version="1.0.0")
app.mount("/static", StaticFiles(directory=ROOT / "app" / "static"), name="static")

db = Database(settings.database_path)
events = EventHub()
engine = FlightEngine()
predictions = PredictionManager()
airspace = AirspaceService()
recovery = RecoveryService()

_last_auto_prediction: dict[str, tuple[datetime, float, FlightState]] = {}
_auto_prediction_tasks: dict[str, asyncio.Task] = {}


async def _run_auto_prediction(callsign: str, req: PredictionRequest):
    try:
        result = await predictions.predict(req)
        db.insert_prediction(result, callsign)
        await events.publish("prediction", {"callsign": callsign, "prediction": result.model_dump(mode="json")})
    except Exception as exc:
        await events.publish("warning", {"callsign": callsign, "message": f"Auto prediction failed: {exc}"})
    finally:
        current = _auto_prediction_tasks.get(callsign)
        if current is asyncio.current_task():
            _auto_prediction_tasks.pop(callsign, None)


async def ingest(point: TelemetryPoint):
    # Flight-data ingestion is deliberately non-blocking with respect to prediction/network work.
    # The packet is recorded, fused and broadcast first; prediction happens independently.
    db.insert_telemetry(point)
    snapshot = engine.ingest(point)
    await events.publish("telemetry", snapshot.model_dump(mode="json"))

    prev = _last_auto_prediction.get(point.callsign)
    should = prev is None
    if prev:
        last_time, last_alt, last_state = prev
        should = (
            (point.timestamp - last_time).total_seconds() >= settings.auto_predict_min_seconds
            or abs(point.altitude_m - last_alt) >= settings.auto_predict_min_altitude_delta_m
            or snapshot.state != last_state
        )
    if should and snapshot.state not in (FlightState.LANDED, FlightState.PRELAUNCH):
        # Do not queue a pile of stale predicts if telemetry outruns the predictor. The next fix will
        # trigger once the current job finishes if the thresholds are still exceeded.
        existing = _auto_prediction_tasks.get(point.callsign)
        if existing is None or existing.done():
            _last_auto_prediction[point.callsign] = (point.timestamp, point.altitude_m, snapshot.state)
            req = PredictionRequest(
                profile=PredictProfile.STANDARD,
                launch_latitude=point.latitude, launch_longitude=point.longitude,
                launch_altitude_m=max(0, point.altitude_m), launch_datetime=point.timestamp,
                ascent_rate_mps=max(0.2, snapshot.smoothed_vertical_rate_mps or point.vertical_rate_mps or 5.5),
                burst_altitude_m=max(point.altitude_m + 500, 28000),
                descent_rate_mps=5.5,
                current_vertical_rate_mps=snapshot.smoothed_vertical_rate_mps,
                fallback_wind_speed_mps=snapshot.calculated_ground_speed_mps or point.ground_speed_mps or 12,
                fallback_wind_bearing_deg=snapshot.calculated_heading_deg or point.heading_deg or 70,
            )
            if (snapshot.smoothed_vertical_rate_mps or 0) < -1:
                req.burst_altitude_m = point.altitude_m + 100
            _auto_prediction_tasks[point.callsign] = asyncio.create_task(_run_auto_prediction(point.callsign, req))
    return snapshot


watcher = SondeHubWatcher(ingest)
simulator = Simulator(ingest)
spot_watcher = SpotWatcher(ingest)
aprs_watcher = APRSISWatcher(ingest)


@app.get("/")
async def root():
    return FileResponse(ROOT / "app" / "static" / "index.html")


@app.get("/api/health")
async def health():
    return {
        "status": "ok", "app": settings.app_name,
        "tawhiri_url": settings.tawhiri_url,
        "providers": ["tawhiri", "local-gfs", "offline-vector"],
        "local_gfs": {"ready": predictions.local_gfs.readiness()[0], "detail": predictions.local_gfs.readiness()[1]},
        "watched_callsigns": list(watcher.tasks),
        "simulations": list(simulator.tasks),
        "spot_watches": list(spot_watcher.tasks),
        "aprs_watches": [k for k,v in aprs_watcher.running.items() if v],
        "offline_tiles": bool(settings.offline_tiles_path and settings.offline_tiles_path.exists()),
    }


@app.post("/api/predict")
async def predict(req: PredictionRequest):
    return await predictions.predict(req)


@app.post("/api/predict/batch")
async def predict_batch(req: BatchPredictionRequest):
    return await predictions.batch(req)


@app.post("/api/predict/ensemble")
async def predict_ensemble(req: EnsemblePredictionRequest):
    return await predictions.ensemble(req)


@app.post("/api/telemetry/ingest")
async def telemetry_ingest(point: TelemetryPoint):
    return await ingest(point)


@app.get("/api/telemetry/{callsign}/history")
async def telemetry_history(callsign: str, limit: int = Query(1000, ge=1, le=10000)):
    live = engine.history(callsign)
    rows = live if live else db.history(callsign, limit)
    return [p.model_dump(mode="json") for p in rows[-limit:]]


@app.get("/api/telemetry/{callsign}/snapshot")
async def telemetry_snapshot(callsign: str):
    if not engine.history(callsign):
        historic = db.history(callsign, 50)
        for p in historic:
            engine.ingest(p)
    if not engine.history(callsign):
        raise HTTPException(404, "No telemetry for callsign")
    return engine.snapshot(callsign)


@app.get("/api/callsigns")
async def callsigns():
    return sorted(set(db.callsigns()) | set(engine.points.keys()) | set(watcher.tasks.keys()) | set(simulator.tasks.keys()))


@app.post("/api/watch")
async def watch(req: WatchRequest):
    if req.enabled:
        watcher.start(req.callsign)
    else:
        watcher.stop(req.callsign)
    return {"callsign": req.callsign, "enabled": req.enabled, "source": req.source}


@app.post("/api/watch/spot")
async def watch_spot(req: SpotWatchRequest):
    if req.enabled: spot_watcher.start(req.callsign, req.feed_id, req.feed_password, req.interval_s)
    else: spot_watcher.stop(req.callsign)
    return {"callsign":req.callsign,"enabled":req.enabled,"source":"spot"}


@app.post("/api/watch/aprs")
async def watch_aprs(req: APRSWatchRequest):
    if req.enabled: aprs_watcher.start(req.payload_callsign, req.login_callsign, req.passcode, req.host, req.port)
    else: aprs_watcher.stop(req.payload_callsign)
    return {"callsign":req.payload_callsign,"enabled":req.enabled,"source":"aprs-is"}


@app.post("/api/webhook/iridium")
async def iridium_webhook(req: IridiumWebhook):
    p=TelemetryPoint(callsign=req.callsign,timestamp=req.timestamp,latitude=req.latitude,longitude=req.longitude,altitude_m=req.altitude_m,battery_v=req.battery_v,source="iridium",receiver=req.source_id,raw=req.extra)
    return await ingest(p)


@app.post("/api/simulate/start")
async def simulate_start(req: SimulationRequest):
    simulator.start(req)
    return {"status": "started", "callsign": req.callsign}


@app.post("/api/simulate/stop/{callsign}")
async def simulate_stop(callsign: str):
    simulator.stop(callsign)
    return {"status": "stopped", "callsign": callsign}


@app.post("/api/replay/{callsign}")
async def replay(callsign: str, speed: float = Query(20, ge=0.1, le=500)):
    rows = db.history(callsign, 10000)
    if len(rows) < 2:
        raise HTTPException(404, "Need at least two stored telemetry points")

    async def task():
        for a, b in zip(rows, rows[1:]):
            replayed = b.model_copy(deep=True)
            replayed.source = "replay"
            replayed.received_at = datetime.now(timezone.utc)
            await ingest(replayed)
            delay = max(0, (b.timestamp - a.timestamp).total_seconds() / speed)
            await asyncio.sleep(min(delay, 5))
    asyncio.create_task(task())
    return {"status": "started", "points": len(rows), "speed": speed}


@app.get("/api/airspace")
async def get_airspace(bbox: str, layer: str = Query("class", pattern="^(class|sua)$")):
    return await airspace.get(bbox, layer)


@app.get("/api/geofences")
async def get_geofences():
    path = ROOT / "data" / "geofences.geojson"
    if not path.exists():
        return {"type":"FeatureCollection","features":[]}
    import json
    try:
        return json.loads(path.read_text())
    except Exception as exc:
        raise HTTPException(500, f"Invalid data/geofences.geojson: {exc}")


@app.get("/api/recovery")
async def recovery_analysis(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    return await recovery.analyze(lat, lon)


@app.get("/api/benchmark/{callsign}")
async def benchmark_flight(callsign: str, provider: str = Query("offline", pattern="^(auto|tawhiri|local_gfs|offline)$"), max_samples: int = Query(10, ge=3, le=30)):
    rows = db.history(callsign, 10000)
    if len(rows) < 5:
        raise HTTPException(404, "Need at least five stored telemetry points")
    actual = rows[-1]
    # Evenly sample the recorded flight before the final fix. If the final fix is not actually
    # landed, the response says so and treats it only as the current endpoint reference.
    landed_reference = actual.altitude_m < 500
    usable = list(range(1, len(rows)-1))
    if len(usable) > max_samples:
        usable = [usable[round(i*(len(usable)-1)/(max_samples-1))] for i in range(max_samples)]

    async def one(idx: int):
        p = rows[idx]
        window = rows[max(0, idx-6):idx+1]
        vr = linear_slope([(x.timestamp, x.altitude_m) for x in window])
        gs = None; hdg = None
        if len(window) >= 2:
            a,b = window[-2],window[-1]; dt=max(.001,(b.timestamp-a.timestamp).total_seconds())
            gs = haversine_m(a.latitude,a.longitude,b.latitude,b.longitude)/dt
            hdg = bearing_deg(a.latitude,a.longitude,b.latitude,b.longitude)
        req = PredictionRequest(
            provider=provider, profile=PredictProfile.STANDARD, launch_latitude=p.latitude, launch_longitude=p.longitude,
            launch_altitude_m=max(0,p.altitude_m), launch_datetime=p.timestamp, ascent_rate_mps=max(.2, vr or p.vertical_rate_mps or 5.5),
            burst_altitude_m=max(p.altitude_m+100,28000), descent_rate_mps=5.5, current_vertical_rate_mps=vr,
            fallback_wind_speed_mps=gs or p.ground_speed_mps or 12, fallback_wind_bearing_deg=hdg or p.heading_deg or 70)
        result = await predictions.predict(req)
        if not result.landing:
            return {"timestamp":p.timestamp.isoformat(),"time_to_reference_s":(actual.timestamp-p.timestamp).total_seconds(),"error_m":None,"provider":result.provider}
        return {"timestamp":p.timestamp.isoformat(),"time_to_reference_s":(actual.timestamp-p.timestamp).total_seconds(),
                "error_m":haversine_m(result.landing.latitude,result.landing.longitude,actual.latitude,actual.longitude),
                "provider":result.provider,"predicted_landing":[result.landing.latitude,result.landing.longitude]}

    samples = await asyncio.gather(*(one(i) for i in usable))
    errors = sorted(x["error_m"] for x in samples if x["error_m"] is not None)
    return {"callsign":callsign,"reference":{"latitude":actual.latitude,"longitude":actual.longitude,"timestamp":actual.timestamp.isoformat(),"landed_likely":landed_reference},
            "samples":samples,"median_error_m":errors[len(errors)//2] if errors else None,"best_error_m":min(errors) if errors else None,
            "note":"Errors are against the final recorded point; treat as true landing accuracy only when landed_likely is true."}


@app.get("/offline-tiles/{z}/{x}/{y}.png")
async def offline_tile(z: int, x: int, y: int):
    root = settings.offline_tiles_path
    if root is None or not root.exists():
        raise HTTPException(404, "Offline tiles are not configured")
    candidate = (root / str(z) / str(x) / f"{y}.png").resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise HTTPException(400, "Invalid tile path")
    if not candidate.is_file():
        raise HTTPException(404, "Tile not available")
    return FileResponse(candidate, media_type="image/png")


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await events.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await events.disconnect(ws)
    except Exception:
        await events.disconnect(ws)
