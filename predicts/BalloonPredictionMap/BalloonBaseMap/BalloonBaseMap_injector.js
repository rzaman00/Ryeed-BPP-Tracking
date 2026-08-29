let BalloonBaseMap_import_mappings = {
    // "maplibre-gl":                          "https://unpkg.com/maplibre-gl@5.9.0/dist/maplibre-gl.js",
    "maplibre-gl":                          "https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.mjs",
    "maplibre-gl-terradraw":                "https://cdn.jsdelivr.net/npm/@watergis/maplibre-gl-terradraw@1.6.1/dist/maplibre-gl-terradraw.es.js",
    "terradraw":                            "https://unpkg.com/terra-draw@1.12.0/dist/terra-draw.module.js",
    "@mapbox/polylabel":                    "https://unpkg.com/polylabel@2.0.1/polylabel.js",
    "tinyqueue":                            "https://unpkg.com/tinyqueue@3.0.0/index.js",
    // "@maplibre/maplibre-gl-inspect":        "https://unpkg.com/@maplibre/maplibre-gl-inspect@latest/dist/maplibre-gl-inspect.js",
    "@russss/maplibregl-layer-switcher":    (new URL("assets/components/maplibregl-layer-switcher/lib/index.js", document.currentScript.src)).href,
    "redom":                                "https://unpkg.com/redom@4.3.0/dist/redom.es.js",
    "lodash.isequal":                       "https://unpkg.com/lodash-es@4.17.21/isEqual.js",
    "maplibre-gl-providers":                (new URL("assets/components/maplibre-gl-providers/maplibre-gl-providers.js", document.currentScript.src)).href,
    "@turf/turf":                           "https://unpkg.com/@turf/turf@7.2.0/turf.min.js",
    "maplibre-gl-vector-text-protocol":     (new URL("assets/components/maplibre-gl-vector-text-protocol.esm.js", document.currentScript.src)).href,
}

let BalloonBaseMap_css_links = [
    // "https://unpkg.com/maplibre-gl@5.6.1/dist/maplibre-gl.css",
    "https://unpkg.com/maplibre-gl@6.3.0/dist/maplibre-gl.css",
    "https://cdn.jsdelivr.net/npm/@watergis/maplibre-gl-terradraw@1.4.0/dist/maplibre-gl-terradraw.css",
    // "https://unpkg.com/@maplibre/maplibre-gl-inspect@latest/dist/maplibre-gl-inspect.css",
    (new URL("assets/components/maplibregl-layer-switcher/lib/layerswitcher.css", document.currentScript.src)).href,
    (new URL("assets/BalloonBaseMap.css", document.currentScript.src)).href
]

function inject_BalloonBaseMap() {
    let importmap_el = document.createElement('script');
    importmap_el.type = "importmap";
    importmap_el.appendChild(document.createTextNode(JSON.stringify({
        "imports": {
            ...BalloonBaseMap_import_mappings
        }
    })));
    document.head.appendChild(importmap_el);

    function get_injected_css(url) {
        let link_el = document.createElement('link');
        link_el.href = url;
        link_el.rel = 'stylesheet';
        link_el.type = 'text/css';
        return link_el;
    }

    BalloonBaseMap_css_links.forEach((url, index) => {
        document.head.appendChild(get_injected_css(url));
    });
}
