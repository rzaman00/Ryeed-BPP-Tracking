from __future__ import annotations

import asyncio
import hashlib
import json
import time
from copy import deepcopy

from ..config import settings
from ..mathutils import haversine_m
from ..models import BatchPredictionRequest, EnsemblePredictionRequest, PredictProvider, PredictionRequest, PredictionResult
from .offline import OfflinePredictor
from .tawhiri import TawhiriError, TawhiriPredictor
from .local_gfs import LocalGFSPredictor


class PredictionManager:
    def __init__(self):
        self.tawhiri = TawhiriPredictor()
        self.offline = OfflinePredictor()
        self.local_gfs = LocalGFSPredictor()
        self.cache: dict[str, tuple[float, PredictionResult]] = {}
        self.semaphore = asyncio.Semaphore(settings.max_parallel_predictions)

    def _key(self, req: PredictionRequest) -> str:
        blob = req.model_dump_json()
        return hashlib.sha256(blob.encode()).hexdigest()

    async def predict(self, req: PredictionRequest) -> PredictionResult:
        key = self._key(req)
        cached = self.cache.get(key)
        if cached and time.monotonic() - cached[0] <= settings.prediction_cache_s:
            result = cached[1].model_copy(deep=True)
            result.metadata["cache_hit"] = True
            return result

        async with self.semaphore:
            if req.provider == PredictProvider.OFFLINE:
                result = await self.offline.predict(req)
            elif req.provider == PredictProvider.LOCAL_GFS:
                result = await self.local_gfs.predict(req)
            elif req.provider == PredictProvider.TAWHIRI:
                result = await self.tawhiri.predict(req)
            else:
                try:
                    result = await self.tawhiri.predict(req)
                except Exception as tawhiri_exc:
                    ready, _ = self.local_gfs.readiness()
                    if ready and req.profile.value == "standard":
                        try:
                            result = await self.local_gfs.predict(req)
                            result.warnings.insert(0, f"Tawhiri unavailable ({tawhiri_exc}); using local GFS.")
                            result.metadata["fallback_reason"] = str(tawhiri_exc)
                        except Exception as gfs_exc:
                            result = await self.offline.predict(req)
                            result.warnings.insert(0, f"Tawhiri and local GFS unavailable; emergency vector fallback active.")
                            result.metadata["fallback_reason"] = {"tawhiri":str(tawhiri_exc),"local_gfs":str(gfs_exc)}
                    else:
                        result = await self.offline.predict(req)
                        result.warnings.insert(0, f"Tawhiri unavailable ({tawhiri_exc}); emergency vector fallback active.")
                        result.metadata["fallback_reason"] = str(tawhiri_exc)
            self.cache[key] = (time.monotonic(), result)
            return result

    async def batch(self, batch: BatchPredictionRequest) -> list[dict]:
        async def one(location: dict):
            req = batch.template.model_copy(deep=True)
            req.launch_latitude = float(location["latitude"])
            req.launch_longitude = float(location["longitude"])
            if "altitude_m" in location:
                req.launch_altitude_m = float(location["altitude_m"])
            result = await self.predict(req)
            return {"name": location.get("name", "location"), "prediction": result.model_dump(mode="json")}
        return await asyncio.gather(*(one(loc) for loc in batch.locations))

    async def ensemble(self, request: EnsemblePredictionRequest) -> dict:
        n = request.members
        # Deterministic perturbations: operationally useful, reproducible sensitivity envelope.
        # For Tawhiri these vary balloon parameters; fallback also varies wind assumptions.
        qs = [(-1 + 2*i/(n-1)) for i in range(n)]
        async def one(q: float):
            req = request.base.model_copy(deep=True)
            req.ascent_rate_mps = max(0.2, req.ascent_rate_mps * (1 + 0.06*q))
            req.descent_rate_mps = max(0.2, req.descent_rate_mps * (1 - 0.06*q))
            if req.profile.value == "standard":
                req.burst_altitude_m = max(req.launch_altitude_m + 100, req.burst_altitude_m + 750*q)
            else:
                req.float_altitude_m = max(req.launch_altitude_m + 100, req.float_altitude_m + 500*q)
            req.fallback_wind_speed_mps = max(0, req.fallback_wind_speed_mps * (1 + 0.10*q))
            req.fallback_wind_bearing_deg = (req.fallback_wind_bearing_deg + 10*q) % 360
            return await self.predict(req)
        results = await asyncio.gather(*(one(q) for q in qs))
        valid = [r for r in results if r.landing is not None]
        central = results[n//2].model_copy(deep=True)
        spread = None
        if valid:
            lat = sum(r.landing.latitude for r in valid) / len(valid)
            lon = sum(r.landing.longitude for r in valid) / len(valid)
            distances = sorted(haversine_m(lat, lon, r.landing.latitude, r.landing.longitude) for r in valid)
            p90 = distances[min(len(distances)-1, max(0, int(round(0.9*(len(distances)-1)))))]
            spread = {"center_latitude":lat,"center_longitude":lon,"p90_radius_m":p90,"max_radius_m":max(distances),"valid_members":len(valid)}
            if central.landing:
                central.landing.uncertainty_m = max(central.landing.uncertainty_m, p90)
                central.landing.uncertainty_method = f"{len(valid)}-member deterministic sensitivity ensemble (P90 radius)"
                central.landing.confidence = "HIGH" if p90 < 3000 else "MEDIUM" if p90 < 8000 else "LOW"
                central.metadata["ensemble"] = spread
        return {"central":central.model_dump(mode="json"),"members":[r.model_dump(mode="json") for r in results],"spread":spread}
