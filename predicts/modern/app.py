from __future__ import annotations

import asyncio
import json
import math
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

import httpx
import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field, model_validator

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "cache"
AIRSPACE_CACHE_DIR = CACHE_DIR / "airspace"
LEGACY_DATA = ROOT.parent / "BalloonPredictionMap" / "BalloonBaseMap" / "assets" / "data"
for _directory in (DATA_DIR, CACHE_DIR, AIRSPACE_CACHE_DIR):
    _directory.mkdir(parents=True, exist_ok=True)
load_dotenv(ROOT / ".env")

TAWHIRI_API_URL = os.getenv("TAWHIRI_API_URL", "https://api.v2.sondehub.org/tawhiri").strip()
APRSFI_API_KEY = os.getenv("APRSFI_API_KEY", "").strip()
DEFAULT_CALLSIGNS = ("KC3SKW-8", "KC3SKW-9", "KC3SKW-10")
MAX_LIVE_CALLSIGNS = 8

BUILD_VERSION = "2.4.0"

app = FastAPI(title="UMD BPP Predicts", version=BUILD_VERSION)
app.add_middleware(GZipMiddleware, minimum_size=800, compresslevel=6)


@app.middleware("http")
async def latest_build_headers(request: Request, call_next):
    """Prevent a stale browser cache from making an older frontend look current."""
    response = await call_next(request)
    response.headers["X-BPP-Build"] = BUILD_VERSION
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


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


class LivePredictSettings(BaseModel):
    mode: Literal["burst", "float"] = "burst"
    phase: Literal["auto", "ascending", "descending"] = "auto"
    ascent_rate_ms: float = Field(default=5.5, gt=0, le=20)
    descent_rate_ms: float = Field(default=9.0, gt=0, le=50)
    burst_altitude_m: float = Field(default=28000, gt=100)
    float_altitude_m: float = Field(default=22000, gt=100)
    float_ascent_rate_ms: float = Field(default=1.0, gt=0, le=10)
    float_duration_min: float = Field(default=60, gt=0, le=24 * 60)


class LivePredictRequest(LivePredictSettings):
    callsign: str = Field(min_length=1, max_length=20)


class LivePredictBatchRequest(LivePredictSettings):
    callsigns: list[str] = Field(min_length=1, max_length=MAX_LIVE_CALLSIGNS)


class ExternalServiceError(RuntimeError):
    pass


def normalize_callsigns(values: str | list[str] | tuple[str, ...], max_count: int = MAX_LIVE_CALLSIGNS) -> list[str]:
    """Normalize typed APRS callsigns while preserving user order.

    Users may separate callsigns with commas, semicolons, spaces, or newlines.
    APRS SSIDs such as KC3SKW-8 are accepted.
    """
    raw_values = [values] if isinstance(values, str) else list(values)
    tokens: list[str] = []
    for value in raw_values:
        tokens.extend(part for part in re.split(r"[,;\s]+", str(value).strip()) if part)

    callsigns: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        callsign = token.upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{0,14}", callsign):
            raise ValueError(f"Invalid APRS callsign: {token}")
        if callsign not in seen:
            callsigns.append(callsign)
            seen.add(callsign)
    if not callsigns:
        raise ValueError("Enter at least one APRS callsign")
    if len(callsigns) > max_count:
        raise ValueError(f"Live tracking is limited to {max_count} callsigns at a time")
    return callsigns


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
_aprs_cache: dict[tuple[str, ...], dict[str, Any]] = {}


async def fetch_aprs(callsigns: str | list[str] | tuple[str, ...], force: bool = False) -> dict[str, Any]:
    if not APRSFI_API_KEY:
        raise ExternalServiceError("APRS.fi API key is not configured. Add APRSFI_API_KEY to predicts/modern/.env")

    requested = normalize_callsigns(callsigns)
    cache_key = tuple(sorted(requested))
    now = time.monotonic()
    cached = _aprs_cache.get(cache_key)
    if not force and cached is not None and now - cached["time"] < 20:
        return cached["data"]

    params = {
        "name": ",".join(requested),
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

    requested_set = set(requested)
    normalized: dict[str, dict[str, Any]] = {}
    for entry in payload.get("entries", []):
        name = str(entry.get("name") or "").upper()
        if name not in requested_set or "lat" not in entry or "lng" not in entry:
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
        "requested_callsigns": requested,
        "stations": normalized,
    }
    _aprs_cache[cache_key] = {"time": now, "data": data}
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


def station_observation_datetime(station: dict[str, Any]) -> datetime:
    timestamp = station.get("time") or station.get("lasttime")
    if timestamp:
        try:
            return datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            pass
    return datetime.now(timezone.utc)


async def build_live_prediction(settings: LivePredictSettings, callsign: str, station: dict[str, Any]) -> dict[str, Any]:
    """Run a prediction from the latest APRS 3D position.

    Live predictions intentionally require altitude. Falling back to zero/ground level
    would make the remaining ascent/descent timing and landing location misleading.
    """
    alt = station.get("altitude_m")
    if alt is None:
        raise ExternalServiceError(
            f"The latest APRS packet for {callsign} has no altitude. "
            "Live prediction was not run because it must start from the balloon's reported altitude."
        )

    phase = settings.phase
    inferred = infer_phase(callsign)
    if phase == "auto":
        phase = inferred if inferred in ("ascending", "descending") else "ascending"

    launch = LaunchPoint(
        name=f"{callsign} live position",
        latitude=station["latitude"],
        longitude=station["longitude"],
        altitude_m=float(alt),
    )
    approximation = None
    burst_alt = settings.burst_altitude_m
    float_alt = settings.float_altitude_m
    ascent_rate = settings.ascent_rate_ms

    if phase == "descending":
        current_alt = float(alt)
        # Tawhiri's standard profile begins with ascent. A short, fast ascent to a point
        # just above the current altitude produces an immediate transition to descent.
        burst_alt = current_alt + 20
        ascent_rate = 20
        approximation = "Live descending prediction uses a near-immediate burst approximation from the latest APRS 3D position."

    if burst_alt <= alt:
        burst_alt = float(alt) + 100
    if float_alt <= alt:
        float_alt = float(alt) + 100

    observation_time = station_observation_datetime(station)
    pred = PredictRequest(
        mode=settings.mode,
        launch=launch,
        launch_datetime=observation_time,
        ascent_rate_ms=ascent_rate,
        descent_rate_ms=settings.descent_rate_ms,
        burst_altitude_m=burst_alt,
        float_altitude_m=float_alt,
        float_ascent_rate_ms=settings.float_ascent_rate_ms,
        float_duration_min=settings.float_duration_min,
    )
    meta = {
        "live_callsign": callsign,
        "live_phase": phase,
        "live_start_altitude_m": float(alt),
        "live_observation_time": utc_iso(observation_time),
        "approximation": approximation,
    }
    result = await (run_float(pred, meta) if settings.mode == "float" and phase != "descending" else run_burst(pred, meta))
    packet_age_s = max(0, int((datetime.now(timezone.utc) - observation_time).total_seconds()))
    result["live"] = {
        "station": station,
        "phase": phase,
        "inferred_phase": inferred,
        "used_position": {
            "latitude": station["latitude"],
            "longitude": station["longitude"],
            "altitude_m": float(alt),
        },
        "used_altitude_m": float(alt),
        "observation_time": utc_iso(observation_time),
        "packet_age_s": packet_age_s,
    }
    return result


# Operational BPP data -------------------------------------------------------
# The modern application can use a fully-resolved legacy checkout when present, but
# it does not depend on Git LFS being installed. Launch/reference data can be pulled
# through GitHub's public LFS media endpoint and cached locally. Airspace comes from
# current FAA services and is also cached so a temporary upstream outage does not
# blank the map.
REMOTE_BPP_DATA_BASE = (
    "https://media.githubusercontent.com/media/rzaman00/Ryeed-BPP-Tracking/0478e8dc9f83b75de36280366ef52766c79b7edb/"
    "predicts/BalloonPredictionMap/BalloonBaseMap/assets/data"
)
REMOTE_UMDBPP_LAUNCH_URL = (
    "https://media.githubusercontent.com/media/UMDBPP/BalloonPredictionMap/main/launch_locations.geojson"
)
BUNDLED_LAUNCH_FILE = DATA_DIR / "bundled_launch_sites.geojson"
LAUNCH_CACHE_FILE = CACHE_DIR / "launch_locations.geojson"
LAUNCH_CACHE_TTL_S = 12 * 60 * 60

REGION_BBOX = {"lat_min": 36.5, "lat_max": 42.5, "lon_min": -83.7, "lon_max": -74.6}
FAA_CLASS_AIRSPACE_URL = (
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"
    "Class_Airspace/FeatureServer/0/query"
)
FAA_SUA_URL = (
    "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/"
    "Special_Use_Airspace/FeatureServer/0/query"
)
FAA_TFR_WFS_URL = "https://tfr.faa.gov/geoserver/TFR/ows"
AIRSPACE_TTLS = {"controlled": 12 * 60 * 60, "class_e": 12 * 60 * 60, "sua": 12 * 60 * 60, "tfr": 15 * 60}


def empty_fc() -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": []}


def is_lfs_pointer(path: Path) -> bool:
    try:
        head = path.read_text(encoding="utf-8", errors="ignore")[:200]
        return head.startswith("version https://git-lfs.github.com/spec/v1")
    except OSError:
        return False


def load_geojson(path: Path) -> tuple[dict[str, Any], str | None]:
    if not path.exists():
        return empty_fc(), f"{path.name} not found"
    if is_lfs_pointer(path):
        return empty_fc(), f"{path.name} is a Git LFS pointer"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("type") not in ("FeatureCollection", "Feature"):
            raise ValueError("not GeoJSON")
        return data, None
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return empty_fc(), f"Could not load {path.name}: {exc}"


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def cache_fresh(path: Path, ttl_s: int) -> bool:
    try:
        return path.exists() and (time.time() - path.stat().st_mtime) < ttl_s
    except OSError:
        return False


async def fetch_json_url(url: str, *, params: dict[str, Any] | None = None, timeout: float = 18.0) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(8.0, timeout))) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict):
        raise ExternalServiceError("Remote data source returned an unexpected response")
    return payload


def normalize_launch_locations(data: dict[str, Any], source: str | None = None) -> dict[str, Any]:
    if data.get("type") != "FeatureCollection":
        return empty_fc()
    features: list[dict[str, Any]] = []
    for idx, feature in enumerate(data.get("features", [])):
        if not isinstance(feature, dict):
            continue
        props = dict(feature.get("properties") or {})
        geometry = feature.get("geometry") or {}
        geometry_coords = geometry.get("coordinates") if geometry.get("type") == "Point" else None
        lat = props.get("latitude", props.get("lat"))
        lon = props.get("longitude", props.get("lon", props.get("lng")))
        coords = None
        try:
            if lat is not None and lon is not None:
                coords = [to_map_lon(float(lon)), float(lat)]
        except (TypeError, ValueError):
            coords = None
        if coords is None and geometry_coords and len(geometry_coords) >= 2:
            try:
                coords = [to_map_lon(float(geometry_coords[0])), float(geometry_coords[1])]
            except (TypeError, ValueError):
                coords = None
        if coords is None or not (-90 <= coords[1] <= 90):
            continue
        if not props.get("name"):
            address = str(props.get("address") or "").strip()
            props["name"] = address.split(",")[0] if address else f"Launch {idx + 1}"
        if source:
            props.setdefault("data_source", source)
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": coords}, "properties": props})
    return {"type": "FeatureCollection", "features": features}


def launch_feature_key(feature: dict[str, Any]) -> tuple[str, int, int]:
    props = feature.get("properties") or {}
    name = str(props.get("name") or props.get("address") or "").strip().lower()
    coords = (feature.get("geometry") or {}).get("coordinates") or [0, 0]
    return name, round(float(coords[0]) * 10000), round(float(coords[1]) * 10000)


def merge_launch_collections(*collections: dict[str, Any]) -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for collection in collections:
        for feature in collection.get("features", []) if isinstance(collection, dict) else []:
            key = launch_feature_key(feature)
            if key in seen:
                continue
            seen.add(key)
            out.append(feature)
    return {"type": "FeatureCollection", "features": out}


async def operational_launch_locations() -> tuple[dict[str, Any], list[str], list[str]]:
    warnings: list[str] = []
    sources: list[str] = []
    collections: list[dict[str, Any]] = []

    # Prefer a resolved local copy because it exactly matches the user's checkout.
    local, local_warning = load_geojson(LEGACY_DATA / "launch_locations.geojson")
    local = normalize_launch_locations(local, "local BPP data")
    if local.get("features"):
        collections.append(local)
        sources.append("local")
    elif local_warning:
        warnings.append(local_warning)

    # A cached copy avoids a remote request on every page load.
    cached, _ = load_geojson(LAUNCH_CACHE_FILE)
    cached = normalize_launch_locations(cached, "cached BPP launch data")
    if cached.get("features"):
        collections.append(cached)
        sources.append("cache")

    # Refresh from public LFS media when no good local copy exists or the cache is old.
    if not local.get("features") or not cache_fresh(LAUNCH_CACHE_FILE, LAUNCH_CACHE_TTL_S):
        remote_errors: list[str] = []
        for url, label in [
            (f"{REMOTE_BPP_DATA_BASE}/launch_locations.geojson", "Ryeed BPP repository"),
            (REMOTE_UMDBPP_LAUNCH_URL, "UMDBPP launch repository"),
        ]:
            try:
                raw = await fetch_json_url(url, timeout=10.0)
                remote = normalize_launch_locations(raw, label)
                if remote.get("features"):
                    write_json_atomic(LAUNCH_CACHE_FILE, remote)
                    collections.insert(0, remote)
                    sources.insert(0, "remote")
                    break
            except Exception as exc:
                remote_errors.append(f"{label}: {exc}")
        if not any(s == "remote" for s in sources) and remote_errors:
            warnings.append("Could not refresh online launch-site list; using local/cached fallback")

    bundled, bundled_warning = load_geojson(BUNDLED_LAUNCH_FILE)
    bundled = normalize_launch_locations(bundled, "bundled offline fallback")
    if bundled.get("features"):
        collections.append(bundled)
        sources.append("bundled")
    elif bundled_warning:
        warnings.append(bundled_warning)

    merged = merge_launch_collections(*collections)
    if not merged.get("features"):
        warnings.append("No launch locations could be loaded")
    return merged, warnings, sources


# Reference overlays can also resolve Git LFS files through the public media URL.
REFERENCE_FILES = {
    "schools": "public_school_locations_reduced.geojson",
    "mcdonalds": "mcdonalds_locations.geojson",
    "dunkin": "dunkinDonuts_reduced.geojson",
    "launch_locations": "launch_locations.geojson",
    "poi": "poi.geojson",
}


async def operational_reference_data(dataset: str) -> tuple[dict[str, Any], str | None]:
    if dataset == "launch_locations":
        data, warnings, _ = await operational_launch_locations()
        return data, "; ".join(warnings) if warnings else None
    filename = REFERENCE_FILES[dataset]
    local, warning = load_geojson(LEGACY_DATA / filename)
    if local.get("features"):
        return local, None
    cache_path = CACHE_DIR / "reference" / filename
    cached, _ = load_geojson(cache_path)
    if cached.get("features") and cache_fresh(cache_path, 24 * 60 * 60):
        return cached, warning
    try:
        remote = await fetch_json_url(f"{REMOTE_BPP_DATA_BASE}/{filename}", timeout=12.0)
        if remote.get("type") in ("FeatureCollection", "Feature"):
            write_json_atomic(cache_path, remote)
            return remote, warning
    except Exception as exc:
        if cached.get("features"):
            return cached, f"Using cached {filename}; online refresh failed: {exc}"
        return empty_fc(), f"Could not load {filename}: {exc}"
    return empty_fc(), warning


def bbox_param() -> str:
    b = REGION_BBOX
    return f'{b["lon_min"]},{b["lat_min"]},{b["lon_max"]},{b["lat_max"]}'


async def fetch_arcgis_airspace(where: str, layer_name: str) -> dict[str, Any]:
    page_size = 2000
    features: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=8.0)) as client:
        for page in range(25):
            params = {
                "where": where,
                "geometry": bbox_param(),
                "geometryType": "esriGeometryEnvelope",
                "spatialRel": "esriSpatialRelIntersects",
                "inSR": "4326",
                "outSR": "4326",
                "outFields": "*",
                "returnGeometry": "true",
                "f": "geojson",
                "resultRecordCount": page_size,
                "resultOffset": page * page_size,
                "orderByFields": "OBJECTID",
                "geometryPrecision": 5,
            }
            response = await client.get(FAA_CLASS_AIRSPACE_URL, params=params)
            response.raise_for_status()
            raw = response.json()
            if raw.get("type") != "FeatureCollection" or not isinstance(raw.get("features"), list):
                raise ExternalServiceError("FAA class-airspace service returned an unexpected response")
            for feature in raw["features"]:
                feature = dict(feature)
                props = dict(feature.get("properties") or {})
                props["bpp_airspace_layer"] = layer_name
                feature["properties"] = props
                features.append(feature)
            if not (raw.get("properties") or {}).get("exceededTransferLimit"):
                return {"type": "FeatureCollection", "features": features}
    raise ExternalServiceError("FAA class-airspace response exceeded paging safety limit")


async def fetch_controlled_airspace() -> dict[str, Any]:
    jobs = [
        fetch_arcgis_airspace("LOCAL_TYPE='CLASS_B'", "Class B"),
        fetch_arcgis_airspace("LOCAL_TYPE='CLASS_C'", "Class C"),
        fetch_arcgis_airspace("LOCAL_TYPE='CLASS_D'", "Class D"),
    ]
    results = await asyncio.gather(*jobs)
    features = [f for result in results for f in result.get("features", [])]
    return {"type": "FeatureCollection", "features": features}


async def fetch_class_e_airspace() -> dict[str, Any]:
    return await fetch_arcgis_airspace("CLASS='E'", "Class E")


async def fetch_sua_airspace() -> dict[str, Any]:
    params_base = {
        "where": "1=1", "geometry": bbox_param(), "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects", "inSR": "4326", "outSR": "4326",
        "outFields": "*", "returnGeometry": "true", "f": "geojson", "resultRecordCount": 2000,
        "orderByFields": "OBJECTID", "geometryPrecision": 5,
    }
    features: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=8.0)) as client:
        for page in range(25):
            params = dict(params_base, resultOffset=page * 2000)
            response = await client.get(FAA_SUA_URL, params=params)
            response.raise_for_status()
            raw = response.json()
            if raw.get("type") != "FeatureCollection":
                raise ExternalServiceError("FAA special-use airspace service returned an unexpected response")
            features.extend(raw.get("features", []))
            if not (raw.get("properties") or {}).get("exceededTransferLimit"):
                return {"type": "FeatureCollection", "features": features}
    raise ExternalServiceError("FAA special-use airspace response exceeded paging safety limit")


def geometry_intersects_region(geometry: dict[str, Any] | None) -> bool:
    if not geometry or geometry.get("coordinates") is None:
        return False
    lons: list[float] = []
    lats: list[float] = []
    def walk(value: Any) -> None:
        if isinstance(value, (list, tuple)) and len(value) >= 2 and isinstance(value[0], (int, float)) and isinstance(value[1], (int, float)):
            lons.append(float(value[0])); lats.append(float(value[1])); return
        if isinstance(value, (list, tuple)):
            for child in value: walk(child)
    walk(geometry.get("coordinates"))
    if not lons:
        return False
    b = REGION_BBOX
    return min(lons) <= b["lon_max"] and max(lons) >= b["lon_min"] and min(lats) <= b["lat_max"] and max(lats) >= b["lat_min"]


async def fetch_tfr_airspace() -> dict[str, Any]:
    params = {
        "service": "WFS", "version": "1.1.0", "request": "GetFeature",
        "typeName": "TFR:V_TFR_LOC", "maxFeatures": 1000,
        "outputFormat": "application/json", "srsname": "EPSG:4326",
    }
    raw = await fetch_json_url(FAA_TFR_WFS_URL, params=params, timeout=25.0)
    features: list[dict[str, Any]] = []
    for item in raw.get("features", []):
        geom = item.get("geometry")
        if not geometry_intersects_region(geom):
            continue
        props = dict(item.get("properties") or {})
        if props.get("NOTAM_KEY"):
            props.setdefault("notam_id", str(props["NOTAM_KEY"]).split("-", 1)[0])
        props.setdefault("description", props.get("TITLE"))
        props.setdefault("type", props.get("LEGAL"))
        features.append({"type": "Feature", "geometry": geom, "properties": props})
    return {"type": "FeatureCollection", "features": features}


async def operational_airspace(dataset: str, force: bool = False) -> tuple[dict[str, Any], str | None, str]:
    # backwards-compatible alias from v2.4
    if dataset == "uncontrolled":
        dataset = "class_e"
    cache_path = AIRSPACE_CACHE_DIR / f"{dataset}.geojson"
    cached, _ = load_geojson(cache_path)
    if not force and cached.get("features") and cache_fresh(cache_path, AIRSPACE_TTLS[dataset]):
        return cached, None, "FAA cache"
    try:
        if dataset == "controlled": data = await fetch_controlled_airspace()
        elif dataset == "class_e": data = await fetch_class_e_airspace()
        elif dataset == "sua": data = await fetch_sua_airspace()
        elif dataset == "tfr": data = await fetch_tfr_airspace()
        else: raise ValueError("Unknown airspace dataset")
        write_json_atomic(cache_path, data)
        return data, None, "FAA live"
    except Exception as exc:
        if cached.get("features"):
            return cached, f"FAA refresh failed; showing last cached data: {exc}", "FAA stale cache"
        # Last fallback: use a resolved old BPP file for controlled/TFR if available.
        legacy_map = {"controlled": "controlled_airspace_reduced.geojson", "tfr": "tfr_airspace.geojson"}
        if dataset in legacy_map:
            legacy, _ = load_geojson(LEGACY_DATA / legacy_map[dataset])
            if legacy.get("features"):
                return legacy, f"FAA refresh failed; showing local legacy layer: {exc}", "legacy local"
        return empty_fc(), f"Airspace could not be loaded: {exc}", "unavailable"


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
        "status": "ok", "version": BUILD_VERSION, "tawhiri_url": TAWHIRI_API_URL,
        "aprs_configured": bool(APRSFI_API_KEY), "legacy_data_directory": str(LEGACY_DATA),
        "launch_sites": "local + GitHub LFS media + offline fallback",
        "airspace": "FAA live services with disk cache",
    }


@app.get("/api/config")
async def config():
    return {
        "callsigns": DEFAULT_CALLSIGNS, "default_callsigns": DEFAULT_CALLSIGNS,
        "max_live_callsigns": MAX_LIVE_CALLSIGNS, "prediction_modes": ["burst", "float"],
        "aprs_configured": bool(APRSFI_API_KEY), "aprs_credit": {"name": "aprs.fi", "url": "https://aprs.fi/"},
        "airspace_layers": ["controlled", "class_e", "sua", "tfr"],
    }


@app.get("/api/launch-locations")
async def launch_locations():
    data, warnings, sources = await operational_launch_locations()
    return {"data": data, "warning": "; ".join(dict.fromkeys(warnings)) if warnings else None, "sources": sources, "count": len(data.get("features", []))}


@app.get("/api/airspace/{dataset}")
async def airspace(dataset: Literal["controlled", "class_e", "sua", "tfr", "uncontrolled"], refresh: bool = Query(default=False)):
    data, warning, source = await operational_airspace(dataset, force=refresh)
    return {"data": data, "warning": warning, "source": source, "count": len(data.get("features", []))}


@app.get("/api/reference/{dataset}")
async def reference_data(dataset: Literal["schools", "mcdonalds", "dunkin", "launch_locations", "poi"]):
    data, warning = await operational_reference_data(dataset)
    return {"data": data, "warning": warning}


@app.get("/api/national-addresses")
async def national_addresses(
    west: float = Query(ge=-180, le=180),
    south: float = Query(ge=-90, le=90),
    east: float = Query(ge=-180, le=180),
    north: float = Query(ge=-90, le=90),
):
    if west >= east or south >= north:
        raise HTTPException(status_code=400, detail="Invalid map bounds")
    # Match the legacy predictor's National Address Database layer, but proxy it through
    # the local backend so the browser has one predictable API surface.
    url = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query"
    params = {
        "where": "1=1",
        "geometry": json.dumps({
            "xmin": west, "ymin": south, "xmax": east, "ymax": north,
            "spatialReference": {"wkid": 4326},
        }),
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelContains",
        "outFields": "AddNo_Full,StNam_Full,Inc_Muni,Post_City,County,State,Zip_Code",
        "geometryPrecision": 6,
        "f": "geojson",
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(18.0, connect=7.0)) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"National Address Database request failed: {exc}") from exc
    if isinstance(payload, dict) and payload.get("error"):
        raise HTTPException(status_code=502, detail=payload["error"].get("message", "National Address Database error"))
    return {"data": payload}


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
async def live(
    callsign: str | None = Query(default=None),
    callsigns: str | None = Query(default=None),
):
    try:
        requested = normalize_callsigns(callsigns or callsign or list(DEFAULT_CALLSIGNS))
        data = await fetch_aprs(requested)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ExternalServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Keep the single-callsign response shape for backwards compatibility.
    if callsign is not None and callsigns is None and len(requested) == 1:
        name = requested[0]
        station = data["stations"].get(name)
        return {
            "source": data["source"],
            "source_url": data["source_url"],
            "fetched_at": data["fetched_at"],
            "station": station,
            "phase": infer_phase(name),
            "history": list(_live_history[name]),
        }

    return {
        **data,
        "phase": {name: infer_phase(name) for name in requested},
        "history": {name: list(_live_history[name]) for name in requested},
    }


@app.post("/api/live/predict")
async def live_predict(req: LivePredictRequest):
    try:
        callsign = normalize_callsigns(req.callsign, max_count=1)[0]
        data = await fetch_aprs([callsign], force=True)
        station = data["stations"].get(callsign)
        if not station:
            raise ExternalServiceError(f"No APRS.fi position was found for {callsign}")
        return await build_live_prediction(req, callsign, station)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ExternalServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/live/predict-batch")
async def live_predict_batch(req: LivePredictBatchRequest):
    try:
        callsigns = normalize_callsigns(req.callsigns)
        data = await fetch_aprs(callsigns, force=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ExternalServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    errors: dict[str, str] = {}
    jobs: list[tuple[str, Any]] = []
    for callsign in callsigns:
        station = data["stations"].get(callsign)
        if not station:
            errors[callsign] = f"No APRS.fi position was found for {callsign}"
            continue
        jobs.append((callsign, build_live_prediction(req, callsign, station)))

    outcomes = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True) if jobs else []
    results: dict[str, dict[str, Any]] = {}
    for (callsign, _), outcome in zip(jobs, outcomes):
        if isinstance(outcome, Exception):
            errors[callsign] = str(outcome)
        else:
            results[callsign] = outcome

    return {
        "source": data["source"],
        "source_url": data["source_url"],
        "fetched_at": data["fetched_at"],
        "requested_callsigns": callsigns,
        "results": results,
        "errors": errors,
    }


if __name__ == "__main__":
    host = os.getenv("BPP_PREDICTS_HOST", "127.0.0.1")
    port = int(os.getenv("BPP_PREDICTS_PORT", "8000"))
    uvicorn.run("app:app", host=host, port=port, reload=False)
