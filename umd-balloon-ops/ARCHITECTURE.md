# Architecture

```text
SondeHub ----\
APRS-IS ------\
SPOT ----------> source adapters -> source-aware fusion -> flight state/metrics -> SQLite
Iridium/BITS --/                         |                       |
Simulator ----/                          |                       +-> replay/benchmark
Manual/LoRa --/                          v
                                   prediction trigger
                                          |
                      +-------------------+-------------------+
                      |                   |                   |
                   Tawhiri           local CUSF/GFS      emergency vector
                      +-------------------+-------------------+
                                          |
                              normalized prediction result
                                          |
                                      EventHub
                                          |
                                      WebSocket
                                          |
                                    browser UI
                                          |
                 +------------------------+-----------------------+
                 |                        |                       |
             FAA airspace            recovery              offline tiles
                                     USGS / MD parcel /
                                     OSM roads
```

## Core rules

1. External sources are adapters; the map does not understand APRS/SPOT/SondeHub payload formats.
2. Raw sources are retained separately. GPS sources are never blindly averaged.
3. Prediction engines return one normalized trajectory model.
4. Networking can fail without breaking recording, replay, simulation, state inference or emergency prediction.
5. Expensive prediction/recovery/geodata work is cached, debounced and concurrency-limited.
6. The browser is a client of the flight engine, not the flight engine itself.
