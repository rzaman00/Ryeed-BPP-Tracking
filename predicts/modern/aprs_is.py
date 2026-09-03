from __future__ import annotations

import asyncio
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Iterable

import aprslib


class APRSISClient:
    """Small read-only APRS-IS receiver for the live-tracking workspace.

    The connection model follows the UMD CHASE/ChaseMapper deployment: use an
    APRS-IS budlist filter, accept packets only for the requested full
    callsigns, retain a bounded trail, and reconnect automatically.
    """

    def __init__(
        self,
        server: str = "rotate.aprs2.net",
        port: int = 14580,
        login_callsign: str = "KC3SKW",
        history_size: int = 240,
    ) -> None:
        self.server = server
        self.port = int(port)
        self.login_callsign = login_callsign.strip().upper() or "KC3SKW"
        self.history_size = history_size
        self._tracked: set[str] = set()
        self._stations: dict[str, dict[str, Any]] = {}
        self._history: dict[str, deque[dict[str, Any]]] = defaultdict(
            lambda: deque(maxlen=self.history_size)
        )
        self._task: asyncio.Task[None] | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._write_lock = asyncio.Lock()
        self._stopping = False
        self.connected = False
        self.last_error: str | None = None
        self.connected_at: str | None = None

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, callsigns: Iterable[str] = ()) -> None:
        self._tracked = {str(value).strip().upper() for value in callsigns if str(value).strip()}
        self._stopping = False
        if not self.running:
            self._task = asyncio.create_task(self._run(), name="bpp-aprs-is")

    async def stop(self) -> None:
        self._stopping = True
        writer = self._writer
        self._writer = None
        if writer is not None:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass
        task = self._task
        self._task = None
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self.connected = False

    async def track(self, callsigns: Iterable[str]) -> None:
        requested = {str(value).strip().upper() for value in callsigns if str(value).strip()}
        if requested == self._tracked:
            return
        self._tracked = requested
        await self._send_filter()

    def _filter_body(self) -> str:
        if not self._tracked:
            return ""
        bases = sorted({callsign.split("-", 1)[0] for callsign in self._tracked})
        return "b/" + "/".join(f"{base}*" for base in bases)

    async def _send_filter(self) -> None:
        writer = self._writer
        body = self._filter_body()
        if writer is None or not body:
            return
        async with self._write_lock:
            writer.write(f"#filter {body}\r\n".encode("ascii"))
            await writer.drain()

    async def _run(self) -> None:
        while not self._stopping:
            writer: asyncio.StreamWriter | None = None
            try:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(self.server, self.port), timeout=12.0
                )
                self._writer = writer
                filter_body = self._filter_body()
                login = f"user {self.login_callsign} pass -1 vers UMD-BPP-Predicts 3.6"
                if filter_body:
                    login += f" filter {filter_body}"
                writer.write(f"{login}\r\n".encode("ascii"))
                await writer.drain()
                self.connected = True
                self.connected_at = datetime.now(timezone.utc).isoformat()
                self.last_error = None

                while not self._stopping:
                    raw = await asyncio.wait_for(reader.readline(), timeout=90.0)
                    if not raw:
                        raise ConnectionError("APRS-IS closed the connection")
                    line = raw.decode("latin-1", errors="replace").strip()
                    if line and not line.startswith("#"):
                        self.ingest(line)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if not self._stopping:
                    self.last_error = str(exc)
            finally:
                self.connected = False
                if self._writer is writer:
                    self._writer = None
                if writer is not None:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except (ConnectionError, OSError):
                        pass
            if not self._stopping:
                await asyncio.sleep(5.0)

    def ingest(self, line: str) -> dict[str, Any] | None:
        try:
            packet = aprslib.parse(line)
        except Exception:
            return None
        callsign = str(packet.get("from") or "").upper()
        if callsign not in self._tracked:
            return None
        latitude = packet.get("latitude")
        longitude = packet.get("longitude")
        if latitude is None or longitude is None:
            return None

        timestamp = packet.get("timestamp")
        try:
            packet_time = int(timestamp) if timestamp else int(datetime.now(timezone.utc).timestamp())
        except (TypeError, ValueError, OSError):
            packet_time = int(datetime.now(timezone.utc).timestamp())
        altitude = packet.get("altitude")
        speed = packet.get("speed")
        course = packet.get("course")
        point = {
            "callsign": callsign,
            "latitude": float(latitude),
            "longitude": float(longitude),
            "altitude_m": float(altitude) if altitude is not None else None,
            "speed_kmh": float(speed) if speed is not None else None,
            "course_deg": float(course) if course is not None else None,
            "time": packet_time,
            "lasttime": packet_time,
            "comment": packet.get("comment"),
            "path": packet.get("path") or [],
        }
        previous = self._stations.get(callsign)
        if previous is None or previous.get("time") != point["time"] or (
            previous.get("latitude"), previous.get("longitude"), previous.get("altitude_m")
        ) != (point["latitude"], point["longitude"], point["altitude_m"]):
            self._history[callsign].append(point)
        self._stations[callsign] = point
        return point

    def snapshot(self, callsigns: Iterable[str]) -> dict[str, Any]:
        requested = [str(value).strip().upper() for value in callsigns if str(value).strip()]
        return {
            "source": "APRS-IS",
            "source_url": "https://www.aprs-is.net/",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "requested_callsigns": requested,
            "stations": {name: dict(self._stations[name]) for name in requested if name in self._stations},
            "history": {name: list(self._history[name]) for name in requested},
            "connection": {
                "connected": self.connected,
                "server": self.server,
                "port": self.port,
                "login_callsign": self.login_callsign,
                "connected_at": self.connected_at,
                "last_error": self.last_error,
            },
        }

    def history(self, callsign: str) -> list[dict[str, Any]]:
        return list(self._history[str(callsign).strip().upper()])
