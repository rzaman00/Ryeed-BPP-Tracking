from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path

from .models import PredictionResult, TelemetryPoint


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._setup()

    def _setup(self):
        with self._conn:
            self._conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    callsign TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    received_at TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    altitude_m REAL NOT NULL,
                    source TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_telemetry_callsign_time
                    ON telemetry(callsign, timestamp);
                CREATE TABLE IF NOT EXISTS predictions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    callsign TEXT,
                    generated_at TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    result_json TEXT NOT NULL
                );
                """
            )

    def insert_telemetry(self, p: TelemetryPoint):
        payload = p.model_dump_json()
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO telemetry(callsign,timestamp,received_at,latitude,longitude,altitude_m,source,payload_json) VALUES(?,?,?,?,?,?,?,?)",
                (p.callsign, p.timestamp.isoformat(), p.received_at.isoformat(), p.latitude, p.longitude, p.altitude_m, p.source, payload),
            )

    def history(self, callsign: str, limit: int = 2000) -> list[TelemetryPoint]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT payload_json FROM telemetry WHERE callsign=? ORDER BY timestamp DESC LIMIT ?",
                (callsign, limit),
            ).fetchall()
        return [TelemetryPoint.model_validate_json(r["payload_json"]) for r in reversed(rows)]

    def callsigns(self) -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT DISTINCT callsign FROM telemetry ORDER BY callsign").fetchall()
        return [r[0] for r in rows]

    def insert_prediction(self, result: PredictionResult, callsign: str | None = None):
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO predictions(callsign,generated_at,provider,result_json) VALUES(?,?,?,?)",
                (callsign, result.generated_at.isoformat(), result.provider, result.model_dump_json()),
            )
