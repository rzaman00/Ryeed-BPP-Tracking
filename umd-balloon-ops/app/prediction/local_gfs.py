from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from ..config import settings
from ..mathutils import haversine_m
from ..models import LandingEstimate, PredictProfile, PredictionPoint, PredictionRequest, PredictionResult


class LocalGFSError(RuntimeError):
    pass


class LocalGFSPredictor:
    """Optional CUSF/GFS predictor compatible with ChaseMapper's offline stack.

    Requires the optional `cusfpredict` dependency, a compiled CUSF `pred` binary,
    and downloaded GFS files. It is deliberately lazy-loaded so the base application
    remains simple to install and can fall back cleanly.
    """
    name = "local-gfs"

    def readiness(self) -> tuple[bool, str]:
        if not settings.cusf_pred_binary:
            return False, "CUSF_PRED_BINARY not configured"
        if not settings.gfs_directory:
            return False, "GFS_DIRECTORY not configured"
        if not Path(settings.cusf_pred_binary).exists():
            return False, "predictor binary missing"
        if not Path(settings.gfs_directory).exists():
            return False, "GFS directory missing"
        try:
            from cusfpredict.predict import Predictor  # noqa: F401
            from cusfpredict.utils import available_gfs
            available_gfs(str(settings.gfs_directory))
        except Exception as exc:
            return False, f"cusfpredict/GFS unavailable: {exc}"
        return True, "ready"

    async def predict(self, req: PredictionRequest) -> PredictionResult:
        if req.profile != PredictProfile.STANDARD:
            raise LocalGFSError("Local CUSF/GFS provider currently supports standard ascent/descent profiles only")
        ready, why = self.readiness()
        if not ready:
            raise LocalGFSError(why)

        def run():
            from cusfpredict.predict import Predictor
            predictor = Predictor(bin_path=str(settings.cusf_pred_binary), gfs_path=str(settings.gfs_directory))
            descending = req.current_vertical_rate_mps is not None and req.current_vertical_rate_mps < -1
            return predictor.predict(
                launch_lat=req.launch_latitude,
                launch_lon=req.launch_longitude,
                launch_alt=req.launch_altitude_m,
                ascent_rate=max(0.1, req.ascent_rate_mps),
                descent_rate=req.descent_rate_mps,
                burst_alt=max(req.launch_altitude_m + 1, req.burst_altitude_m),
                launch_time=req.launch_datetime,
                descent_mode=descending,
            )

        try:
            raw = await asyncio.to_thread(run)
        except Exception as exc:
            raise LocalGFSError(str(exc)) from exc
        if not raw or len(raw) < 2:
            raise LocalGFSError("CUSF predictor returned no usable path")

        # CUSF wrapper path format used by ChaseMapper: [time, lat, lon, altitude].
        max_alt_index = max(range(len(raw)), key=lambda i: float(raw[i][3]))
        descending_now = req.current_vertical_rate_mps is not None and req.current_vertical_rate_mps < -1
        points: list[PredictionPoint] = []
        for i, row in enumerate(raw):
            t = row[0]
            if isinstance(t, (int, float)):
                ts = datetime.fromtimestamp(float(t), tz=timezone.utc)
            elif isinstance(t, datetime):
                ts = t if t.tzinfo else t.replace(tzinfo=timezone.utc)
            else:
                try:
                    ts = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
                except Exception:
                    ts = req.launch_datetime
            stage = "descent" if descending_now or i > max_alt_index else "ascent"
            points.append(PredictionPoint(timestamp=ts, latitude=float(row[1]), longitude=float(row[2]), altitude_m=max(0,float(row[3])), stage=stage))

        last = points[-1]
        path_m = sum(haversine_m(a.latitude,a.longitude,b.latitude,b.longitude) for a,b in zip(points,points[1:]))
        landing = LandingEstimate(latitude=last.latitude, longitude=last.longitude, eta=last.timestamp,
                                  uncertainty_m=max(500,min(15000,path_m*0.04+250)), confidence="HIGH",
                                  uncertainty_method="local GFS path-length heuristic")
        return PredictionResult(provider=self.name, profile=req.profile, dataset="local CUSF/GFS", points=points, landing=landing,
                                metadata={"gfs_directory":str(settings.gfs_directory)})
