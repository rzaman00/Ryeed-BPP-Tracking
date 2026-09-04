from __future__ import annotations

import time
import httpx

from ..config import settings

CLASS_URL = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Class_Airspace/FeatureServer/0/query"
SUA_URL = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/Special_Use_Airspace/FeatureServer/0/query"


class AirspaceService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=settings.request_timeout_s)
        self.cache = {}

    async def get(self, bbox: str, layer: str = "class") -> dict:
        # bbox = west,south,east,north
        key = (bbox, layer)
        cached = self.cache.get(key)
        if cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        url = CLASS_URL if layer == "class" else SUA_URL
        params = {
            "where": "1=1", "outFields": "*", "returnGeometry": "true", "f": "geojson",
            "geometry": bbox, "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "resultRecordCount": 2000,
        }
        try:
            r = await self.client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            data = {"type": "FeatureCollection", "features": [], "warning": str(exc)}
        self.cache[key] = (time.monotonic(), data)
        return data
