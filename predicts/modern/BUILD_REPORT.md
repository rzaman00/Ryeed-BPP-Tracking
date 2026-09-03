# Build report — BPP Operations Suite v3.7.0

- Vendored the complete proven CHASE/ChaseMapper source, server, full interface,
  map, profiles, configuration, APRS-IS, SPOT, chase-car GPS/navigation, offline
  GFS prediction, parcel lookup, recovery, and geofence systems.
- Replaced the prior lightweight live backend and controls with a separate
  `Live CHASE` application tab and Docker-based local service on port 5001.
- Added packaged BPP configuration, persistent GFS/log/cache volumes, UDP ingest
  ports, optional environment settings, and one-click launchers.
- Restored full best-ascent-rate evaluation by testing all sweep scenarios.
- Changed launch-site safety to reject all requested operational-airspace
  footprint crossings while still reporting the true altitude-aware 3-D metric.
- Added an offline Chesapeake Bay hazard check and water-landing rejection.
- Added explicit decision reasons and selection criteria to the optimal-site API.
- Added readiness launch-condition cards and transparent GO/CAUTION/NO-GO rules.
- Kept B/C/D controlled airspace, SUA, TFR, and burst altitude visible in Basic.
- Preserved the v3.6 weather, address, Ventusky, themes, responsive layout,
  launch-location/POI fixes, and seven-day readiness behavior.
