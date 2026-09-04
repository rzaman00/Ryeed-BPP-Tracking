from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timezone

from ..mathutils import bearing_deg, haversine_m, linear_slope
from ..models import FlightSnapshot, FlightState, TelemetryPoint


_SOURCE_RANK = {
    "iridium": 6.0,
    "aprs-is": 5.5,
    "simulator": 5.5,
    "sondehub": 5.0,
    "replay": 4.5,
    "manual": 4.0,
    "spot": 2.5,
}


class FlightEngine:
    """Normalize, retain and fuse independent tracking sources.

    We never average independent GPS positions blindly. Raw points remain source-specific; the
    fused track selects one fresh, high-quality fix. This avoids producing impossible speeds when
    SPOT/APRS/SondeHub packets arrive at different cadences.
    """
    def __init__(self, max_points: int = 5000):
        self.points: dict[str, deque[TelemetryPoint]] = defaultdict(lambda: deque(maxlen=max_points))
        self.source_points: dict[str, dict[str, deque[TelemetryPoint]]] = defaultdict(lambda: defaultdict(lambda: deque(maxlen=max_points)))
        self.states: dict[str, FlightState] = {}
        self._last_fused_key: dict[str, tuple[str, datetime]] = {}

    def ingest(self, p: TelemetryPoint) -> FlightSnapshot:
        src_hist=self.source_points[p.callsign][p.source]
        src_hist.append(p)
        fused=self._select_primary(p.callsign)
        key=(fused.source,fused.timestamp)
        if self._last_fused_key.get(p.callsign)!=key:
            history=self.points[p.callsign]
            if not history or fused.timestamp >= history[-1].timestamp:
                history.append(fused)
            else:
                items=list(history)+[fused];items.sort(key=lambda x:x.timestamp);history.clear();history.extend(items[-history.maxlen:])
            self._last_fused_key[p.callsign]=key
        return self.snapshot(p.callsign)

    def _select_primary(self, callsign: str) -> TelemetryPoint:
        latest=[hist[-1] for hist in self.source_points[callsign].values() if hist]
        newest=max(p.timestamp for p in latest)
        candidates=[p for p in latest if (newest-p.timestamp).total_seconds() <= 120]
        def score(p: TelemetryPoint):
            lag=(newest-p.timestamp).total_seconds()
            rank=_SOURCE_RANK.get(p.source,3.5)
            completeness=(1 if p.altitude_m>10 else 0)+(0.25 if p.vertical_rate_mps is not None else 0)+(0.25 if p.ground_speed_mps is not None else 0)
            return rank*10 + completeness*5 - lag
        return max(candidates,key=score)

    def snapshot(self, callsign: str) -> FlightSnapshot:
        history=self.points[callsign]
        if not history:
            # This can happen only transiently; select a raw point to seed it.
            history.append(self._select_primary(callsign))
        p=history[-1]
        recent=list(history)[-12:]
        vr=linear_slope([(x.timestamp,x.altitude_m) for x in recent])
        gs=p.ground_speed_mps;hdg=p.heading_deg
        if len(recent)>=2:
            a,b=recent[-2],recent[-1];dt=max(.001,(b.timestamp-a.timestamp).total_seconds())
            if gs is None:gs=haversine_m(a.latitude,a.longitude,b.latitude,b.longitude)/dt
            if hdg is None:hdg=bearing_deg(a.latitude,a.longitude,b.latitude,b.longitude)
        state=self._state(callsign,recent,vr)
        if state == FlightState.LANDED:
            vr = 0.0
            if p.ground_speed_mps is None: gs = 0.0
        now=datetime.now(timezone.utc);age=max(0,(now-p.received_at).total_seconds())
        latest={src:hist[-1] for src,hist in self.source_points[callsign].items() if hist}
        health={src:max(0,(now-x.received_at).total_seconds()) for src,x in latest.items()}
        alerts=[]
        for src,seconds in health.items():
            if seconds>300:alerts.append(f"{src} telemetry stale ({int(seconds)}s)")
        srcs=list(latest.items())
        for i,(sa,a) in enumerate(srcs):
            for sb,b in srcs[i+1:]:
                if abs((a.timestamp-b.timestamp).total_seconds())>120:continue
                d=haversine_m(a.latitude,a.longitude,b.latitude,b.longitude)
                if d>1500:alerts.append(f"Tracking disagreement: {sa} vs {sb} = {d/1000:.1f} km")
        return FlightSnapshot(callsign=callsign,point=p,state=state,smoothed_vertical_rate_mps=vr,calculated_ground_speed_mps=gs,calculated_heading_deg=hdg,telemetry_age_s=age,source_health=health,alerts=alerts)

    def _state(self,callsign,recent,vr):
        old=self.states.get(callsign,FlightState.UNKNOWN)
        if vr is None:state=old
        elif len(recent)>=5:
            span=max(x.altitude_m for x in recent)-min(x.altitude_m for x in recent);dt=(recent[-1].timestamp-recent[0].timestamp).total_seconds()
            landed_window=recent[-4:]
            landed_span=max(x.altitude_m for x in landed_window)-min(x.altitude_m for x in landed_window)
            landed_dt=(landed_window[-1].timestamp-landed_window[0].timestamp).total_seconds()
            if landed_window[-1].altitude_m<3000 and landed_span<25 and landed_dt>=30:state=FlightState.LANDED
            elif recent[-1].altitude_m<3000 and span<25 and dt>=60:state=FlightState.LANDED
            elif vr>1.0:state=FlightState.ASCENT
            elif vr<-1.2:state=FlightState.DESCENT
            elif recent[-1].altitude_m>10000 and abs(vr)<=.7:state=FlightState.FLOAT
            elif recent[-1].altitude_m<500 and abs(vr)<.5:state=FlightState.PRELAUNCH
            else:state=old if old!=FlightState.UNKNOWN else FlightState.UNKNOWN
        else:state=FlightState.ASCENT if vr>1 else FlightState.DESCENT if vr<-1 else old
        self.states[callsign]=state;return state

    def history(self,callsign: str)->list[TelemetryPoint]:return list(self.points.get(callsign,[]))
    def raw_history(self,callsign: str)->dict[str,list[TelemetryPoint]]:return {s:list(h) for s,h in self.source_points.get(callsign,{}).items()}
