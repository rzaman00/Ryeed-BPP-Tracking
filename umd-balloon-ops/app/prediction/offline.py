from __future__ import annotations

from datetime import timedelta

from ..mathutils import destination, haversine_m
from ..models import LandingEstimate, PredictProfile, PredictionPoint, PredictionRequest, PredictionResult


class OfflinePredictor:
    """Deterministic no-network fallback.

    This is intentionally conservative and NOT a weather-model replacement. It exists so the
    application remains testable/useful when Tawhiri is unreachable. Its wind vector is supplied
    by the request and can later be replaced by GFS-derived winds.
    """

    name = "offline-vector"

    async def predict(self, req: PredictionRequest) -> PredictionResult:
        points: list[PredictionPoint] = []
        lat, lon, alt = req.launch_latitude, req.launch_longitude, req.launch_altitude_m
        now = req.launch_datetime
        step_s = 120

        def push(stage: str):
            points.append(PredictionPoint(timestamp=now, latitude=lat, longitude=lon, altitude_m=max(0, alt), stage=stage))

        def drift(seconds: float, factor: float = 1.0):
            nonlocal lat, lon
            lat, lon = destination(lat, lon, req.fallback_wind_speed_mps * seconds * factor, req.fallback_wind_bearing_deg)

        descending_now = req.current_vertical_rate_mps is not None and req.current_vertical_rate_mps < -1.0
        if descending_now:
            # Live-flight fallback: if telemetry says the payload is already descending, do not
            # invent a new ascent/burst stage. Start the recovery trajectory from the current fix.
            push("descent")
        else:
            push("ascent")
            target = req.burst_altitude_m if req.profile == PredictProfile.STANDARD else req.float_altitude_m
            ascent_rate = max(req.ascent_rate_mps, 0.1)
            while alt < target:
                dt = min(step_s, (target - alt) / ascent_rate)
                alt += ascent_rate * dt
                drift(dt, 0.75)
                now += timedelta(seconds=dt)
                push("ascent")

        if (not descending_now) and req.profile in (PredictProfile.FLOAT, PredictProfile.EXPERIMENTAL_FLOAT):
            if req.profile == PredictProfile.FLOAT:
                float_end = req.float_end_datetime or (now + timedelta(minutes=req.float_duration_min))
                float_rate = 0.0
            else:
                float_end = now + timedelta(minutes=req.float_duration_min)
                float_rate = req.float_ascent_rate_mps
            while now < float_end:
                dt = min(step_s, max(1, (float_end - now).total_seconds()))
                alt += float_rate * dt
                drift(dt, 1.0)
                now += timedelta(seconds=dt)
                push("float")
            if req.profile == PredictProfile.FLOAT:
                return PredictionResult(
                    provider=self.name,
                    profile=req.profile,
                    points=points,
                    warnings=["Offline vector predictor is not weather-aware; configure/live-connect Tawhiri for operational predictions."],
                    metadata={"wind_speed_mps": req.fallback_wind_speed_mps, "wind_bearing_deg": req.fallback_wind_bearing_deg},
                )

        descent_rate = max(req.descent_rate_mps, 0.1)
        while alt > 0:
            # A simple density-like correction: faster aloft, target sea-level rate near ground.
            effective = descent_rate * (1.0 + min(1.2, alt / 25000))
            dt = min(step_s, alt / effective)
            alt -= effective * dt
            drift(dt, 1.0)
            now += timedelta(seconds=dt)
            push("descent")

        path_m = sum(haversine_m(a.latitude, a.longitude, b.latitude, b.longitude) for a, b in zip(points, points[1:]))
        uncertainty = max(1500, min(30000, path_m * 0.12))
        landing = LandingEstimate(
            latitude=lat,
            longitude=lon,
            eta=now,
            uncertainty_m=uncertainty,
            confidence="LOW",
            uncertainty_method="offline-vector heuristic",
        )
        return PredictionResult(
            provider=self.name,
            profile=req.profile,
            points=points,
            landing=landing,
            warnings=["Offline vector predictor is not weather-aware; use it for UI/testing/failsafe only."],
            metadata={"wind_speed_mps": req.fallback_wind_speed_mps, "wind_bearing_deg": req.fallback_wind_bearing_deg},
        )
