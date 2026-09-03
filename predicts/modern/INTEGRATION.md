# Integration — v3.7.0

1. Install Python 3 and Docker Desktop.
2. Replace the previous project with this package; keep the complete
   `predicts/chasemapper` directory.
3. Start Docker Desktop, then run `START_BPP_PREDICTS.bat`.
4. Confirm Predicts reports `3.7.0` at `http://127.0.0.1:8000/api/health`.
5. Open `Live CHASE` and confirm the separate server loads on port 5001.
6. Edit `predicts/chasemapper/horusmapper.cfg` for flight callsigns/profiles.
7. For optional SPOT/recovery services, copy `.env.example` to `.env` and fill
   only the required feed IDs or key.

The root launcher starts Live CHASE with `docker compose up -d --build`. The first
build downloads and compiles the offline predictor and may take several minutes.
