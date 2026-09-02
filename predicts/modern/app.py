from __future__ import annotations

import asyncio
import csv
import io
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
from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

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

BUILD_VERSION = "3.4.0"

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_HISTORICAL_FORECAST_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
NCEP_REANALYSIS_NCSS = "https://psl.noaa.gov/thredds/ncss/grid/Datasets/ncep.reanalysis/pressure"
NCEP_REANALYSIS_START = datetime(1948, 1, 1, tzinfo=timezone.utc)
# NOAA/PSL announced the final NCEP/NCAR Reanalysis 1 update in March 2026.
NCEP_REANALYSIS_END = datetime(2026, 3, 17, 23, 59, tzinfo=timezone.utc)
# Standard-atmosphere heights used to map the NCEP/NCAR pressure surfaces to
# balloon altitude. The wind values themselves come from the archived reanalysis.
NCEP_PRESSURE_HEIGHT_M = {
    1000.0: 110.0, 925.0: 760.0, 850.0: 1450.0, 700.0: 3010.0,
    600.0: 4200.0, 500.0: 5570.0, 400.0: 7180.0, 300.0: 9160.0,
    250.0: 10360.0, 200.0: 11780.0, 150.0: 13610.0, 100.0: 16180.0,
    70.0: 18420.0, 50.0: 20580.0, 30.0: 23850.0, 20.0: 26480.0,
    10.0: 31050.0,
}
WEATHER_CACHE_TTL_S = 15 * 60.0
_weather_cache: dict[tuple[float, float, str], tuple[float, dict[str, Any]]] = {}


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


class WeatherSite(BaseModel):
    site_id: str = Field(default="site", min_length=1, max_length=160)
    name: str = Field(default="Launch site", min_length=1, max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class WeatherBatchRequest(BaseModel):
    sites: list[WeatherSite] = Field(min_length=1, max_length=60)
    launch_datetime: datetime


class InflationRequest(BaseModel):
    """Inputs exposed by the operational inflation calculator.

    The equations and fixed model constants are a direct Python port of the
    provided InflationCalculations2024.m MATLAB script.
    """

    station_pressure_inhg: float = Field(default=29.85, gt=0, le=40)
    site_temperature_f: float = Field(default=70.0, gt=-459.67, le=160)
    balloon_neck_mass_kg: float = Field(default=2.255, gt=0, le=20)
    payload_mass_kg: float = Field(default=6.588, ge=0, le=100)
    target_ascent_rate_ms: float = Field(default=5.5, gt=0, le=20)


def calculate_inflation(req: InflationRequest) -> dict[str, Any]:
    """Reproduce InflationCalculations2024.m without requiring MATLAB.

    This intentionally keeps the validated constants from the MATLAB source:
    cd=0.25, R_air=287.05, R_helium=2077.1, launch diameter range 2-3 m,
    Hwoyee 1600 burst diameter 10.5 m, and the 7238.3 m exponential-density
    approximation.
    """
    g = 9.80665
    cd = 0.25
    R_air = 287.05
    R_helium = 2077.1
    diameter_min = 2.0
    diameter_max = 3.0
    burst_diameter = 10.5

    P_site_Pa = req.station_pressure_inhg * 3386.389
    T_site_K = (req.site_temperature_f - 32.0) * (5.0 / 9.0) + 273.15
    rho_air = P_site_Pa / (R_air * T_site_K)
    rho_helium = P_site_Pa / (R_helium * T_site_K)
    total_mass = req.balloon_neck_mass_kg + req.payload_mass_kg

    def volume(diameter: float) -> float:
        return math.pi * diameter ** 3 / 6.0

    def net_lift_mass(diameter: float) -> float:
        return (rho_air - rho_helium) * volume(diameter) - total_mass

    def ascent_rate(diameter: float) -> float:
        net = net_lift_mass(diameter)
        if net <= 0:
            return 0.0
        return math.sqrt(8.0 * g * net / (cd * rho_air * math.pi * diameter ** 2))

    liftoff_diameter = (6.0 * total_mass / (math.pi * (rho_air - rho_helium))) ** (1.0 / 3.0)
    if liftoff_diameter >= diameter_max:
        raise ValueError(
            f"The balloon cannot produce positive free lift within the specified diameter range of {diameter_min:.2f} to {diameter_max:.2f} m."
        )

    diameter_lower_bound = max(diameter_min, liftoff_diameter * (1.0 + 1e-9))
    minimum_ascent_rate = ascent_rate(diameter_lower_bound)
    maximum_ascent_rate = ascent_rate(diameter_max)
    target = req.target_ascent_rate_ms
    if target < minimum_ascent_rate or target > maximum_ascent_rate:
        raise ValueError(
            "The requested ascent rate is outside the range achievable with diameters "
            f"from {diameter_min:.2f} to {diameter_max:.2f} m. The available range is "
            f"approximately {minimum_ascent_rate:.3f} to {maximum_ascent_rate:.3f} m/s."
        )

    # MATLAB uses fzero on the same monotonic bracket. Bisection gives the same
    # physical root deterministically without adding a SciPy/MATLAB dependency.
    lo, hi = diameter_lower_bound, diameter_max
    for _ in range(100):
        mid = (lo + hi) / 2.0
        if ascent_rate(mid) < target:
            lo = mid
        else:
            hi = mid
    balloon_diameter = (lo + hi) / 2.0
    actual_ascent_rate = ascent_rate(balloon_diameter)
    vol = volume(balloon_diameter)

    lift_required_kg = (rho_air - rho_helium) * vol - req.balloon_neck_mass_kg
    lift_required_lb = lift_required_kg * 2.20462262185
    required_psi = lift_required_lb * 200.0

    vol_burst = (4.0 / 3.0) * math.pi * (burst_diameter / 2.0) ** 3
    ratio = vol_burst / vol
    burst_altitude_m = 7238.3 * math.log(ratio)
    burst_altitude_ft = burst_altitude_m * 3.28084

    return {
        "expected_ascent_rate_ms": actual_ascent_rate,
        "required_scale_lift_lb": lift_required_lb,
        "required_psi": required_psi,
        "burst_altitude_m": burst_altitude_m,
        "burst_altitude_ft": burst_altitude_ft,
        "burst_altitude_reference": "above launch site",
        "balloon_diameter_m": balloon_diameter,
        "helium_volume_m3": vol,
        "air_density_kgm3": rho_air,
        "helium_density_kgm3": rho_helium,
        "minimum_ascent_rate_ms": minimum_ascent_rate,
        "maximum_ascent_rate_ms": maximum_ascent_rate,
        "model": "InflationCalculations2024.m direct equation port",
        "constants": {
            "g_ms2": g, "drag_coefficient": cd, "R_air": R_air, "R_helium": R_helium,
            "diameter_min_m": diameter_min, "diameter_max_m": diameter_max,
            "burst_diameter_m": burst_diameter, "density_scale_height_m": 7238.3,
        },
    }


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


class OptimalSiteCandidate(BaseModel):
    site_id: str = Field(min_length=1, max_length=160)
    name: str = Field(min_length=1, max_length=160)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float | None = None
    preferred: bool = False


class OptimalSiteRequest(BaseModel):
    launch_sites: list[OptimalSiteCandidate] = Field(min_length=1, max_length=50)
    mode: Literal["burst", "float"] = "burst"
    launch_datetime: datetime
    ascent_rate_ms: float = Field(default=5.5, gt=0, le=20)
    descent_rate_ms: float = Field(default=9.0, gt=0, le=50)
    burst_altitude_m: float = Field(default=28000, gt=100)
    float_altitude_m: float = Field(default=22000, gt=100)
    float_ascent_rate_ms: float = Field(default=1.0, gt=0, le=10)
    float_duration_min: float = Field(default=60, gt=0, le=24 * 60)
    airspace_layers: list[Literal["controlled", "class_e", "sua", "tfr"]] = Field(
        default_factory=lambda: ["controlled", "class_e", "sua", "tfr"],
        min_length=1,
        max_length=4,
    )
    ascent_rate_sweep_ms: list[float] = Field(default_factory=list, max_length=9)
    automatic_burst: bool = False
    inflation: InflationRequest | None = None

    @model_validator(mode="after")
    def validate_sweep_rates(self):
        for value in self.ascent_rate_sweep_ms:
            if not math.isfinite(value) or value <= 0 or value > 20:
                raise ValueError("Optimal-site ascent-rate sweep values must be positive and at most 20 m/s")
        return self


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
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        for attempt in range(3):
            try:
                response = await client.get(TAWHIRI_API_URL, params=params)
                response.raise_for_status()
                payload = response.json()
                if payload.get("error"):
                    description = payload["error"].get("description", "Tawhiri prediction failed")
                    raise ExternalServiceError(description)
                if not payload.get("prediction"):
                    raise ExternalServiceError("Tawhiri returned no prediction")
                return payload
            except ExternalServiceError:
                # A structured Tawhiri error will not become valid after retrying the
                # identical parameters (notably unavailable historical datasets).
                raise
            except httpx.HTTPStatusError as exc:
                last_error = exc
                if 400 <= exc.response.status_code < 500 and exc.response.status_code not in {408, 429}:
                    break
            except (httpx.HTTPError, ValueError) as exc:
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


def prediction_trajectory(payload: dict[str, Any], stage: str, fallback_index: int) -> list[dict[str, Any]]:
    """Return a validated Tawhiri trajectory without trusting array order alone."""
    predictions = payload.get("prediction")
    if not isinstance(predictions, list):
        raise ExternalServiceError("Tawhiri returned an invalid prediction payload")
    selected = next(
        (item for item in predictions if isinstance(item, dict) and item.get("stage") == stage),
        None,
    )
    if selected is None and 0 <= fallback_index < len(predictions):
        selected = predictions[fallback_index]
    if not isinstance(selected, dict) or not isinstance(selected.get("trajectory"), list):
        raise ExternalServiceError(f"Tawhiri returned no valid {stage} trajectory")
    trajectory = selected["trajectory"]
    if not trajectory:
        raise ExternalServiceError(f"Tawhiri returned an empty {stage} trajectory")
    return trajectory


def summarize(features: list[dict[str, Any]], request_meta: dict[str, Any]) -> dict[str, Any]:
    lines = [
        f for f in features
        if f.get("geometry", {}).get("type") == "LineString"
        and f.get("geometry", {}).get("coordinates")
    ]
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

    if not all_coords:
        raise ExternalServiceError("Prediction did not contain usable trajectory coordinates")

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
        "historical": bool(request_meta.get("historical")),
        "historical_source": request_meta.get("historical_source"),
    }



def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _historical_dataset_candidates(launch_datetime: datetime) -> list[datetime]:
    """Model cycles to try for Tawhiri historical replay, newest usable cycle first."""
    dt = _as_utc(launch_datetime)
    cycle_hour = (dt.hour // 6) * 6
    cycle = dt.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)
    return [cycle - timedelta(hours=6 * offset) for offset in range(4)]


async def tawhiri_for_launch(params: dict[str, Any], launch_datetime: datetime) -> tuple[dict[str, Any], bool]:
    """Use current Tawhiri normally; explicitly select archived cycles for older launches."""
    dt = _as_utc(launch_datetime)
    if dt >= datetime.now(timezone.utc) - timedelta(hours=8):
        return await tawhiri_request(params), False
    errors: list[str] = []
    for dataset in _historical_dataset_candidates(dt):
        historical_params = dict(params)
        historical_params["dataset"] = utc_iso(dataset)
        try:
            return await tawhiri_request(historical_params), True
        except ExternalServiceError as exc:
            errors.append(f"{dataset:%Y-%m-%d %HZ}: {exc}")
    raise ExternalServiceError("No matching archived Tawhiri model cycle was available. " + " | ".join(errors[-2:]))


def _ncep_time_window(req: PredictRequest) -> tuple[datetime, datetime]:
    start = _as_utc(req.launch_datetime)
    launch_alt = max(0.0, float(req.launch.altitude_m or 0.0))
    top = req.burst_altitude_m if req.mode == "burst" else req.float_altitude_m
    ascent_s = max(0.0, top - launch_alt) / max(req.ascent_rate_ms, 0.1)
    float_s = req.float_duration_min * 60.0 if req.mode == "float" else 0.0
    # More than enough room for the descent and 6-hour interpolation bracketing.
    duration = max(8 * 3600.0, ascent_s + float_s + 4 * 3600.0)
    duration = min(duration, 36 * 3600.0)
    return start - timedelta(hours=6), start + timedelta(seconds=duration + 6 * 3600)


def _year_ranges(start: datetime, end: datetime) -> list[tuple[int, datetime, datetime]]:
    ranges: list[tuple[int, datetime, datetime]] = []
    year = start.year
    while year <= end.year:
        ys = datetime(year, 1, 1, tzinfo=timezone.utc)
        ye = datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)
        ranges.append((year, max(start, ys), min(end, ye)))
        year += 1
    return [(y, a, b) for y, a, b in ranges if a <= b]


def _parse_ncss_csv(text: str, variable: str) -> dict[datetime, dict[float, float]]:
    """Parse a THREDDS NCSS grid-as-point CSV into time -> pressure level -> value."""
    rows = [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    if not rows:
        return {}
    reader = csv.DictReader(io.StringIO("\n".join(rows)))
    output: dict[datetime, dict[float, float]] = defaultdict(dict)
    for row in reader:
        keys = list(row.keys())
        time_key = next((k for k in keys if "time" in str(k).lower() or "date" in str(k).lower()), None)
        level_key = next((k for k in keys if str(k).lower() in {"level", "lev", "isobaric", "pressure"} or "level" in str(k).lower()), None)
        value_key = next((k for k in keys if str(k).lower() == variable.lower()), None)
        if value_key is None:
            value_key = next((k for k in keys if variable.lower() in str(k).lower()), None)
        if not time_key or not level_key or not value_key:
            continue
        try:
            dt = parse_iso(str(row[time_key]).strip())
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            level = float(row[level_key])
            value = float(row[value_key])
        except (ValueError, TypeError):
            continue
        if math.isfinite(value):
            output[dt.astimezone(timezone.utc)][level] = value
    return dict(output)


async def _fetch_ncep_variable(variable: str, latitude: float, longitude: float, start: datetime, end: datetime) -> dict[datetime, dict[float, float]]:
    combined: dict[datetime, dict[float, float]] = {}
    lon_360 = longitude % 360.0
    async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0), follow_redirects=True) as client:
        for year, part_start, part_end in _year_ranges(start, end):
            url = f"{NCEP_REANALYSIS_NCSS}/{variable}.{year}.nc"
            params = {
                "var": variable,
                "latitude": f"{latitude:.5f}",
                "longitude": f"{lon_360:.5f}",
                "time_start": utc_iso(part_start),
                "time_end": utc_iso(part_end),
                "accept": "csv",
            }
            response = await client.get(url, params=params)
            response.raise_for_status()
            parsed = _parse_ncss_csv(response.text, variable)
            combined.update(parsed)
    if not combined:
        raise ExternalServiceError(f"NOAA historical {variable}-wind archive returned no usable data")
    return combined


def _vertical_interp(profile: dict[float, float], altitude_m: float) -> float:
    samples = sorted(
        ((NCEP_PRESSURE_HEIGHT_M[level], value) for level, value in profile.items() if level in NCEP_PRESSURE_HEIGHT_M and math.isfinite(value)),
        key=lambda item: item[0],
    )
    if not samples:
        raise ExternalServiceError("Historical wind profile contained no supported pressure levels")
    if altitude_m <= samples[0][0]:
        return samples[0][1]
    if altitude_m >= samples[-1][0]:
        return samples[-1][1]
    for (a0, v0), (a1, v1) in zip(samples, samples[1:]):
        if a0 <= altitude_m <= a1:
            f = (altitude_m - a0) / max(a1 - a0, 1e-9)
            return v0 + (v1 - v0) * f
    return samples[-1][1]


def _wind_at(profiles: dict[datetime, dict[float, float]], when: datetime, altitude_m: float) -> float:
    times = sorted(profiles)
    if not times:
        raise ExternalServiceError("Historical wind archive contained no times")
    when = _as_utc(when)
    if when <= times[0]:
        return _vertical_interp(profiles[times[0]], altitude_m)
    if when >= times[-1]:
        return _vertical_interp(profiles[times[-1]], altitude_m)
    for t0, t1 in zip(times, times[1:]):
        if t0 <= when <= t1:
            v0 = _vertical_interp(profiles[t0], altitude_m)
            v1 = _vertical_interp(profiles[t1], altitude_m)
            f = (when - t0).total_seconds() / max((t1 - t0).total_seconds(), 1.0)
            return v0 + (v1 - v0) * f
    return _vertical_interp(profiles[times[-1]], altitude_m)


def _advect(latitude: float, longitude: float, u_ms: float, v_ms: float, seconds: float) -> tuple[float, float]:
    radius = 6_371_000.0
    lat_rad = math.radians(latitude)
    new_lat = latitude + math.degrees(v_ms * seconds / radius)
    cos_lat = max(0.05, abs(math.cos(lat_rad)))
    new_lon = longitude + math.degrees(u_ms * seconds / (radius * cos_lat))
    return max(-89.999, min(89.999, new_lat)), to_map_lon(new_lon)


def _historical_point(latitude: float, longitude: float, altitude_m: float, when: datetime) -> dict[str, Any]:
    return {"latitude": latitude, "longitude": longitude, "altitude": altitude_m, "datetime": utc_iso(when)}


def _integrate_vertical_stage(
    stage: str,
    latitude: float,
    longitude: float,
    altitude_m: float,
    when: datetime,
    target_altitude_m: float,
    vertical_rate_fn,
    u_profiles: dict[datetime, dict[float, float]],
    v_profiles: dict[datetime, dict[float, float]],
    step_s: float,
) -> tuple[list[dict[str, Any]], float, float, float, datetime]:
    points = [_historical_point(latitude, longitude, altitude_m, when)]
    ascending = target_altitude_m > altitude_m
    for _ in range(5000):
        remaining = abs(target_altitude_m - altitude_m)
        if remaining <= 0.5:
            break
        rate = max(0.1, float(vertical_rate_fn(altitude_m)))
        dt = min(step_s, remaining / rate)
        sign = 1.0 if ascending else -1.0
        mid_alt = altitude_m + sign * rate * dt / 2.0
        mid_time = when + timedelta(seconds=dt / 2.0)
        u = _wind_at(u_profiles, mid_time, mid_alt)
        v = _wind_at(v_profiles, mid_time, mid_alt)
        latitude, longitude = _advect(latitude, longitude, u, v, dt)
        altitude_m += sign * rate * dt
        when += timedelta(seconds=dt)
        if (ascending and altitude_m > target_altitude_m) or ((not ascending) and altitude_m < target_altitude_m):
            altitude_m = target_altitude_m
        points.append(_historical_point(latitude, longitude, altitude_m, when))
        if abs(altitude_m - target_altitude_m) <= 0.5:
            break
    return points, latitude, longitude, altitude_m, when


async def run_historical_reanalysis(req: PredictRequest, extra_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """Historical fallback using NOAA/PSL NCEP/NCAR Reanalysis 1 upper-air winds.

    NCEP/NCAR Reanalysis 1 is a 2.5-degree, 4-times-daily reanalysis. It is ideal
    for replay/analysis, but is intentionally labelled as a coarser historical
    reconstruction rather than presented as equivalent to a current high-resolution
    Tawhiri forecast.
    """
    dt = _as_utc(req.launch_datetime)
    if dt < NCEP_REANALYSIS_START or dt > NCEP_REANALYSIS_END:
        raise ExternalServiceError(
            "NOAA NCEP/NCAR Reanalysis fallback is available from 1948-01-01 through 2026-03-17. "
            "Tawhiri did not have an archived model cycle for this date."
        )
    start, end = _ncep_time_window(req)
    u_profiles, v_profiles = await asyncio.gather(
        _fetch_ncep_variable("uwnd", req.launch.latitude, req.launch.longitude, start, end),
        _fetch_ncep_variable("vwnd", req.launch.latitude, req.launch.longitude, start, end),
    )
    latitude = req.launch.latitude
    longitude = req.launch.longitude
    launch_alt = float(req.launch.altitude_m or 0.0)
    altitude = launch_alt
    when = dt
    features: list[dict[str, Any]] = []
    common = {
        "mode": req.mode,
        "launch_name": req.launch.name,
        "dataset": f"NOAA NCEP/NCAR Reanalysis 1 {dt:%Y-%m-%d}",
        "historical": True,
        "historical_source": "NOAA/PSL NCEP/NCAR Reanalysis 1",
        "approximation": "Historical replay uses 4x-daily 2.5° reanalysis winds with vertical interpolation through 17 pressure levels.",
    }
    if extra_meta:
        common.update(extra_meta)

    target = req.burst_altitude_m if req.mode == "burst" else req.float_altitude_m
    ascent, latitude, longitude, altitude, when = _integrate_vertical_stage(
        "ascent", latitude, longitude, altitude, when, target,
        lambda _alt: req.ascent_rate_ms, u_profiles, v_profiles, 60.0,
    )
    features.append(stage_feature("ascent", ascent, common))

    if req.mode == "float":
        float_points = [_historical_point(latitude, longitude, altitude, when)]
        remaining = req.float_duration_min * 60.0
        for _ in range(2000):
            if remaining <= 0.5:
                break
            dt_s = min(60.0, remaining)
            mid_time = when + timedelta(seconds=dt_s / 2.0)
            mid_alt = altitude + req.float_ascent_rate_ms * dt_s / 2.0
            u = _wind_at(u_profiles, mid_time, mid_alt)
            v = _wind_at(v_profiles, mid_time, mid_alt)
            latitude, longitude = _advect(latitude, longitude, u, v, dt_s)
            altitude += req.float_ascent_rate_ms * dt_s
            when += timedelta(seconds=dt_s)
            remaining -= dt_s
            float_points.append(_historical_point(latitude, longitude, altitude, when))
        features.append(stage_feature("float", float_points, common))

    # Terminal descent speed scales roughly with sqrt(1/rho). The user's descent
    # input remains the sea-level terminal rate, matching the operational UI.
    ground_alt = launch_alt
    descent, latitude, longitude, altitude, when = _integrate_vertical_stage(
        "descent", latitude, longitude, altitude, when, ground_alt,
        lambda alt: req.descent_rate_ms * math.exp(max(0.0, alt - ground_alt) / 17_000.0),
        u_profiles, v_profiles, 30.0,
    )
    features.append(stage_feature("descent", descent, common))
    summary = summarize(features, common)
    return {
        "type": "FeatureCollection", "features": features, "summary": summary,
        "request": {"dataset": common["dataset"], "source": common["historical_source"], "historical": True},
    }


async def _prediction_with_historical_fallback(req: PredictRequest, mode: str, extra_meta: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Return a NOAA fallback only when an older Tawhiri archive is unavailable."""
    if _as_utc(req.launch_datetime) >= datetime.now(timezone.utc) - timedelta(hours=8):
        return None
    try:
        if mode == "burst":
            return await run_historical_reanalysis(req, extra_meta)
        return await run_historical_reanalysis(req, extra_meta)
    except ExternalServiceError:
        raise


async def fetch_launch_weather(
    latitude: float,
    longitude: float,
    launch_datetime: datetime,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Surface launch weather from Open-Meteo forecast/historical archives."""
    dt = _as_utc(launch_datetime)
    cache_key = (round(latitude, 3), round(longitude, 3), dt.strftime("%Y-%m-%dT%H"))
    cached = _weather_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < WEATHER_CACHE_TTL_S:
        return dict(cached[1])

    now = datetime.now(timezone.utc)
    endpoints: list[tuple[str, str]]
    if now - timedelta(days=5) <= dt <= now + timedelta(days=7):
        endpoints = [(OPEN_METEO_FORECAST_URL, "Open-Meteo Forecast")]
    elif dt >= datetime(2021, 1, 1, tzinfo=timezone.utc):
        endpoints = [
            (OPEN_METEO_HISTORICAL_FORECAST_URL, "Open-Meteo Historical Forecast"),
            (OPEN_METEO_ARCHIVE_URL, "Open-Meteo Historical Weather"),
        ]
    else:
        endpoints = [(OPEN_METEO_ARCHIVE_URL, "Open-Meteo Historical Weather")]

    params = {
        "latitude": latitude, "longitude": longitude,
        "hourly": "temperature_2m,precipitation,rain,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,surface_pressure",
        "start_date": dt.date().isoformat(), "end_date": dt.date().isoformat(),
        "timezone": "UTC", "temperature_unit": "fahrenheit", "wind_speed_unit": "mph", "precipitation_unit": "inch",
    }
    async def load(active_client: httpx.AsyncClient) -> dict[str, Any]:
        last_error: Exception | None = None
        for endpoint, source_name in endpoints:
            try:
                response = await active_client.get(endpoint, params=params)
                response.raise_for_status()
                payload = response.json()
                hourly = payload.get("hourly") or {}
                times = hourly.get("time") or []
                if not times:
                    raise ExternalServiceError("weather archive returned no hourly values")
                parsed_times: list[tuple[int, datetime]] = []
                for source_index, raw_time in enumerate(times):
                    try:
                        parsed = datetime.fromisoformat(str(raw_time))
                    except ValueError:
                        continue
                    if parsed.tzinfo is None:
                        parsed = parsed.replace(tzinfo=timezone.utc)
                    else:
                        parsed = parsed.astimezone(timezone.utc)
                    parsed_times.append((source_index, parsed))
                if not parsed_times:
                    raise ExternalServiceError("weather archive returned unreadable times")
                idx, selected_time = min(parsed_times, key=lambda item: abs((item[1] - dt).total_seconds()))

                def at(name: str) -> Any:
                    values = hourly.get(name) or []
                    return values[idx] if idx < len(values) else None

                rain_in = float(at("rain") or 0.0)
                precipitation_in = float(at("precipitation") or 0.0)
                result = {
                    "datetime": utc_iso(selected_time), "source": source_name,
                    "latitude": float(payload.get("latitude", latitude)), "longitude": float(payload.get("longitude", longitude)),
                    "temperature_f": at("temperature_2m"), "wind_speed_mph": at("wind_speed_10m"),
                    "wind_direction_deg": at("wind_direction_10m"), "wind_gust_mph": at("wind_gusts_10m"),
                    "rain_in": rain_in, "precipitation_in": precipitation_in,
                    "rain": bool(rain_in > 0.0), "weather_code": at("weather_code"),
                    "surface_pressure_hpa": at("surface_pressure"),
                    "historical": dt < now - timedelta(hours=8),
                }
                _weather_cache[cache_key] = (time.monotonic(), result)
                return dict(result)
            except (httpx.HTTPError, ValueError, ExternalServiceError) as exc:
                last_error = exc
        raise ExternalServiceError(f"Launch weather could not be loaded: {last_error}")

    if client is not None:
        return await load(client)
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=7.0), follow_redirects=True) as owned_client:
        return await load(owned_client)


def _weather_feature(site: WeatherSite, weather: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [site.longitude, site.latitude]},
        "properties": {"site_id": site.site_id, "site_name": site.name, **weather},
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
    try:
        raw, historical_cycle = await tawhiri_for_launch(params, req.launch_datetime)
    except ExternalServiceError as tawhiri_error:
        if _as_utc(req.launch_datetime) < datetime.now(timezone.utc) - timedelta(hours=8):
            try:
                return await run_historical_reanalysis(req, extra_meta)
            except ExternalServiceError as archive_error:
                raise ExternalServiceError(f"Historical Tawhiri replay failed ({tawhiri_error}); NOAA fallback failed ({archive_error})") from archive_error
        raise
    common = {
        "mode": "burst",
        "launch_name": req.launch.name,
        "dataset": raw.get("request", {}).get("dataset"),
        "historical": historical_cycle,
        "historical_source": "Tawhiri archived model cycle" if historical_cycle else None,
    }
    if extra_meta:
        common.update(extra_meta)
    features = [
        stage_feature("ascent", prediction_trajectory(raw, "ascent", 0), common),
        stage_feature("descent", prediction_trajectory(raw, "descent", 1), common),
    ]
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
    try:
        first, historical_cycle = await tawhiri_for_launch(first_params, req.launch_datetime)
    except ExternalServiceError as tawhiri_error:
        if _as_utc(req.launch_datetime) < datetime.now(timezone.utc) - timedelta(hours=8):
            try:
                return await run_historical_reanalysis(req, extra_meta)
            except ExternalServiceError as archive_error:
                raise ExternalServiceError(f"Historical Tawhiri replay failed ({tawhiri_error}); NOAA fallback failed ({archive_error})") from archive_error
        raise
    ascent = prediction_trajectory(first, "ascent", 0)
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
    if historical_cycle and first.get("request", {}).get("dataset"):
        second_params["dataset"] = first["request"]["dataset"]
    try:
        second = await tawhiri_request(second_params)
        float_trajectory = prediction_trajectory(second, "ascent", 0)
        descent_trajectory = prediction_trajectory(second, "descent", 1)
    except ExternalServiceError as tawhiri_error:
        if _as_utc(req.launch_datetime) < datetime.now(timezone.utc) - timedelta(hours=8):
            try:
                return await run_historical_reanalysis(req, extra_meta)
            except ExternalServiceError as archive_error:
                raise ExternalServiceError(
                    f"Historical Tawhiri float replay failed ({tawhiri_error}); "
                    f"NOAA fallback failed ({archive_error})"
                ) from archive_error
        raise
    common = {
        "mode": "float",
        "launch_name": req.launch.name,
        "dataset": second.get("request", {}).get("dataset") or first.get("request", {}).get("dataset"),
        "float_altitude_m": req.float_altitude_m,
        "float_ascent_rate_ms": req.float_ascent_rate_ms,
        "float_duration_min": req.float_duration_min,
        "historical": historical_cycle,
        "historical_source": "Tawhiri archived model cycle" if historical_cycle else None,
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


def launch_city(feature: dict[str, Any]) -> str:
    props = feature.get("properties") or {}
    for key in ("city", "municipality", "CITY"):
        value = str(props.get(key) or "").strip()
        if value:
            return value
    parts = [part.strip() for part in str(props.get("address") or "").split(",") if part.strip()]
    if len(parts) >= 3:
        return parts[-2]
    if len(parts) >= 2:
        return parts[1]
    return ""


def launch_feature_key(feature: dict[str, Any]) -> tuple[str, int, int]:
    """Return a stable operational key for a preset launch location.

    The predictor UI is city-based: operators should see exactly one preset row per
    launch city. Historical BPP sources contain multiple records for several cities
    (not only Clear Spring/Cumberland), so de-duplicate *all* preset locations by city.
    Manually drawn custom sites are not passed through this function and remain unique.
    """
    props = feature.get("properties") or {}
    city = launch_city(feature).casefold()
    coords = (feature.get("geometry") or {}).get("coordinates") or [0, 0]
    name = str(props.get("name") or props.get("address") or "").strip().casefold()
    if city:
        return f"canonical-city:{city}", 0, 0
    try:
        lon_key = round(float(coords[0]) * 10000); lat_key = round(float(coords[1]) * 10000)
    except (TypeError, ValueError, IndexError):
        lon_key = lat_key = 0
    return f"uncategorized:{name}", lon_key, lat_key

def merge_launch_collections(*collections: dict[str, Any]) -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int]] = set()
    for collection in collections:
        for feature in collection.get("features", []) if isinstance(collection, dict) else []:
            key = launch_feature_key(feature)
            if key in seen:
                continue
            seen.add(key)
            copied = {**feature, "properties": dict(feature.get("properties") or {})}
            city = launch_city(copied)
            if city:
                copied["properties"].setdefault("city", city)
            out.append(copied)
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

    # Bundled entries contain the canonical operational coordinates for the core
    # BPP sites (including Clear Spring, Cumberland, Hancock, Chambersburg, and
    # Emmitsburg), so let those win before merging the historical/cache sources.
    merged = merge_launch_collections(bundled, *collections)
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
    # backwards-compatible alias from v2.5
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


OPTIMAL_AIRSPACE_LAYERS = ("controlled", "class_e", "sua", "tfr")
AIRSPACE_VERTICAL_TOLERANCE_M = 30.0  # ignore tiny ceiling/boundary numerical noise

# Re-running the same optimal-site request within a short window should be instant.
# This cache is deliberately brief so updated launch settings/FAA data are not masked.
_OPTIMAL_RESULT_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
OPTIMAL_RESULT_CACHE_TTL_S = 120.0


def _parse_altitude_value_m(value: Any, unit: Any = None, code: Any = None, *, upper: bool = False) -> float | None:
    """Best-effort FAA altitude normalization to meters MSL.

    FAA class/SUA feeds normally provide numeric LOWER_VAL/UPPER_VAL values in feet,
    sometimes with FL/SFC/UNL codes. Unknown values intentionally return None so the
    scorer remains conservative instead of silently inventing a ceiling.
    """
    text = " ".join(str(x or "") for x in (value, unit, code)).upper().strip()
    if "UNL" in text or "UNLIMIT" in text:
        return math.inf
    if "SFC" in text or "SURFACE" in text:
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        m = re.search(r"(-?\d+(?:\.\d+)?)", str(value or ""))
        if not m:
            return None
        number = float(m.group(1))
    u = str(unit or code or "").upper()
    code_text = str(code or "").upper()
    # FAA's ADIZ/SFRA feed can encode standard-pressure ceilings with an implied
    # decimal. Example: UPPER_VAL=180000, UPPER_CODE=STD means FL180 (~18,000 ft),
    # not 180,000 ft. Normalize those values before any 3-D scoring/rendering.
    if "STD" in code_text and abs(number) >= 100000:
        return (number / 10.0) * 0.3048
    if "FL" in u or str(value or "").upper().startswith("FL"):
        return number * 100.0 * 0.3048
    if u in {"M", "METER", "METERS", "METRE", "METRES"} or "METER" in u or "METRE" in u:
        return number
    # FAA airspace altitude values are feet unless explicitly identified otherwise.
    return number * 0.3048


def _airspace_vertical_bounds_m(feature: dict[str, Any], layer: str) -> tuple[float, float]:
    props = feature.get("properties") or {}
    lower_val = next((props.get(k) for k in ("LOWER_VAL","LOWER_ALT","LOWER","LOWER_LIMIT","lower_val","lower_alt") if props.get(k) not in (None,"")), None)
    upper_val = next((props.get(k) for k in ("UPPER_VAL","UPPER_ALT","UPPER","UPPER_LIMIT","upper_val","upper_alt") if props.get(k) not in (None,"")), None)
    lower_unit = next((props.get(k) for k in ("LOWER_UOM","LOWER_UNIT","LOWER_CODE","lower_uom","lower_unit","lower_code") if props.get(k) not in (None,"")), None)
    upper_unit = next((props.get(k) for k in ("UPPER_UOM","UPPER_UNIT","UPPER_CODE","upper_uom","upper_unit","upper_code") if props.get(k) not in (None,"")), None)
    lower = _parse_altitude_value_m(lower_val, lower_unit, props.get("LOWER_CODE"))
    upper = _parse_altitude_value_m(upper_val, upper_unit, props.get("UPPER_CODE"), upper=True)
    # Missing vertical metadata stays conservative for SUA/TFR and old fallback data.
    if lower is None:
        lower = 0.0
    if upper is None:
        upper = math.inf
    if upper < lower:
        lower, upper = upper, lower
    return float(lower), float(upper)


def annotate_airspace_verticals(collection: dict[str, Any], layer: str) -> dict[str, Any]:
    """Attach normalized meter bounds for consistent 3-D frontend rendering."""
    result = {"type": "FeatureCollection", "features": []}
    for feature in collection.get("features", []) if isinstance(collection, dict) else []:
        if not isinstance(feature, dict):
            continue
        item = dict(feature)
        props = dict(item.get("properties") or {})
        lower_m, upper_m = _airspace_vertical_bounds_m(item, layer)
        props["bpp_lower_m"] = 0.0 if not math.isfinite(lower_m) else lower_m
        # MapLibre cannot extrude to infinity; 60 km is a visual cap for UNL only.
        props["bpp_upper_m"] = 60000.0 if not math.isfinite(upper_m) else upper_m
        item["properties"] = props
        result["features"].append(item)
    return result


def _polygon_records(collection: dict[str, Any], layer: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for feature in collection.get("features", []) if isinstance(collection, dict) else []:
        geometry = feature.get("geometry") if isinstance(feature, dict) else None
        if not geometry:
            continue
        try:
            geom = shape(geometry)
        except Exception:
            continue
        if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        lower_m, upper_m = _airspace_vertical_bounds_m(feature, layer)
        records.append({"geometry": geom, "lower_m": lower_m, "upper_m": upper_m, "feature": feature, "layer": layer})
    return records


def build_airspace_spatial_indexes(collections: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Build reusable R-trees once for a full optimal-site sweep.

    Each spatial record keeps the FAA vertical floor/ceiling. This prevents a HAB
    trajectory at 50,000+ ft from being marked as conflicting with a Class D circle
    whose ceiling is only a few thousand feet MSL.
    """
    layers: dict[str, dict[str, Any]] = {}
    all_records: list[dict[str, Any]] = []
    for layer, collection in collections.items():
        records = _polygon_records(collection, layer)
        geoms = [r["geometry"] for r in records]
        layers[layer] = {"records": records, "geometries": geoms, "tree": STRtree(geoms) if geoms else None}
        all_records.extend(records)
    all_geometries = [r["geometry"] for r in all_records]
    return {
        "layers": layers,
        "all": {"records": all_records, "geometries": all_geometries, "tree": STRtree(all_geometries) if all_geometries else None},
    }


def _queried_geometries(index: dict[str, Any], geometry: Any) -> list[Any]:
    tree = index.get("tree")
    geometries = index.get("geometries") or []
    if tree is None or not geometries:
        return []
    try:
        indices = tree.query(geometry, predicate="intersects")
        return [geometries[int(i)] for i in indices]
    except Exception:
        raw = tree.query(geometry)
        out = []
        for item in raw:
            geom = item if hasattr(item, "geom_type") else geometries[int(item)]
            if geometry.intersects(geom):
                out.append(geom)
        return out


def _queried_records(index: dict[str, Any], geometry: Any) -> list[dict[str, Any]]:
    tree = index.get("tree")
    records = index.get("records") or []
    if tree is None or not records:
        return []
    try:
        indices = tree.query(geometry, predicate="intersects")
        return [records[int(i)] for i in indices]
    except Exception:
        geoms = index.get("geometries") or []
        raw = tree.query(geometry)
        out: list[dict[str, Any]] = []
        for item in raw:
            idx = geoms.index(item) if hasattr(item, "geom_type") else int(item)
            record = records[idx]
            if geometry.intersects(record["geometry"]):
                out.append(record)
        return out


def _geometry_haversine_length_m(geometry: Any) -> float:
    if geometry is None or geometry.is_empty:
        return 0.0
    if geometry.geom_type in ("LineString", "LinearRing"):
        coords = list(geometry.coords)
        return sum(
            haversine_m((float(a[1]), float(a[0])), (float(b[1]), float(b[0])))
            for a, b in zip(coords, coords[1:])
        )
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        return sum(_geometry_haversine_length_m(part) for part in geometry.geoms)
    return 0.0


def _prediction_segments(prediction: dict[str, Any]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for feature in prediction.get("features", []):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        for a, b in zip(coords, coords[1:]):
            try:
                lon1, lat1 = float(a[0]), float(a[1]); alt1 = float(a[2]) if len(a) > 2 else 0.0
                lon2, lat2 = float(b[0]), float(b[1]); alt2 = float(b[2]) if len(b) > 2 else alt1
                line = LineString([(lon1, lat1), (lon2, lat2)])
            except (TypeError, ValueError, IndexError):
                continue
            if not line.is_empty and line.length > 0:
                segments.append({"line": line, "alt1_m": alt1, "alt2_m": alt2})
    return segments


def _interval_vertical_fraction(alt1: float, alt2: float, lower: float, upper: float) -> float:
    if lower <= min(alt1, alt2) and max(alt1, alt2) <= upper:
        return 1.0
    if max(alt1, alt2) < lower or min(alt1, alt2) > upper:
        return 0.0
    if abs(alt2 - alt1) < 1e-9:
        return 1.0 if lower <= alt1 <= upper else 0.0
    u1 = (lower - alt1) / (alt2 - alt1) if math.isfinite(lower) else -math.inf
    u2 = (upper - alt1) / (alt2 - alt1) if math.isfinite(upper) else math.inf
    lo = max(0.0, min(u1, u2)); hi = min(1.0, max(u1, u2))
    return max(0.0, hi - lo)


def _line_parts(geometry: Any) -> list[Any]:
    if geometry is None or geometry.is_empty:
        return []
    if geometry.geom_type in ("LineString", "LinearRing"):
        return [geometry]
    if geometry.geom_type in ("MultiLineString", "GeometryCollection"):
        out: list[Any] = []
        for part in geometry.geoms:
            out.extend(_line_parts(part))
        return out
    return []


def _segment_record_intrusion_m(segment: dict[str, Any], record: dict[str, Any]) -> float:
    line = segment["line"]
    try:
        intersection = line.intersection(record["geometry"])
    except Exception:
        return 0.0
    total = 0.0
    for part in _line_parts(intersection):
        coords = list(part.coords)
        if len(coords) < 2:
            continue
        p0, p1 = Point(coords[0]), Point(coords[-1])
        try:
            t0 = float(line.project(p0, normalized=True)); t1 = float(line.project(p1, normalized=True))
        except Exception:
            t0, t1 = 0.0, 1.0
        a0 = segment["alt1_m"] + (segment["alt2_m"] - segment["alt1_m"]) * t0
        a1 = segment["alt1_m"] + (segment["alt2_m"] - segment["alt1_m"]) * t1
        crossing_min_alt = min(a0, a1)
        crossing_max_alt = max(a0, a1)
        # Horizontal overlap is not a conflict when the balloon is above the FAA
        # feature's maximum altitude at the actual crossing. This is the core HAB
        # overflight rule: compare trajectory altitude *where it crosses the polygon*,
        # not the polygon footprint alone.
        if math.isfinite(record["upper_m"]) and crossing_min_alt > record["upper_m"] + AIRSPACE_VERTICAL_TOLERANCE_M:
            continue
        if crossing_max_alt < record["lower_m"] - AIRSPACE_VERTICAL_TOLERANCE_M:
            continue
        vertical_fraction = _interval_vertical_fraction(a0, a1, record["lower_m"], record["upper_m"])
        if vertical_fraction <= 0:
            continue
        total += _geometry_haversine_length_m(part) * vertical_fraction
    return total


def _segment_intrusion_m(segment: dict[str, Any], index: dict[str, Any]) -> float:
    records = _queried_records(index, segment["line"])
    if not records:
        return 0.0
    # Summing record intersections can double-count overlapping polygons. For HAB site
    # classification this is acceptable only at the layer detail level; the all-layer
    # total uses the maximum conservative estimate bounded by the segment length.
    total = sum(_segment_record_intrusion_m(segment, record) for record in records)
    return min(total, _geometry_haversine_length_m(segment["line"]))


def score_prediction_against_airspace(prediction: dict[str, Any], indexes: dict[str, Any]) -> dict[str, Any]:
    """Score real 3-D trajectory interference with FAA airspace.

    Horizontal polygon overlap only counts when the balloon altitude overlaps the
    feature's vertical floor/ceiling. This fixes the prior false-red behavior where
    a high-altitude balloon merely passing above a Class B/C/D polygon was marked
    as an airspace violation.
    """
    segments = _prediction_segments(prediction)
    if not segments:
        raise ValueError("Prediction contained no trajectory to score against airspace")
    by_layer = {layer: 0.0 for layer in indexes.get("layers", {})}
    total = 0.0
    for segment in segments:
        total += _segment_intrusion_m(segment, indexes.get("all", {}))
        for layer, index in indexes.get("layers", {}).items():
            by_layer[layer] += _segment_intrusion_m(segment, index)
    # Ignore tiny GIS boundary slivers/rounding artifacts.
    total = 0.0 if total < 25.0 else total
    by_layer = {layer: (0.0 if value < 25.0 else value) for layer, value in by_layer.items()}
    conflicts = [layer for layer, value in by_layer.items() if value > 0]
    return {
        "airspace_intrusion_m": total,
        "airspace_intrusion_by_layer_m": by_layer,
        "conflict_layers": conflicts,
        "clear_of_airspace": total == 0.0,
    }


def _high_risk_airspace_index(collections: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Build the landing no-go index used by the site classifier.

    Restricted (R) controlled airspace is rendered red in the map. Special-use
    airspace and active TFRs are also treated conservatively as landing no-go zones.
    """
    geometries: list[Any] = []
    for layer, collection in collections.items():
        for feature in collection.get("features", []) if isinstance(collection, dict) else []:
            props = feature.get("properties") or {}
            high_risk = layer in {"sua", "tfr"}
            if layer == "controlled":
                local_type = str(props.get("LOCAL_TYPE") or props.get("local_type") or "").upper()
                high_risk = local_type in {"R", "RESTRICTED"}
            if not high_risk:
                continue
            geometry = feature.get("geometry") or {}
            try:
                geom = shape(geometry)
            except Exception:
                continue
            if not geom.is_empty and geom.geom_type in ("Polygon", "MultiPolygon"):
                geometries.append(geom)
    return {"geometries": geometries, "tree": STRtree(geometries) if geometries else None}


def landing_in_high_risk_airspace(prediction: dict[str, Any], index: dict[str, Any]) -> bool:
    landing = (prediction.get("summary") or {}).get("landing") or {}
    try:
        point = Point(float(landing["longitude"]), float(landing["latitude"]))
    except (KeyError, TypeError, ValueError):
        return False
    return bool(_queried_geometries(index, point))


def default_ascent_rate_sweep(current: float) -> list[float]:
    """Current rate first, then practical +/-0.5 and +/-1.0 m/s adjustments."""
    values = [current, current - 0.5, current + 0.5, current - 1.0, current + 1.0]
    out: list[float] = []
    for value in values:
        value = round(float(value), 3)
        if 0 < value <= 20 and value not in out:
            out.append(value)
    return out


def preferred_site_priority(name: str) -> int:
    """Operational preference only; distance is intentionally never considered."""
    value = str(name or "").strip().casefold()
    if value == "clear spring" or value.startswith("clear spring "):
        return 0
    if value == "hancock" or value.startswith("hancock "):
        return 1
    return 99


def optimal_site_sort_key(candidate: dict[str, Any]) -> tuple[int, int, float, float]:
    """Rank by airspace safety and BPP preference, never by driving distance.

    A viable Clear Spring/Hancock result is preferred (Clear Spring first when both
    are viable). All other viable sites are equivalent from a site-selection
    perspective; red/no-go sites fall behind and are ordered only by airspace harm.
    """
    viable = bool(candidate.get("viable"))
    preference = preferred_site_priority(candidate.get("site_name", "")) if candidate.get("preferred") else 99
    adjustment = float(candidate.get("ascent_rate_adjustment_ms") or 0.0)
    if viable and preference < 99:
        return (0, preference, adjustment, 0.0)
    if viable:
        return (1, 0, adjustment, 0.0)
    return (
        2,
        1 if candidate.get("landing_in_high_risk_airspace") else 0,
        float(candidate.get("best_airspace_intrusion_m") or candidate.get("airspace_intrusion_m") or 0.0),
        adjustment,
    )

def validate_launch_window(value: datetime) -> None:
    """Accept only current/future launches inside the seven-day model window."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if value < now - timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="Past predictions are not supported. Choose the current time or a future launch time.")
    if value > now + timedelta(days=7):
        raise HTTPException(status_code=400, detail="Launch time may be at most 7 days in the future.")


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
        "optimal_site": "active/all-site viability ranking with crossing-altitude airspace checks and preferred-site gold logic",
        "prediction_window": "current time through 7 days in the future",
        "launch_weather": "Open-Meteo forecast",
    }


@app.get("/api/config")
async def config():
    return {
        "callsigns": DEFAULT_CALLSIGNS, "default_callsigns": DEFAULT_CALLSIGNS,
        "max_live_callsigns": MAX_LIVE_CALLSIGNS, "prediction_modes": ["burst", "float"],
        "aprs_configured": bool(APRSFI_API_KEY), "aprs_credit": {"name": "aprs.fi", "url": "https://aprs.fi/"},
        "airspace_layers": ["controlled", "class_e", "sua", "tfr"],
        "prediction_window_days": 7,
        "weather": True,
    }


@app.get("/api/launch-locations")
async def launch_locations():
    data, warnings, sources = await operational_launch_locations()
    return {"data": data, "warning": "; ".join(dict.fromkeys(warnings)) if warnings else None, "sources": sources, "count": len(data.get("features", []))}


@app.get("/api/airspace/{dataset}")
async def airspace(dataset: Literal["controlled", "class_e", "sua", "tfr", "uncontrolled"], refresh: bool = Query(default=False)):
    data, warning, source = await operational_airspace(dataset, force=refresh)
    normalized_layer = "class_e" if dataset == "uncontrolled" else dataset
    data = annotate_airspace_verticals(data, normalized_layer)
    return {"data": data, "warning": warning, "source": source, "count": len(data.get("features", []))}


@app.get("/api/reference/{dataset}")
async def reference_data(dataset: Literal["schools", "mcdonalds", "dunkin", "launch_locations", "poi"]):
    data, warning = await operational_reference_data(dataset)
    return {"data": data, "warning": warning}


@app.get("/api/weather/site")
async def weather_site(
    latitude: float = Query(ge=-90, le=90),
    longitude: float = Query(ge=-180, le=180),
    launch_datetime: datetime = Query(),
):
    validate_launch_window(launch_datetime)
    try:
        return await fetch_launch_weather(latitude, longitude, launch_datetime)
    except ExternalServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/weather/batch")
async def weather_batch(req: WeatherBatchRequest):
    validate_launch_window(req.launch_datetime)
    semaphore = asyncio.Semaphore(8)
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=7.0), follow_redirects=True) as client:
        async def one(site: WeatherSite) -> dict[str, Any]:
            async with semaphore:
                try:
                    weather = await fetch_launch_weather(
                        site.latitude, site.longitude, req.launch_datetime, client=client
                    )
                    return {"site_id": site.site_id, "name": site.name, "weather": weather, "error": None}
                except Exception as exc:
                    return {"site_id": site.site_id, "name": site.name, "weather": None, "error": str(exc)}

        results = await asyncio.gather(*(one(site) for site in req.sites))
    features = [_weather_feature(site, item["weather"]) for site, item in zip(req.sites, results) if item.get("weather")]
    return {"results": results, "data": {"type": "FeatureCollection", "features": features}}


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


@app.post("/api/inflation/calculate")
async def inflation_calculate(req: InflationRequest):
    try:
        return calculate_inflation(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/predict")
async def predict(req: PredictRequest):
    validate_launch_window(req.launch_datetime)
    try:
        if req.mode == "float":
            return await run_float(req)
        return await run_burst(req)
    except ExternalServiceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/optimal-site")
async def optimal_site(req: OptimalSiteRequest):
    """Evaluate supplied sites using altitude-aware airspace intersections.

    A site is viable when at least one requested ascent-rate scenario has no scored
    3-D airspace intrusion and its landing is outside restricted/SUA/TFR polygons.
    Gold is reserved exclusively for a viable preferred operational site: Clear
    Spring first, otherwise Hancock. Other viable sites are green; conflicts are red.
    Geographic distance to UMD (or anywhere else) is never part of the ranking.
    """
    validate_launch_window(req.launch_datetime)
    cache_key = req.model_dump_json()
    cached_result = _OPTIMAL_RESULT_CACHE.get(cache_key)
    if cached_result and time.monotonic() - cached_result[0] < OPTIMAL_RESULT_CACHE_TTL_S:
        cached_copy = json.loads(json.dumps(cached_result[1]))
        cached_copy["cache_hit"] = True
        return cached_copy

    layers = list(dict.fromkeys(req.airspace_layers))
    airspace_results = await asyncio.gather(
        *(operational_airspace(layer) for layer in layers), return_exceptions=True
    )
    collections: dict[str, dict[str, Any]] = {}
    warnings: list[str] = []
    sources: dict[str, str] = {}
    for layer, outcome in zip(layers, airspace_results):
        if isinstance(outcome, Exception):
            warnings.append(f"{layer}: {outcome}")
            collections[layer] = empty_fc(); sources[layer] = "unavailable"; continue
        data, warning, source = outcome
        collections[layer] = data; sources[layer] = source
        if warning: warnings.append(f"{layer}: {warning}")
    if not any(collection.get("features") for collection in collections.values()):
        raise HTTPException(status_code=503, detail="No FAA airspace data is available, so an optimal site cannot be ranked safely.")

    indexes = build_airspace_spatial_indexes(collections)
    high_risk_index = _high_risk_airspace_index(collections)
    semaphore = asyncio.Semaphore(10)
    sweep_rates = req.ascent_rate_sweep_ms or default_ascent_rate_sweep(req.ascent_rate_ms)
    if req.ascent_rate_ms not in sweep_rates:
        sweep_rates.insert(0, req.ascent_rate_ms)
    sweep_rates = sorted(dict.fromkeys(round(float(v), 3) for v in sweep_rates), key=lambda v: (abs(v - req.ascent_rate_ms), v))

    async def predict_at_rate(site: OptimalSiteCandidate, rate: float) -> dict[str, Any]:
        burst_altitude = req.burst_altitude_m
        if req.mode == "burst" and req.automatic_burst and req.inflation is not None:
            try:
                inflation_req = req.inflation.model_copy(update={"target_ascent_rate_ms": rate})
                burst_altitude = float(calculate_inflation(inflation_req)["burst_altitude_m"])
            except ValueError as exc:
                raise ExternalServiceError(f"Inflation model cannot use {rate:g} m/s: {exc}") from exc
        pred_req = PredictRequest(
            mode=req.mode,
            launch=LaunchPoint(name=site.name, latitude=site.latitude, longitude=site.longitude, altitude_m=site.altitude_m),
            launch_datetime=req.launch_datetime,
            ascent_rate_ms=rate,
            descent_rate_ms=req.descent_rate_ms,
            burst_altitude_m=burst_altitude,
            float_altitude_m=req.float_altitude_m,
            float_ascent_rate_ms=req.float_ascent_rate_ms,
            float_duration_min=req.float_duration_min,
        )
        async with semaphore:
            prediction = await (run_float(pred_req) if req.mode == "float" else run_burst(pred_req))
        score = score_prediction_against_airspace(prediction, indexes)
        high_risk_landing = landing_in_high_risk_airspace(prediction, high_risk_index)
        summary = prediction.get("summary") or {}
        return {
            "ascent_rate_ms": rate,
            "burst_altitude_m": burst_altitude,
            **score,
            "landing_in_high_risk_airspace": high_risk_landing,
            "landing": summary.get("landing"),
            "ground_distance_m": summary.get("ground_distance_m"),
            "clear_and_safe": bool(score["clear_of_airspace"] and not high_risk_landing),
        }

    async def evaluate(site: OptimalSiteCandidate) -> dict[str, Any]:
        scenarios: list[dict[str, Any]] = []
        scenario_errors: dict[str, str] = {}
        for rate in sweep_rates:
            try:
                scenario = await predict_at_rate(site, rate)
                scenarios.append(scenario)
                if scenario["clear_and_safe"]:
                    break
            except Exception as exc:
                scenario_errors[f"{rate:g}"] = str(exc)
        if not scenarios:
            raise ExternalServiceError(f"No ascent-rate scenario succeeded: {scenario_errors}")
        scenarios.sort(key=lambda x: (
            0 if x["clear_and_safe"] else 1,
            0 if not x["landing_in_high_risk_airspace"] else 1,
            float(x["airspace_intrusion_m"]),
            abs(float(x["ascent_rate_ms"]) - req.ascent_rate_ms),
        ))
        best = scenarios[0]
        viable = bool(best["clear_and_safe"])
        return {
            "site_id": site.site_id,
            "site_name": site.name,
            "latitude": site.latitude,
            "longitude": site.longitude,
            "preferred": bool(site.preferred and preferred_site_priority(site.name) < 99),
            "viable": viable,
            "no_go": not viable,
            "best_ascent_rate_ms": best["ascent_rate_ms"],
            "requested_ascent_rate_ms": req.ascent_rate_ms,
            "ascent_rate_adjustment_ms": abs(float(best["ascent_rate_ms"]) - req.ascent_rate_ms),
            "best_airspace_intrusion_m": best["airspace_intrusion_m"],
            "airspace_intrusion_m": best["airspace_intrusion_m"],
            "airspace_intrusion_by_layer_m": best["airspace_intrusion_by_layer_m"],
            "conflict_layers": best["conflict_layers"],
            "clear_of_airspace": best["clear_of_airspace"],
            "landing_in_high_risk_airspace": best["landing_in_high_risk_airspace"],
            "landing": best["landing"],
            "ground_distance_m": best["ground_distance_m"],
            "tested_ascent_rates_ms": [x["ascent_rate_ms"] for x in scenarios],
            "scenario_errors": scenario_errors,
        }

    outcomes = await asyncio.gather(*(evaluate(site) for site in req.launch_sites), return_exceptions=True)
    ranking: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    for site, outcome in zip(req.launch_sites, outcomes):
        if isinstance(outcome, Exception): errors[site.site_id] = str(outcome)
        else: ranking.append(outcome)
    if not ranking:
        raise HTTPException(status_code=502, detail=f"Every launch-site prediction failed: {errors}")

    ranking.sort(key=optimal_site_sort_key)
    gold_candidate = next(
        (candidate for candidate in ranking if candidate["viable"] and candidate.get("preferred") and preferred_site_priority(candidate["site_name"]) < 99),
        None,
    )
    for rank, candidate in enumerate(ranking, start=1):
        candidate["rank"] = rank
        candidate["optimal"] = bool(gold_candidate and candidate["site_id"] == gold_candidate["site_id"])
        if candidate["optimal"]:
            candidate["site_status"] = "best"
        elif candidate["viable"]:
            candidate["site_status"] = "viable"
        else:
            candidate["site_status"] = "no-go"

    viable_count = sum(1 for item in ranking if item["viable"])
    recommended = gold_candidate or next((item for item in ranking if item["viable"]), ranking[0])
    if gold_candidate:
        reason = f"{gold_candidate['site_name']} is a preferred BPP launch site and is viable; it is the gold recommendation. Distance is not used."
    elif viable_count:
        reason = "Clear Spring and Hancock are not viable under the tested settings. Other clear sites remain green; no gold site is assigned. Distance is not used."
    else:
        reason = "No tested site is fully viable. All evaluated sites remain red/no-go; no gold site is assigned. Distance is not used."

    response_payload = {
        "optimal_site_id": recommended["site_id"],
        "optimal_site_name": recommended["site_name"],
        "gold_site_id": gold_candidate["site_id"] if gold_candidate else None,
        "gold_site_name": gold_candidate["site_name"] if gold_candidate else None,
        "reason": reason,
        "ranking": ranking,
        "errors": errors,
        "viable_count": viable_count,
        "no_go_count": len(ranking) - viable_count,
        "ascent_rate_sweep_ms": sweep_rates,
        "airspace_layers": layers,
        "airspace_sources": sources,
        "warnings": warnings,
        "cache_hit": False,
    }
    _OPTIMAL_RESULT_CACHE[cache_key] = (time.monotonic(), response_payload)
    if len(_OPTIMAL_RESULT_CACHE) > 24:
        oldest = min(_OPTIMAL_RESULT_CACHE, key=lambda key: _OPTIMAL_RESULT_CACHE[key][0])
        _OPTIMAL_RESULT_CACHE.pop(oldest, None)
    return response_payload


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
