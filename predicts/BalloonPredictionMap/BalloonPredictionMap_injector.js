let BalloonPredictionMap_import_mappings = {
    "BalloonBaseMap":   (new URL("BalloonBaseMap/BalloonBaseMap.js", document.currentScript.src)).href,
    "jszip":            "https://cdn.jsdelivr.net/npm/@progress/jszip-esm@1.0.4/+esm"
}

let BalloonPredictionMap_css_links = [
    (new URL("assets/BalloonPredictionMap.css", document.currentScript.src)).href,
]

async function inject_BalloonPredictionMap() {
    let importmap_el = document.createElement('script');
    importmap_el.type = "importmap";
    importmap_el.appendChild(document.createTextNode(JSON.stringify({
        "imports": {
            ...BalloonBaseMap_import_mappings,
            ...BalloonPredictionMap_import_mappings
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

    BalloonPredictionMap_css_links = [
        ...BalloonBaseMap_css_links,
        ...BalloonPredictionMap_css_links
    ];

    BalloonPredictionMap_css_links.forEach((url, index) => {
        document.head.appendChild(get_injected_css(url));
    });
}
