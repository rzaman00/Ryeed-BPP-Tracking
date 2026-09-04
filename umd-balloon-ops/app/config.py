from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    app_name: str = "UMD Balloon Ops"
    database_path: Path = Path(os.getenv("BALLOON_DB", ROOT / "data" / "balloon_ops.sqlite3"))
    tawhiri_url: str = os.getenv("TAWHIRI_URL", "https://tawhiri.v2.sondehub.org/api/v1/")
    sondehub_api: str = os.getenv("SONDEHUB_API", "https://api.v2.sondehub.org")
    request_timeout_s: float = float(os.getenv("REQUEST_TIMEOUT_S", "8"))
    prediction_cache_s: int = int(os.getenv("PREDICTION_CACHE_S", "25"))
    auto_predict_min_seconds: int = int(os.getenv("AUTO_PREDICT_MIN_SECONDS", "30"))
    auto_predict_min_altitude_delta_m: float = float(os.getenv("AUTO_PREDICT_MIN_ALTITUDE_DELTA_M", "250"))
    max_parallel_predictions: int = int(os.getenv("MAX_PARALLEL_PREDICTIONS", "4"))
    sondehub_poll_seconds: int = int(os.getenv("SONDEHUB_POLL_SECONDS", "12"))
    offline_tiles_path: Path | None = Path(os.environ["OFFLINE_TILES_PATH"]).expanduser().resolve() if os.getenv("OFFLINE_TILES_PATH") else None
    cusf_pred_binary: Path | None = Path(os.environ["CUSF_PRED_BINARY"]).expanduser().resolve() if os.getenv("CUSF_PRED_BINARY") else None
    gfs_directory: Path | None = Path(os.environ["GFS_DIRECTORY"]).expanduser().resolve() if os.getenv("GFS_DIRECTORY") else None


settings = Settings()
settings.database_path.parent.mkdir(parents=True, exist_ok=True)
