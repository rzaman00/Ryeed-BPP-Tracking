from __future__ import annotations

from datetime import datetime, timedelta, timezone
import httpx

from ..config import settings
from ..mathutils import haversine_m
from ..models import LandingEstimate, PredictProfile, PredictionPoint, PredictionRequest, PredictionResult


class TawhiriError(RuntimeError):
    pass


class TawhiriPredictor:
    name = "tawhiri"

    def __init__(self):
        self.client = httpx.AsyncClient(timeout=settings.request_timeout_s, follow_redirects=True)

    @staticmethod
    def _lon(lon: float) -> float:
        return lon + 360 if lon < 0 else lon

    async def _call(self, params: dict) -> dict:
        last_error = None
        for attempt in range(3):
            try:
                response = await self.client.get(settings.tawhiri_url, params=params)
                response.raise_for_status()
                data = response.json()
                if "error" in data:
                    raise TawhiriError(data["error"].get("description", str(data["error"])))
                if "prediction" not in data:
                    raise TawhiriError("Tawhiri returned no prediction")
                return data
            except (httpx.HTTPError, ValueError, TawhiriError) as exc:
                last_error = exc
                if attempt < 2:
                    import asyncio
                    await asyncio.sleep(0.35 * (2**attempt))
        raise TawhiriError(f"{type(last_error).__name__}: {last_error}")

    async def predict(self, req: PredictionRequest) -> PredictionResult:
        if req.profile == PredictProfile.EXPERIMENTAL_FLOAT:
            return await self._experimental_float(req)

        params = {
            "profile": "float_profile" if req.profile == PredictProfile.FLOAT else "standard_profile",
            "launch_latitude": req.launch_latitude,
            "launch_longitude": self._lon(req.launch_longitude),
            "launch_datetime": req.launch_datetime.isoformat().replace("+00:00", "Z"),
            "launch_altitude": req.launch_altitude_m,
            "ascent_rate": req.ascent_rate_mps,
        }
        if req.profile == PredictProfile.FLOAT:
            stop = req.float_end_datetime or (req.launch_datetime + timedelta(minutes=req.float_duration_min))
            params |= {"float_altitude": req.float_altitude_m, "stop_datetime": stop.isoformat().replace("+00:00", "Z")}
        else:
            params |= {"burst_altitude": req.burst_altitude_m, "descent_rate": req.descent_rate_mps}
        data = await self._call(params)
        return self._normalize(req, data)

    async def _experimental_float(self, req: PredictionRequest) -> PredictionResult:
        # Stage 1: use a standard prediction only to get a realistic wind-driven ascent endpoint.
        first = await self._call({
            "profile": "standard_profile",
            "launch_latitude": req.launch_latitude,
            "launch_longitude": self._lon(req.launch_longitude),
            "launch_datetime": req.launch_datetime.isoformat().replace("+00:00", "Z"),
            "launch_altitude": req.launch_altitude_m,
            "ascent_rate": req.ascent_rate_mps,
            "burst_altitude": req.float_altitude_m,
            "descent_rate": 99,
        })
        ascent = first["prediction"][0]["trajectory"]
        end = ascent[-1]
        float_end = datetime.fromisoformat(end["datetime"].replace("Z", "+00:00")) + timedelta(minutes=req.float_duration_min)
        rise = max(0.1, req.float_ascent_rate_mps)
        second_burst = float(end["altitude"]) + rise * req.float_duration_min * 60
        second = await self._call({
            "profile": "standard_profile",
            "launch_latitude": end["latitude"],
            "launch_longitude": self._lon(end["longitude"] if end["longitude"] <= 180 else end["longitude"] - 360),
            "launch_datetime": end["datetime"],
            "launch_altitude": end["altitude"],
            "ascent_rate": rise,
            "burst_altitude": second_burst,
            "descent_rate": req.descent_rate_mps,
        })
        combined = {
            "request": first.get("request", {}),
            "metadata": {"first": first.get("metadata", {}), "second": second.get("metadata", {})},
            "prediction": [
                {"stage": "ascent", "trajectory": ascent},
                {"stage": "float", "trajectory": second["prediction"][0]["trajectory"]},
                {"stage": "descent", "trajectory": second["prediction"][1]["trajectory"]},
            ],
        }
        return self._normalize(req, combined)

    def _normalize(self, req: PredictionRequest, data: dict) -> PredictionResult:
        points: list[PredictionPoint] = []
        for stage in data.get("prediction", []):
            name = stage.get("stage", "ascent")
            if req.current_vertical_rate_mps is not None and req.current_vertical_rate_mps < 0 and name == "ascent":
                continue
            for item in stage.get("trajectory", []):
                lon = float(item["longitude"])
                if lon > 180:
                    lon -= 360
                points.append(PredictionPoint(
                    timestamp=datetime.fromisoformat(item["datetime"].replace("Z", "+00:00")),
                    latitude=item["latitude"], longitude=lon, altitude_m=item["altitude"], stage=name,
                ))
        landing = None
        if points and any(p.stage == "descent" for p in points):
            p = points[-1]
            path_m = sum(haversine_m(a.latitude, a.longitude, b.latitude, b.longitude) for a, b in zip(points, points[1:]))
            # Explicitly heuristic: Tawhiri does not return a confidence ellipse.
            uncertainty = max(500, min(15000, 0.035 * path_m + 250))
            landing = LandingEstimate(
                latitude=p.latitude, longitude=p.longitude, eta=p.timestamp,
                uncertainty_m=uncertainty, confidence="HIGH",
                uncertainty_method="path-length heuristic; not a Tawhiri statistical confidence interval",
            )
        return PredictionResult(
            provider=self.name,
            profile=req.profile,
            dataset=data.get("request", {}).get("dataset"),
            points=points,
            landing=landing,
            metadata={"tawhiri_metadata": data.get("metadata", {})},
        )
