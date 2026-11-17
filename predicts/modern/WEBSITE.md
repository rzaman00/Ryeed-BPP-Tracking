# Putting BPP Predicts on a website

The app is one small Python server that serves both the page and its API.
Nothing in the page uses an absolute address, so it works at a domain root,
under a sub-path, inside an iframe, or with the page and the API on different
servers. Pick the option that matches your site.

## 1. Run it as its own site (simplest)

```bash
cd predicts/modern
pip install -r requirements.txt
BPP_PREDICTS_HOST=0.0.0.0 python app.py        # listens on PORT or 8000
```

Hosts such as Render, Railway, Fly.io, and Heroku set `PORT` themselves.

For Docker, use the `Dockerfile` at the repository root (CI publishes it as
`ghcr.io/rzaman00/ryeed-bpp-tracking:finished`); see `docker-compose.yml.example`.

```bash
docker build -t bpp-predicts .        # from the repository root
docker run -p 8000:8000 bpp-predicts
```

## 2. Put it under a path of an existing site (`yoursite.edu/predicts/`)

Run the server as in option 1 and forward the path to it. `deploy/nginx-subpath.conf`
is a complete example. Two rules:

- The proxy must strip the prefix (`/predicts/` → `/`).
- Link to the address **with the trailing slash**: `yoursite.edu/predicts/`.

No rebuild or configuration change is needed in the app.

## 3. Embed it in a page

```html
<iframe src="https://predicts.yoursite.edu/?embed=1"
        style="width:100%;height:85vh;border:0" allow="geolocation; clipboard-write"
        title="UMD BPP Predicts"></iframe>
```

`?embed=1` hides the brand block and version badge to save height. To allow
only your site to frame it, set `BPP_FRAME_ANCESTORS="https://yoursite.edu"`.

## 4. Static page on one host, API on another

Copy `static/index.html` and the `static/` folder to the static host, then in
`index.html` set

```html
<meta name="bpp-api-base" content="https://api.yoursite.edu/" />
```

and start the API with `BPP_CORS_ORIGINS="https://yoursite.edu"`.

## Settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BPP_PREDICTS_HOST` | `127.0.0.1` | Use `0.0.0.0` on a server |
| `BPP_PREDICTS_PORT` / `PORT` | `8000` | Listening port |
| `BPP_ROOT_PATH` | empty | Only for the API docs page when a proxy adds a prefix |
| `BPP_CORS_ORIGINS` | empty | Comma-separated sites allowed to call the API (option 4) |
| `BPP_FRAME_ANCESTORS` | empty | Sites allowed to embed the app in an iframe |
| `TAWHIRI_API_URL` | SondeHub Tawhiri | Prediction service |

## Using the API from your own pages

All endpoints are JSON. Interactive documentation is at `/docs`.

| Endpoint | Use |
| --- | --- |
| `POST /api/predict` | Burst or float prediction for one launch point |
| `POST /api/predict-descent` | Landing from a burst point (lat, lon, altitude in ft or m, burst time) |
| `POST /api/optimal-site` | Rank launch sites against airspace, water, and landing rules |
| `POST /api/weather/batch` | Launch-hour weather for a list of sites |
| `POST /api/forecast-comparison` | Model comparison and winds aloft |
| `GET /api/launch-locations` | Launch sites as GeoJSON |
| `GET /api/health`, `GET /api/config` | Version and capabilities |

```js
const r = await fetch('https://predicts.yoursite.edu/api/predict-descent', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    burst: {name: 'NS-147', latitude: 39.7564, longitude: -77.4782},
    burst_datetime: '2026-11-14T15:42:10Z',
    burst_altitude_ft: 91200,
    descent_rate_ms: 9,
  }),
});
const {summary} = await r.json();   // summary.landing = {latitude, longitude, altitude_m}
```

Launch and burst times may be from 7 days in the past through 7 days ahead.

## Notes for a public site

- The server keeps FAA and launch-site caches in `cache/`; give it a writable disk.
- One process is enough. If you run several workers, each keeps its own cache.
- The page loads MapLibre from unpkg and map tiles from Esri/USGS, so visitors
  need normal internet access.
