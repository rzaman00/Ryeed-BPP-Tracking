BPP Operations Suite v3.7.2

Requirements:
- Python 3 for Predicts and Readiness.
- Docker Desktop for the complete Live CHASE system.

Start everything on Windows:
1. Start Docker Desktop.
2. Double-click START_BPP_PREDICTS.bat.
3. Predicts opens at http://127.0.0.1:8000/.
4. The Live CHASE tab opens the complete ChaseMapper server at http://127.0.0.1:5001/.

The first Live CHASE start builds its Docker image and can take several minutes.
It then provides chase-car GPS/navigation, APRS-IS, SPOT support, offline GFS
downloads and prediction, parcel lookup, recovery/geofence tools, profiles,
configuration, and its separate operational map.

Safety changes in v3.7.2:
- Operations Basic includes calculated burst altitude plus B/C/D, SUA, and TFR layers.
- Optimal-site search tests every requested ascent rate and shows the best rate.
- Any selected operational-airspace footprint crossing is a site-selection no-go.
- A Chesapeake Bay crossing or mapped-water landing is a no-go.
- Readiness shows date, time, ascent rate, burst altitude, all five factors, and
  plain-language reasons for every GO, CAUTION, and NO-GO result.

Live CHASE configuration is in predicts\chasemapper\horusmapper.cfg. Optional
SPOT and recovery variables are documented in predicts\chasemapper\.env.example.

The main launcher starts Predicts immediately and starts Docker Desktop/Live
CHASE in the background. The Live CHASE tab shows progress and opens the chase
map automatically when port 5001 is ready.
