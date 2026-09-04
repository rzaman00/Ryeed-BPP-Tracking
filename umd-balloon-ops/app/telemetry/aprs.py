from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import threading

from ..models import TelemetryPoint


class APRSISWatcher:
    """APRS-IS adapter using aprslib. Runs its blocking consumer in a daemon thread."""
    def __init__(self, ingest_callback):
        self.ingest_callback=ingest_callback
        self.running: dict[str,bool]={}
        self.threads: dict[str,threading.Thread]={}
        self.loop: asyncio.AbstractEventLoop | None=None

    def start(self, payload_callsign: str, login_callsign: str, passcode: str, host: str="rotate.aprs2.net", port: int=14580):
        self.stop(payload_callsign); self.loop=asyncio.get_running_loop(); self.running[payload_callsign]=True
        t=threading.Thread(target=self._thread,args=(payload_callsign,login_callsign,passcode,host,port),daemon=True)
        self.threads[payload_callsign]=t;t.start()

    def stop(self, payload_callsign: str):
        self.running[payload_callsign]=False

    def _thread(self, payload_callsign, login_callsign, passcode, host, port):
        try:
            import aprslib
            ais=aprslib.IS(login_callsign,passwd=passcode,host=host,port=port)
            ais.set_filter(f"p/{payload_callsign}")
            ais.connect(blocking=True)
            def cb(packet):
                if not self.running.get(payload_callsign): raise KeyboardInterrupt
                if packet.get("from","").upper()!=payload_callsign.upper(): return
                if packet.get("latitude") is None or packet.get("longitude") is None:return
                # aprslib normalizes /A= altitude to metres and course/speed extension to km/h.
                alt=packet.get("altitude"); alt_m=float(alt) if alt is not None else 0.0
                speed_kmh=packet.get("speed"); speed_mps=float(speed_kmh)/3.6 if speed_kmh is not None else None
                packet_ts=packet.get("timestamp")
                ts=datetime.fromtimestamp(float(packet_ts),tz=timezone.utc) if packet_ts else datetime.now(timezone.utc)
                p=TelemetryPoint(callsign=payload_callsign,timestamp=ts,latitude=float(packet["latitude"]),longitude=float(packet["longitude"]),altitude_m=alt_m,ground_speed_mps=speed_mps,heading_deg=packet.get("course"),source="aprs-is",receiver=(str(packet.get("via")) if packet.get("via") is not None else None),raw=packet)
                if self.loop: asyncio.run_coroutine_threadsafe(self.ingest_callback(p),self.loop)
            ais.consumer(cb,raw=False,blocking=True)
        except BaseException:
            self.running[payload_callsign]=False
