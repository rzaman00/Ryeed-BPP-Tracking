from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from ..mathutils import destination
from ..models import SimulationRequest, TelemetryPoint


class Simulator:
    def __init__(self, ingest_callback):
        self.ingest_callback = ingest_callback
        self.tasks: dict[str, asyncio.Task] = {}

    def start(self, cfg: SimulationRequest):
        self.stop(cfg.callsign)
        self.tasks[cfg.callsign] = asyncio.create_task(self._run(cfg))

    def stop(self, callsign: str):
        task = self.tasks.pop(callsign, None)
        if task:
            task.cancel()

    async def _run(self, cfg: SimulationRequest):
        lat, lon, alt = cfg.start_latitude, cfg.start_longitude, cfg.start_altitude_m
        flight_time = datetime.now(timezone.utc)
        descending = False
        while True:
            simulated_dt = cfg.interval_s * cfg.time_scale
            if not descending:
                alt += cfg.ascent_rate_mps * simulated_dt
                vr = cfg.ascent_rate_mps
                if alt >= cfg.max_altitude_m:
                    alt = cfg.max_altitude_m
                    descending = True
            else:
                alt -= cfg.descent_rate_mps * simulated_dt
                vr = -cfg.descent_rate_mps
                if alt <= 0:
                    alt = 0
                    vr = 0
            lat, lon = destination(lat, lon, cfg.horizontal_speed_mps * simulated_dt, cfg.heading_deg)
            flight_time += timedelta(seconds=simulated_dt)
            await self.ingest_callback(TelemetryPoint(
                callsign=cfg.callsign, timestamp=flight_time,
                latitude=lat, longitude=lon, altitude_m=alt,
                vertical_rate_mps=vr, ground_speed_mps=cfg.horizontal_speed_mps, heading_deg=cfg.heading_deg,
                source="simulator", receiver="built-in",
            ))
            if alt <= 0 and descending:
                # Emit a few stationary fixes so the state machine can positively identify a landing
                # instead of ending the replay on the first ground-level descent packet.
                for _ in range(4):
                    await asyncio.sleep(cfg.interval_s)
                    flight_time += timedelta(seconds=simulated_dt)
                    await self.ingest_callback(TelemetryPoint(
                        callsign=cfg.callsign, timestamp=flight_time, latitude=lat, longitude=lon, altitude_m=0,
                        vertical_rate_mps=0, ground_speed_mps=0, heading_deg=cfg.heading_deg,
                        source="simulator", receiver="built-in",
                    ))
                return
            await asyncio.sleep(cfg.interval_s)
