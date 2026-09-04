from __future__ import annotations

import asyncio
import math
import time
from typing import Any
import httpx

from ..config import settings
from ..mathutils import destination, haversine_m

EPQS_URL = "https://epqs.nationalmap.gov/v1/json"
MD_PARCEL_URL = "https://services1.arcgis.com/X3lKekbdaBmNjCHu/ArcGIS/rest/services/Statewide_Working_Parcels/FeatureServer/0/query"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


class RecoveryService:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=max(5, settings.request_timeout_s), headers={"User-Agent":"UMD-Balloon-Ops/1.0 educational-recovery-tool"})
        self.cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}

    async def elevation(self, lat: float, lon: float) -> float | None:
        try:
            r = await self.client.get(EPQS_URL, params={"x":lon,"y":lat,"wkid":4326,"units":"Meters","includeDate":"false"})
            r.raise_for_status(); data=r.json(); return float(data["value"])
        except Exception:
            return None

    async def terrain(self, lat: float, lon: float) -> dict[str, Any]:
        center = await self.elevation(lat, lon)
        samples=[]
        for bearing in (0,90,180,270):
            a,b=destination(lat,lon,100,bearing); samples.append(self.elevation(a,b))
        vals=await asyncio.gather(*samples)
        gradients=[]
        if center is not None:
            gradients=[abs(v-center)/100 for v in vals if v is not None]
        slope_deg=math.degrees(math.atan(max(gradients))) if gradients else None
        return {"elevation_m":center,"max_local_slope_deg":slope_deg,"sample_radius_m":100,"source":"USGS 3DEP EPQS"}

    async def maryland_parcel(self, lat: float, lon: float) -> dict[str, Any] | None:
        if not (37.7 <= lat <= 39.8 and -79.6 <= lon <= -75.0):
            return None
        try:
            params={
                "where":"1=1","geometry":f"{lon},{lat}","geometryType":"esriGeometryPoint","inSR":"4326","outSR":"4326",
                "spatialRel":"esriSpatialRelIntersects","outFields":"*","returnGeometry":"true","f":"geojson","resultRecordCount":1,
            }
            r=await self.client.get(MD_PARCEL_URL,params=params);r.raise_for_status();data=r.json()
            features=data.get("features",[])
            if not features:return None
            props=features[0].get("properties",{})
            # Return useful non-owner fields where available. Avoid exposing owner/taxpayer names in the chase UI.
            wanted={k:v for k,v in props.items() if any(token in k.lower() for token in ("parcel","account","address","acre","land","use","county","district")) and "owner" not in k.lower() and "name" not in k.lower()}
            return {"properties":wanted,"geometry":features[0].get("geometry"),"source":"Maryland Statewide Working Parcels"}
        except Exception:
            return None

    async def nearest_road(self, lat: float, lon: float) -> dict[str, Any] | None:
        # Approximate closest public/drivable OSM way using returned geometry vertices.
        q=f'[out:json][timeout:8];way(around:2500,{lat},{lon})["highway"]["access"!="private"];out tags geom;'
        try:
            r=await self.client.post(OVERPASS_URL,data={"data":q},timeout=9);r.raise_for_status();data=r.json()
            best=None
            for way in data.get("elements",[]):
                tags=way.get("tags",{}); hw=tags.get("highway")
                if hw in {"footway","path","steps","cycleway","bridleway","construction","proposed"}:continue
                for p in way.get("geometry",[]):
                    d=haversine_m(lat,lon,p["lat"],p["lon"])
                    if best is None or d<best[0]: best=(d,tags,p)
            if not best:return None
            return {"distance_m":best[0],"name":best[1].get("name") or best[1].get("ref") or best[1].get("highway"),"latitude":best[2]["lat"],"longitude":best[2]["lon"],"method":"nearest returned OSM way vertex (approximate)","source":"OpenStreetMap / Overpass"}
        except Exception:
            return None

    async def analyze(self, lat: float, lon: float) -> dict[str, Any]:
        # Round to roughly a few hundred metres so small landing movements do not hammer
        # USGS/ArcGIS/Overpass during a live flight. Cache for three minutes.
        key = (round(lat, 3), round(lon, 3))
        cached = self.cache.get(key)
        if cached and time.monotonic() - cached[0] < 180:
            result = dict(cached[1])
            result["cache_hit"] = True
            return result
        terrain, parcel, road = await asyncio.gather(self.terrain(lat,lon), self.maryland_parcel(lat,lon), self.nearest_road(lat,lon))
        slope=terrain.get("max_local_slope_deg")
        road_d=road.get("distance_m") if road else None
        score=1
        reasons=[]
        if slope is not None:
            if slope>25: score+=3;reasons.append("steep terrain")
            elif slope>15: score+=2;reasons.append("moderate terrain")
            elif slope>8: score+=1;reasons.append("rolling terrain")
        if road_d is not None:
            if road_d>1500:score+=3;reasons.append("far from public road")
            elif road_d>700:score+=2;reasons.append("significant walk from road")
            elif road_d>300:score+=1;reasons.append("off-road walk")
        result = {"terrain":terrain,"parcel":parcel,"road":road,"difficulty_score":min(10,score),"difficulty_reasons":reasons or ["no major terrain/road penalty detected"],"notes":["Recovery metrics are planning aids, not permission to enter private property."],"cache_hit":False}
        self.cache[key] = (time.monotonic(), result)
        return result
