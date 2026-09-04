from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import httpx

from ..config import settings
from ..models import TelemetryPoint


class SondeHubWatcher:
    def __init__(self, ingest_callback):
        self.ingest_callback = ingest_callback
        self.tasks: dict[str, asyncio.Task] = {}
        self.client = httpx.AsyncClient(timeout=settings.request_timeout_s)

    def start(self, callsign: str):
        if callsign not in self.tasks or self.tasks[callsign].done():
            self.tasks[callsign] = asyncio.create_task(self._run(callsign))

    def stop(self, callsign: str):
        task = self.tasks.pop(callsign, None)
        if task:
            task.cancel()

    async def _run(self, callsign: str):
        last_timestamp = None
        while True:
            try:
                url = f"{settings.sondehub_api}/amateur/telemetry/{callsign}"
                response = await self.client.get(url, params={"last": 3600})
                response.raise_for_status()
                rows = response.json()
                if isinstance(rows, dict):
                    rows = list(rows.values())
                if rows:
                    row = rows[-1]
                    ts = row.get("datetime") or row.get("time_received")
                    if ts and ts != last_timestamp:
                        last_timestamp = ts
                        p = TelemetryPoint(
                            callsign=row.get("payload_callsign", callsign),
                            timestamp=datetime.fromisoformat(ts.replace("Z", "+00:00")),
                            received_at=datetime.now(timezone.utc),
                            latitude=float(row["lat"]), longitude=float(row["lon"]), altitude_m=float(row["alt"]),
                            vertical_rate_mps=row.get("vel_v"), ground_speed_mps=row.get("vel_h"), heading_deg=row.get("heading"),
                            source="sondehub", receiver=row.get("uploader_callsign"), battery_v=row.get("batt"), rssi=row.get("rssi"), raw=row,
                        )
                        await self.ingest_callback(p)
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            await asyncio.sleep(settings.sondehub_poll_seconds)
