from __future__ import annotations

import asyncio
import json
from fastapi import WebSocket


class EventHub:
    def __init__(self):
        self.clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self.clients.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self.clients.discard(ws)

    async def publish(self, event_type: str, payload):
        message = {"type": event_type, "payload": payload}
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)
