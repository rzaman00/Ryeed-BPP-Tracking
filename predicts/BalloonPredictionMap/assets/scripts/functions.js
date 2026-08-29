let SELECTED_FEATURE;
let SELECTED_FEATURE_ORIGINAL_STYLE;

String.prototype.replaceAll = function (search, replacement) {
    if (typeof search == 'string') {
        return this.replace(new RegExp(search, 'g'), replacement);
    } else {
        return this.replace(search, replacement);
    }
};

function featurePropertiesHTML(feature) {
    return JSON.stringify(feature.properties, function (key, value) {
        return key !== 'fid' ? value : undefined;
    }, ' ').replace(/[{}]/g, '');
}

function popupFeaturePropertiesOnClick(feature, layer) {
    layer.bindPopup('<pre>' + featurePropertiesHTML(feature) + '</pre>');
}

function highlightFeature(feature) {
    feature.setStyle({'color': '#12cbc4', 'weight': feature.options.weight + 3});
    feature.bringToFront();
}

function highlightFeatureOnClick(feature, layer) {
    layer.on('click', function (click_event) {
        if (SELECTED_FEATURE != null && SELECTED_FEATURE_ORIGINAL_STYLE != null) {
            SELECTED_FEATURE.setStyle(SELECTED_FEATURE_ORIGINAL_STYLE(SELECTED_FEATURE.feature));
        }

        SELECTED_FEATURE = click_event.target;

        if (SELECTED_FEATURE.setStyle != null) {
            SELECTED_FEATURE_ORIGINAL_STYLE = SELECTED_FEATURE.options.style;
            highlightFeature(SELECTED_FEATURE);
        } else {
            SELECTED_FEATURE = null;
            SELECTED_FEATURE_ORIGINAL_STYLE = null;
        }
    });
}

function highlightAndPopupOnClick(feature, layer) {
    highlightFeatureOnClick(feature, layer);
    popupFeaturePropertiesOnClick(feature, layer);
}

/* return the overall bounds of multiple layers */
function bounds(layers) {
    let northeast = layers[0].getBounds().getNorthEast();
    let southwest = layers[0].getBounds().getSouthWest();

    for (let layer of layers) {
        let bounds = layer.getBounds();
        if (bounds.getNorth() > northeast.lat) {
            northeast.lat = bounds.getNorth();
        }
        if (bounds.getEast() > northeast.lng) {
            northeast.lng = bounds.getEast();
        }
        if (bounds.getSouth() < southwest.lat) {
            southwest.lat = bounds.getSouth();
        }
        if (bounds.getWest() < southwest.lng) {
            southwest.lng = bounds.getWest();
        }
    }

    return L.latLngBounds([northeast.lat, northeast.lng], [southwest.lat, southwest.lng]);
}

L.Control.GroupedLayers.include({
    'getActiveOverlayLayers': function () {
        let active_layers = {};
        let layers = this._layers;
        let map = this._map;
        let layer_groups = this._groupList;

        for (let layer_group of layer_groups) {
            if (active_layers[layer_group] == null) {
                active_layers[layer_group] = {};
            }
        }

        for (let layer of layers) {
            if (layer.overlay && map.hasLayer(layer.layer)) {
                let layer_group = layer.group.name;

                if (active_layers[layer_group] == null) {
                    active_layers[layer_group] = {};
                }

                active_layers[layer_group][layer.name] = layer.layer;
            }
        }

        return active_layers;
    }, 'getOverlayLayers': function () {
        let overlay_layer_names = {};
        let layers = this._layers;

        layers.forEach(function (layer) {
            if (layer.overlay) {
                let layer_group = layer.group.name;

                if (!overlay_layer_names[layer_group]) {
                    overlay_layer_names[layer_group] = {};
                }

                overlay_layer_names[layer_group][layer.name] = layer.layer;
            }
        });

        return overlay_layer_names;
    }
});

async function resizeToOverlayLayers() {
    let active_overlay_layers = LAYER_CONTROL.getActiveOverlayLayers();

    let layers = [];

    for (let layer_group_name in active_overlay_layers) {
        if (layer_group_name !== 'reference' && layer_group_name !== '') {
            let layer_group = active_overlay_layers[layer_group_name];

            if (layer_group != null) {
                if (Object.keys(layer_group).length > 0) {
                    layers.push(...Object.values(layer_group));
                }
            }
        }
    }

    if (layers.length > 0) {
        MAP.fitBounds(bounds(layers), {'padding': [50, 50]});
    }
}

/* send reference layers to the back, to be overlapped by all other layers */
function sinkReferenceLayers(add_event) {
    if (add_event.overlay) {
        if (add_event.group.name === 'reference') {
            let added_layer = add_event.layer;
            added_layer.bringToBack();
        }
    }
}
