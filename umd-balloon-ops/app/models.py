from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FlightState(str, Enum):
    PRELAUNCH = "PRELAUNCH"
    ASCENT = "ASCENT"
    FLOAT = "FLOAT"
    DESCENT = "DESCENT"
    LANDED = "LANDED"
    UNKNOWN = "UNKNOWN"


class TelemetryPoint(BaseModel):
    callsign: str = Field(min_length=1, max_length=64)
    timestamp: datetime
    received_at: datetime = Field(default_factory=utcnow)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float
    vertical_rate_mps: float | None = None
    ground_speed_mps: float | None = None
    heading_deg: float | None = Field(default=None, ge=0, le=360)
    source: str = "manual"
    receiver: str | None = None
    battery_v: float | None = None
    rssi: float | None = None
    raw: dict[str, Any] | None = None

    @field_validator("timestamp", "received_at")
    @classmethod
    def ensure_timezone(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)


class FlightSnapshot(BaseModel):
    callsign: str
    point: TelemetryPoint
    state: FlightState
    smoothed_vertical_rate_mps: float | None = None
    calculated_ground_speed_mps: float | None = None
    calculated_heading_deg: float | None = None
    telemetry_age_s: float = 0
    source_health: dict[str, float] = Field(default_factory=dict)
    alerts: list[str] = Field(default_factory=list)


class PredictProfile(str, Enum):
    STANDARD = "standard"
    FLOAT = "float"
    EXPERIMENTAL_FLOAT = "experimental_float"


class PredictProvider(str, Enum):
    AUTO = "auto"
    TAWHIRI = "tawhiri"
    OFFLINE = "offline"
    LOCAL_GFS = "local_gfs"


class PredictionRequest(BaseModel):
    profile: PredictProfile = PredictProfile.STANDARD
    provider: PredictProvider = PredictProvider.AUTO
    launch_latitude: float = Field(ge=-90, le=90)
    launch_longitude: float = Field(ge=-180, le=180)
    launch_datetime: datetime = Field(default_factory=utcnow)
    launch_altitude_m: float = 0
    ascent_rate_mps: float = Field(default=5.5, gt=0, le=30)
    burst_altitude_m: float = Field(default=28000, gt=0, le=60000)
    descent_rate_mps: float = Field(default=5.5, gt=0, le=50)
    float_altitude_m: float = Field(default=22000, gt=0, le=60000)
    float_end_datetime: datetime | None = None
    float_ascent_rate_mps: float = Field(default=0.5, ge=0, le=10)
    float_duration_min: int = Field(default=60, ge=1, le=2880)
    fallback_wind_speed_mps: float = Field(default=12, ge=0, le=80)
    fallback_wind_bearing_deg: float = Field(default=70, ge=0, le=360)
    current_vertical_rate_mps: float | None = None

    @field_validator("launch_datetime", "float_end_datetime")
    @classmethod
    def ensure_timezone(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc)

    @model_validator(mode="after")
    def check_altitudes(self):
        target = self.float_altitude_m if self.profile != PredictProfile.STANDARD else self.burst_altitude_m
        if target <= self.launch_altitude_m:
            raise ValueError("burst/float altitude must be above launch altitude")
        return self


class PredictionPoint(BaseModel):
    timestamp: datetime
    latitude: float
    longitude: float
    altitude_m: float
    stage: Literal["ascent", "float", "descent"]


class LandingEstimate(BaseModel):
    latitude: float
    longitude: float
    eta: datetime
    uncertainty_m: float
    confidence: Literal["HIGH", "MEDIUM", "LOW"]
    uncertainty_method: str = "heuristic"


class PredictionResult(BaseModel):
    provider: str
    profile: PredictProfile
    dataset: str | None = None
    generated_at: datetime = Field(default_factory=utcnow)
    points: list[PredictionPoint]
    landing: LandingEstimate | None = None
    warnings: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class BatchPredictionRequest(BaseModel):
    template: PredictionRequest
    locations: list[dict[str, Any]] = Field(min_length=1, max_length=50)


class EnsemblePredictionRequest(BaseModel):
    base: PredictionRequest
    members: int = Field(default=7, ge=3, le=9)


class WatchRequest(BaseModel):
    callsign: str
    source: Literal["sondehub"] = "sondehub"
    enabled: bool = True


class SimulationRequest(BaseModel):
    callsign: str = "UMD-DEMO"
    start_latitude: float = 39.0046
    start_longitude: float = -76.8755
    start_altitude_m: float = 60
    ascent_rate_mps: float = 5.5
    max_altitude_m: float = 28000
    descent_rate_mps: float = 8.0
    horizontal_speed_mps: float = 14.0
    heading_deg: float = 62
    interval_s: float = Field(default=1.0, ge=0.2, le=10)
    time_scale: float = Field(default=60.0, ge=1, le=600)


class SpotWatchRequest(BaseModel):
    callsign: str
    feed_id: str
    feed_password: str | None = None
    interval_s: int = Field(default=150, ge=150, le=3600)
    enabled: bool = True


class APRSWatchRequest(BaseModel):
    payload_callsign: str
    login_callsign: str
    passcode: str
    host: str = "rotate.aprs2.net"
    port: int = Field(default=14580, ge=1, le=65535)
    enabled: bool = True


class IridiumWebhook(BaseModel):
    callsign: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    altitude_m: float
    timestamp: datetime = Field(default_factory=utcnow)
    battery_v: float | None = None
    source_id: str | None = None
    extra: dict[str, Any] = Field(default_factory=dict)
