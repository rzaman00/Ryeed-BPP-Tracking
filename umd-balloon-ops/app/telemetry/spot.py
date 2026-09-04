from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import httpx

from ..models import TelemetryPoint


class SpotWatcher:
    """SPOT public shared-feed adapter.

    SPOT asks consumers not to poll a feed more frequently than about 2.5 minutes,
    so the adapter enforces a minimum 150 second interval.
    """
    def __init__(self, ingest_callback):
        self.ingest_callback = ingest_callback
        self.tasks: dict[str, asyncio.Task] = {}
        self.client = httpx.AsyncClient(timeout=12, headers={"User-Agent":"UMD-Balloon-Ops/1.0"})

    def start(self, callsign: str, feed_id: str, password: str | None = None, interval_s: int = 150):
        self.stop(callsign)
        self.tasks[callsign] = asyncio.create_task(self._run(callsign, feed_id, password, max(150, interval_s)))

    def stop(self, callsign: str):
        task=self.tasks.pop(callsign,None)
        if task: task.cancel()

    async def _run(self, callsign: str, feed_id: str, password: str | None, interval_s: int):
        last_id=None
        url=f"https://api.findmespot.com/spot-main-web/consumer/rest-api/2.0/public/feed/{feed_id}/message.json"
        while True:
            try:
                params={"feedPassword":password} if password else None
                r=await self.client.get(url,params=params);r.raise_for_status();data=r.json()
                messages=data.get("response",{}).get("feedMessageResponse",{}).get("messages",{}).get("message",[])
                if isinstance(messages,dict): messages=[messages]
                messages=sorted(messages,key=lambda x:int(x.get("unixTime",0)))
                for row in messages:
                    mid=str(row.get("id") or row.get("unixTime"))
                    if mid==last_id: continue
                    lat=float(row.get("latitude",-99999)); lon=float(row.get("longitude",-99999))
                    if not (-90<=lat<=90 and -180<=lon<=180): continue
                    last_id=mid
                    ts=datetime.fromtimestamp(int(row.get("unixTime",datetime.now(timezone.utc).timestamp())),tz=timezone.utc)
                    await self.ingest_callback(TelemetryPoint(
                        callsign=callsign,timestamp=ts,latitude=lat,longitude=lon,
                        altitude_m=float(row.get("altitude") or 0),source="spot",receiver=str(row.get("messengerName") or "SPOT"),raw=row,
                    ))
            except asyncio.CancelledError: raise
            except Exception: pass
            await asyncio.sleep(interval_s)
