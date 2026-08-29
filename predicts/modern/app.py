from __future__ import annotations

import asyncio
import json
import math
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
LEGACY_DATA = ROOT.parent / "BalloonPredictionMap" / "BalloonBaseMap" / "assets" / "data"
load_dotenv(ROOT / ".env")

TAWHIRI_API_URL = os.getenv("TAWHIRI_API_URL", "https://api.v2.sondehub.org/tawhiri").strip()
APRSFI_API_KEY = os.getenv("APRSFI_API_KEY", "").strip()
CALLSIGNS = ("KC3SKW-8", "KC3SKW-9", "KC3SKW-10")

app = FastAPI(title="UMD BPP Predicts", version="2.0.0")
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=6)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class LaunchPoint(BaseModel):
    name: str = "Custom launch"
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float | None = None


class PredictRequest(BaseModel):
    mode: Literal["burst", "float"] = "burst"
    launch: LaunchPoint
    launch_datetime: datetime
    ascent_rate_ms: float = Field(default=5.5, gt=0, le=20)
    descent_rate_ms: float = Field(default=9.0, gt=0, le=50)
    burst_altitude_m: float = Field(default=28000, gt=100)
    float_altitude_m: float = Field(default=22000, gt=100)
    float_ascent_rate_ms: float = Field(default=1.0, gt=0, le=10)
    float_duration_min: float = Field(default=60, gt=0, le=24 * 60)

    @model_validator(mode="after")
    def validate_altitudes(self):
        current_alt = self.launch.altitude_m or 0
        if self.mode == "burst" and self.burst_altitude_m <= current_alt:
            raise ValueError("Burst altitude must be above launch/current altitude")
        if self.mode == "float" and self.float_altitude_m <= current_alt:
            raise ValueError("Float altitude must be above launch/current altitude")
        return self


class LivePredictRequest(BaseModel):
    callsign: Literal["KC3SKW-8", "KC3SKW-9", "KC3SKW-10"]
    mode: Literal["burst", "float"] = "burst"
    phase: Literal["auto", "ascending", "descending"] = "auto"
    ascent_rate_ms: float = Field(default=5.5, gt=0, le=20)
    descent_rate_ms: float = Field(default=9.0, gt=0, le=50)
    burst_altitude_m: float = Field(default=28000, gt=100)
    float_altitude_m: float = Field(default=22000, gt=100)
    float_ascent_rate_ms: float = Field(default=1.0, gt=0, le=10)
    float_duration_min: float = Field(default=60, gt=0, le=24 * 60)


class ExternalServiceError(RuntimeError):
    pass


def utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def to_tawhiri_lon(lon: float) -> float:
    return lon % 360


def to_map_lon(lon: float) -> float:
    return ((lon + 180) % 360) - 180


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


async def tawhiri_request(params: dict[str, Any]) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                response = await client.get(TAWHIRI_API_URL, params=params)
                response.raise_for_status()
                payload = response.json()
            if payload.get("error"):
                raise ExternalServiceError(payload["error"].get("description", "Tawhiri prediction failed"))
            if not payload.get("prediction"):
                raise ExternalServiceError("Tawhiri returned no prediction")
            return payload
        except (httpx.HTTPError, ValueError, ExternalServiceError) as exc:
            last_error = exc
            if attempt < 2:
                await asyncio.sleep(0.35 * (attempt + 1))
    raise ExternalServiceError(f"Tawhiri request failed: {last_error}")


def stage_feature(stage: str, trajectory: list[dict[str, Any]], props: dict[str, Any]) -> dict[str, Any]:
    coords: list[list[float]] = []
    times: list[str] = []
    for point in trajectory:
        coords.append([
            to_map_lon(float(point["longitude"])),
            float(point["latitude"]),
            float(point.get("altitude", 0)),
        ])
        times.append(point["datetime"])
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": {**props, "stage": stage, "timestamps": times},
    }


def summarize(features: list[dict[str, Any]], request_meta: dict[str, Any]) -> dict[str, Any]:
    lines = [f for f in features if f.get("geometry", {}).get("type") == "LineString"]
    if not lines:
        raise ExternalServiceError("Prediction did not contain a trajectory")

    stage_summaries = []
    max_alt_m = 0.0
    ground_distance_m = 0.0
    previous: tuple[float, float] | None = None
    all_coords: list[list[float]] = []
    all_times: list[str] = []

    for feature in lines:
        coords = feature["geometry"]["coordinates"]
        times = feature["properties"].get("timestamps", [])
        if not coords:
            continue
        all_coords.extend(coords)
        all_times.extend(times)
        for lon, lat, alt, *_ in coords:
            max_alt_m = max(max_alt_m, float(alt))
            cur = (float(lat), float(lon))
            if previous is not None:
                ground_distance_m += haversine_m(previous, cur)
            previous = cur
        start_time = parse_iso(times[0]) if times else None
        end_time = parse_iso(times[-1]) if times else None
        stage_summaries.append({
            "stage": feature["properties"].get("stage", "unknown"),
            "duration_s": (end_time - start_time).total_seconds() if start_time and end_time else None,
            "start": {"longitude": coords[0][0], "latitude": coords[0][1], "altitude_m": coords[0][2]},
            "end": {"longitude": coords[-1][0], "latitude": coords[-1][1], "altitude_m": coords[-1][2]},
        })

    first_time = parse_iso(all_times[0]) if all_times else None
    last_time = parse_iso(all_times[-1]) if all_times else None
    landing = all_coords[-1]
    launch = all_coords[0]

    return {
        "mode": request_meta.get("mode"),
        "dataset": request_meta.get("dataset"),
        "launch_name": request_meta.get("launch_name"),
        "launch": {"longitude": launch[0], "latitude": launch[1], "altitude_m": launch[2]},
        "landing": {"longitude": landing[0], "latitude": landing[1], "altitude_m": landing[2]},
        "launch_time": all_times[0] if all_times else None,
        "landing_time": all_times[-1] if all_times else None,
        "flight_duration_s": (last_time - first_time).total_seconds() if first_time and last_time else None,
        "max_altitude_m": max_alt_m,
        "ground_distance_m": ground_distance_m,
        "stages": stage_summaries,
        "approximation": request_meta.get("approximation"),
    }


async def run_burst(req: PredictRequest, extra_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "profile": "standard_profile",
        "launch_longitude": to_tawhiri_lon(req.launch.longitude),
        "launch_latitude": req.launch.latitude,
        "launch_datetime": utc_iso(req.launch_datetime),
        "ascent_rate": req.ascent_rate_ms,
        "burst_altitude": req.burst_altitude_m,
        "descent_rate": req.descent_rate_ms,
    }
    if req.launch.altitude_m is not None:
        params["launch_altitude"] = req.launch.altitude_m
    raw = await tawhiri_request(params)
    common = {
        "mode": "burst",
        "launch_name": req.launch.name,
        "dataset": raw.get("request", {}).get("dataset"),
    }
    if extra_meta:
        common.update(extra_meta)
    features = [stage_feature(stage["stage"], stage["trajectory"], common) for stage in raw["prediction"]]
    summary = summarize(features, common)
    return {"type": "FeatureCollection", "features": features, "summary": summary, "request": raw.get("request", {})}


async def run_float(req: PredictRequest, extra_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    first_params: dict[str, Any] = {
        "profile": "standard_profile",
        "launch_longitude": to_tawhiri_lon(req.launch.longitude),
        "launch_latitude": req.launch.latitude,
        "launch_datetime": utc_iso(req.launch_datetime),
        "ascent_rate": req.ascent_rate_ms,
        "burst_altitude": req.float_altitude_m,
        "descent_rate": 99,
    }
    if req.launch.altitude_m is not None:
        first_params["launch_altitude"] = req.launch.altitude_m
    first = await tawhiri_request(first_params)
    ascent = first["prediction"][0]["trajectory"]
    if not ascent:
        raise ExternalServiceError("Float ascent prediction was empty")
    end = ascent[-1]
    float_rate = max(req.float_ascent_rate_ms, 0.1)
    second_params = {
        "profile": "standard_profile",
        "launch_longitude": float(end["longitude"]),
        "launch_latitude": float(end["latitude"]),
        "launch_datetime": end["datetime"],
        "launch_altitude": float(end["altitude"]),
        "ascent_rate": float_rate,
        "burst_altitude": float(end["altitude"]) + float_rate * req.float_duration_min * 60,
        "descent_rate": req.descent_rate_ms,
    }
    if second_params["burst_altitude"] <= second_params["launch_altitude"]:
        second_params["burst_altitude"] = second_params["launch_altitude"] + 1
    second = await tawhiri_request(second_params)
    float_trajectory = second["prediction"][0]["trajectory"]
    descent_trajectory = second["prediction"][1]["trajectory"]
    common = {
        "mode": "float",
        "launch_name": req.launch.name,
        "dataset": second.get("request", {}).get("dataset") or first.get("request", {}).get("dataset"),
        "float_altitude_m": req.float_altitude_m,
        "float_ascent_rate_ms": req.float_ascent_rate_ms,
        "float_duration_min": req.float_duration_min,
    }
    if extra_meta:
        common.update(extra_meta)
    features = [
        stage_feature("ascent", ascent, common),
        stage_feature("float", float_trajectory, common),
        stage_feature("descent", descent_trajectory, common),
    ]
    summary = summarize(features, common)
    return {"type": "FeatureCollection", "features": features, "summary": summary, "request": {"ascent": first.get("request"), "float_descent": second.get("request")}}


# APRS live tracking ---------------------------------------------------------
_live_history: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=120))
_aprs_cache: dict[str, Any] = {"time": 0.0, "data": None}


async def fetch_aprs_all(force: bool = False) -> dict[str, Any]:
    if not APRSFI_API_KEY:
        raise ExternalServiceError("APRS.fi API key is not configured. Add APRSFI_API_KEY to predicts/modern/.env")
    now = time.monotonic()
    if not force and _aprs_cache["data"] is not None and now - _aprs_cache["time"] < 20:
        return _aprs_cache["data"]
    params = {
        "name": ",".join(CALLSIGNS),
        "what": "loc",
        "apikey": APRSFI_API_KEY,
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=7.0)) as client:
            response = await client.get("https://api.aprs.fi/api/get", params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ExternalServiceError(f"APRS.fi request failed: {exc}") from exc
    if payload.get("result") != "ok":
        raise ExternalServiceError(payload.get("description", "APRS.fi returned an error"))

    normalized: dict[str, dict[str, Any]] = {}
    for entry in payload.get("entries", []):
        name = entry.get("name")
        if name not in CALLSIGNS or "lat" not in entry or "lng" not in entry:
            continue
        point = {
            "callsign": name,
            "latitude": float(entry["lat"]),
            "longitude": float(entry["lng"]),
            "altitude_m": float(entry["altitude"]) if entry.get("altitude") not in (None, "") else None,
            "speed_kmh": float(entry["speed"]) if entry.get("speed") not in (None, "") else None,
            "course_deg": float(entry["course"]) if entry.get("course") not in (None, "") else None,
            "time": int(entry["time"]) if entry.get("time") else None,
            "lasttime": int(entry["lasttime"]) if entry.get("lasttime") else None,
            "comment": entry.get("comment"),
            "path": entry.get("path"),
        }
        normalized[name] = point
        history = _live_history[name]
        if not history or history[-1].get("time") != point.get("time"):
            history.append(point)

    data = {
        "source": "aprs.fi",
        "source_url": "https://aprs.fi/",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "stations": normalized,
    }
    _aprs_cache.update({"time": now, "data": data})
    return data


def infer_phase(callsign: str) -> str:
    points = [p for p in _live_history[callsign] if p.get("altitude_m") is not None]
    if len(points) < 2:
        return "unknown"
    a, b = points[-2], points[-1]
    if not a.get("time") or not b.get("time") or b["time"] <= a["time"]:
        return "unknown"
    rate = (b["altitude_m"] - a["altitude_m"]) / (b["time"] - a["time"])
    if rate > 0.5:
        return "ascending"
    if rate < -0.5:
        return "descending"
    return "level"


# Existing BPP data ----------------------------------------------------------
def is_lfs_pointer(path: Path) -> bool:
    try:
        head = path.read_text(encoding="utf-8", errors="ignore")[:200]
        return head.startswith("version https://git-lfs.github.com/spec/v1")
    except OSError:
        return False


def load_geojson(path: Path) -> tuple[dict[str, Any], str | None]:
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}, f"{path.name} not found"
    if is_lfs_pointer(path):
        return {"type": "FeatureCollection", "features": []}, f"{path.name} is a Git LFS pointer; run git lfs pull"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") not in ("FeatureCollection", "Feature"):
            raise ValueError("not GeoJSON")
        return data, None
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {"type": "FeatureCollection", "features": []}, f"Could not load {path.name}: {exc}"


def normalize_launch_locations(data: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy launch-location GeoJSON for the modern frontend.

    Older BPP files store latitude/longitude in properties even when geometry is present.
    This keeps the old data file authoritative while exposing a predictable Point geometry.
    """
    if data.get("type") != "FeatureCollection":
        return {"type": "FeatureCollection", "features": []}
    features: list[dict[str, Any]] = []
    for idx, feature in enumerate(data.get("features", [])):
        if not isinstance(feature, dict):
            continue
        props = dict(feature.get("properties") or {})
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") if geometry.get("type") == "Point" else None
        if not coords or len(coords) < 2:
            lat = props.get("latitude", props.get("lat"))
            lon = props.get("longitude", props.get("lon", props.get("lng")))
            try:
                coords = [to_map_lon(float(lon)), float(lat)]
            except (TypeError, ValueError):
                continue
        else:
            coords = [to_map_lon(float(coords[0])), float(coords[1])]
        if not props.get("name"):
            address = str(props.get("address") or "").strip()
            props["name"] = address.split(",")[0] if address else f"Launch {idx + 1}"
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": coords}, "properties": props})
    return {"type": "FeatureCollection", "features": features}


def fallback_launch_locations() -> dict[str, Any]:
    # Fallback is intentionally labeled as an example rather than an operational launch site.
    # The real BPP launch_locations.geojson should be used after `git lfs pull`.
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-78.1957, 39.6968]},
                "properties": {
                    "name": "Example: NS-112 recorded launch",
                    "address": "Historical BPP launch coordinate",
                    "fallback": True,
                },
            }
        ],
    }


def validate_launch_window(value: datetime) -> None:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if value < now - timedelta(hours=8) or value > now + timedelta(days=7):
        raise HTTPException(
            status_code=400,
            detail="Launch time must be within 8 hours in the past and 7 days in the future, matching the existing BPP predictor window.",
        )



@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": "2.0.0",
        "tawhiri_url": TAWHIRI_API_URL,
        "aprs_configured": bool(APRSFI_API_KEY),
        "legacy_data_directory": str(LEGACY_DATA),
    }


@app.get("/api/config")
async def config():
    return {
        "callsigns": CALLSIGNS,
        "prediction_modes": ["burst", "float"],
        "aprs_configured": bool(APRSFI_API_KEY),
        "aprs_credit": {"name": "aprs.fi", "url": "https://aprs.fi/"},
    }


@app.get("/api/launch-locations")
async def launch_locations():
    data, warning = load_geojson(LEGACY_DATA / "launch_locations.geojson")
    data = normalize_launch_locations(data)
    if not data.get("features"):
        data = fallback_launch_locations()
    return {"data": data, "warning": warning}


AIRSPACE_FILES = {
    "controlled": "controlled_airspace_reduced.geojson",
    "special": "airspaces_special_use.geojson",
    "tfr": "tfr_airspace.geojson",
}


@app.get("/api/airspace/{dataset}")
async def airspace(dataset: Literal["controlled", "special", "tfr"]):
    data, warning = load_geojson(LEGACY_DATA / AIRSPACE_FILES[dataset])
    return {"data": data, "warning": warning}


@app.post("/api/predict")
async def predict(req: PredictRequest):
    validate_launch_window(req.launch_datetime)
    try:
        if req.mode == "float":
            return await run_float(req)
        return await run_burst(req)
    except ExternalServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/live")
async def live(callsign: str | None = Query(default=None)):
    if callsign is not None and callsign not in CALLSIGNS:
        raise HTTPException(status_code=400, detail="Unknown BPP callsign")
    try:
        data = await fetch_aprs_all()
    except ExternalServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if callsign:
        station = data["stations"].get(callsign)
        return {
            "source": data["source"],
            "source_url": data["source_url"],
            "fetched_at": data["fetched_at"],
            "station": station,
            "phase": infer_phase(callsign),
            "history": list(_live_history[callsign]),
        }
    return {
        **data,
        "phase": {name: infer_phase(name) for name in CALLSIGNS},
        "history": {name: list(_live_history[name]) for name in CALLSIGNS},
    }


@app.post("/api/live/predict")
async def live_predict(req: LivePredictRequest):
    try:
        data = await fetch_aprs_all(force=True)
        station = data["stations"].get(req.callsign)
        if not station:
            raise ExternalServiceError(f"No APRS.fi position was found for {req.callsign}")
        alt = station.get("altitude_m")
        phase = req.phase
        inferred = infer_phase(req.callsign)
        if phase == "auto":
            phase = inferred if inferred in ("ascending", "descending") else "ascending"

        launch = LaunchPoint(
            name=f"{req.callsign} live position",
            latitude=station["latitude"],
            longitude=station["longitude"],
            altitude_m=alt,
        )
        approximation = None
        burst_alt = req.burst_altitude_m
        float_alt = req.float_altitude_m
        ascent_rate = req.ascent_rate_ms

        if phase == "descending":
            if alt is None:
                raise ExternalServiceError("A live descending prediction needs APRS altitude data, but the latest packet has no altitude.")
            current_alt = alt
            # Tawhiri's standard profile begins with ascent. A short, fast ascent to a point just
            # above the current altitude produces an immediate transition into its descent model.
            burst_alt = current_alt + 20
            ascent_rate = 20
            approximation = "Live descending prediction uses a near-immediate burst approximation from the latest APRS position."

        if alt is not None:
            if burst_alt <= alt:
                burst_alt = alt + 100
            if float_alt <= alt:
                float_alt = alt + 100

        pred = PredictRequest(
            mode=req.mode,
            launch=launch,
            launch_datetime=datetime.now(timezone.utc),
            ascent_rate_ms=ascent_rate,
            descent_rate_ms=req.descent_rate_ms,
            burst_altitude_m=burst_alt,
            float_altitude_m=float_alt,
            float_ascent_rate_ms=req.float_ascent_rate_ms,
            float_duration_min=req.float_duration_min,
        )
        meta = {"live_callsign": req.callsign, "live_phase": phase, "approximation": approximation}
        result = await (run_float(pred, meta) if req.mode == "float" and phase != "descending" else run_burst(pred, meta))
        result["live"] = {"station": station, "phase": phase, "inferred_phase": inferred}
        return result
    except (ExternalServiceError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


if __name__ == "__main__":
    host = os.getenv("BPP_PREDICTS_HOST", "127.0.0.1")
    port = int(os.getenv("BPP_PREDICTS_PORT", "8000"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
