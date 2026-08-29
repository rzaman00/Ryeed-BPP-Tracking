import * as BalloonBaseMap from "BalloonBaseMap"
import get_predict_linestring from "./assets/scripts/tawhiri_predicts.js";



const layer_defs = BalloonBaseMap.layer_defs;
var map, layer_switcher;

const predicts_data = {
    "type": "FeatureCollection",
    "name": "predicts_data",
    "features": []
};



async function init_predicts_layers(style, layer_defs){
    try {
        // Get the launch locations GeoJSON
        let response = await fetch(style["sources"]["launch_locations"]["data"]);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let launch_locations_json = await response.json();

        // Set up variables
        layer_defs["Predicts"] = [];
        let location_name;
        let location_name_nospace

        // Add the GeoJSON source to the map
        style["sources"]["predicts_data_source"] = {
            "type": "geojson",
            "data": predicts_data
        };

        // Loop through the launch locations and initialize layers for each
        for(const launch_location of launch_locations_json["features"]){
            // Extract the location's city name from its address
            location_name = launch_location["properties"]["address"].match(/(,\s)(.*?)(,\s)/g)[0].replaceAll(', ', '');
            location_name_nospace = location_name.replaceAll(" ", "");
            
            // Push the location's layer def into the layer defs object
            layer_defs["Predicts"].push({
                "id": location_name_nospace,
                "name": location_name,
                "prefix": "2D_predicts_" + location_name_nospace,
                "visible": layer_defs["Predicts"].length < 5 ? true : false, // Set the first 5 predict location layers to be visible after initializing
                "properties": {
                    "longitude": launch_location["properties"]["longitude"],
                    "latitude": launch_location["properties"]["latitude"]
                }
            });

            // Add layers to the style for prediction lines originating from each launch location (so they can be individually toggled)
            style["layers"].push({
                "id": "2D_predicts_" + location_name_nospace,
                "type": "line",
                "source": "predicts_data_source",
                "filter": ["all", ["==", ["get", "name"], location_name], ["==", ["geometry-type"], "LineString"]],
                "layout": {
                    "visibility": "none"
                },
                "paint": {
                    "line-width": 5,
                    "line-color": ["case", 
                        ["==", ["get", "stage"], "ascent"],  "#ff00ff",
                        ["==", ["get", "stage"], "float"],   "#00ff00",
                        ["==", ["get", "stage"], "descent"], "#ff9900",
                        "#0000ff" // fallback color, shouldn't be seen
                    ]
                }
            });
            style["layers"].push({
                "id": "3D_predicts_" + location_name_nospace + "_poly",
                "type": "line",
                "source": "predicts_data_source",
                "filter": ["all", ["==", ["get", "name"], location_name], ["==", ["geometry-type"], "Polygon"]],
                "minzoom": 6,
                "maxzoom": 22,
                "layout": {
                    "visibility": "none"
                },
                "paint": {
                    "line-width": 5,
                    "line-color": ["case", 
                        ["==", ["get", "stage"], "ascent"],  "#ff00ff",
                        ["==", ["get", "stage"], "float"],   "#00ff00",
                        ["==", ["get", "stage"], "descent"], "#ff9900",
                        "#0000ff" // fallback color, shouldn't be seen
                    ]
                }
            });
            style["layers"].push({
                "id": "3D_predicts_" + location_name_nospace,
                "type": "fill-extrusion",
                "source": "predicts_data_source",
                "filter": ["all", ["==", ["get", "name"], location_name], ["==", ["geometry-type"], "Polygon"]],
                "minzoom": 6,
                "maxzoom": 22,
                "layout": {
                    "visibility": "none"
                },
                "paint": {
                    "fill-extrusion-color": ["case", 
                        ["==", ["get", "stage"], "ascent"],  "#ff00ff",
                        ["==", ["get", "stage"], "float"],   "#00ff00",
                        ["==", ["get", "stage"], "descent"], "#ff9900",
                        "#0000ff" // fallback color, shouldn't be seen
                    ],
                    "fill-extrusion-opacity": 0.4,
                    "fill-extrusion-base": 0,
                    "fill-extrusion-height": ["to-number", ["get", "altitude_m"]]
                }
            });
        }

        // Initialize layers for the custom launch locations
        location_name = "Custom Launch Location";
        location_name_nospace = location_name.replaceAll(" ", "");
        // Push the custom location's layer def into the layer defs object
        layer_defs["Predicts"].push({
            "id": location_name_nospace,
            "name": location_name,
            "prefix": "2D_predicts_" + location_name_nospace,
            "visible": true,
            "properties": {
                "longitude": null,
                "latitude": null
            }
        });

        // Add one of each type of layer to the style to display all of prediction lines originating from all of the custom launch locations
        // (because I don't want to try getting the layer switcher to work with dynamic layers)
        style["layers"].push({
            "id": "2D_predicts_" + location_name_nospace,
            "type": "line",
            "source": "predicts_data_source",
            "filter": ["all", ["==", ["slice", ["get", "switcher_id"], 0, location_name_nospace.length], location_name_nospace], ["==", ["geometry-type"], "LineString"]],
            "layout": {
                "visibility": "none"
            },
            "paint": {
                "line-width": 5,
                "line-color": ["case", 
                    ["==", ["get", "stage"], "ascent"],  "#ff0000", // Set the ascent stage of the custom locations to red (like the old map had it)
                    ["==", ["get", "stage"], "float"],   "#00ff00",
                    ["==", ["get", "stage"], "descent"], "#ff9900",
                    "#0000ff" // fallback color, shouldn't be seen
                ]
            }
        });
        style["layers"].push({
            "id": "3D_predicts_" + location_name_nospace + "_poly",
            "type": "line",
            "source": "predicts_data_source",
            "filter": ["all", ["==", ["slice", ["get", "switcher_id"], 0, location_name_nospace.length], location_name_nospace], ["==", ["geometry-type"], "Polygon"]],
            "minzoom": 6,
            "maxzoom": 22,
            "layout": {
                "visibility": "none"
            },
            "paint": {
                "line-width": 5,
                "line-color": ["case", 
                    ["==", ["get", "stage"], "ascent"],  "#ff0000", // Set the ascent stage of the custom locations to red (like the old map had it)
                    ["==", ["get", "stage"], "float"],   "#00ff00",
                    ["==", ["get", "stage"], "descent"], "#ff9900",
                    "#0000ff" // fallback color, shouldn't be seen
                ]
            }
        });
        style["layers"].push({
            "id": "3D_predicts_" + location_name_nospace,
            "type": "fill-extrusion",
            "source": "predicts_data_source",
            "filter": ["all", ["==", ["slice", ["get", "switcher_id"], 0, location_name_nospace.length], location_name_nospace], ["==", ["geometry-type"], "Polygon"]],
            "minzoom": 6,
            "maxzoom": 22,
            "layout": {
                "visibility": "none"
            },
            "paint": {
                "fill-extrusion-color": ["case", 
                    ["==", ["get", "stage"], "ascent"],  "#ff0000", // Set the ascent stage of the custom locations to red (like the old map had it)
                    ["==", ["get", "stage"], "float"],   "#00ff00",
                    ["==", ["get", "stage"], "descent"], "#ff9900",
                    "#0000ff" // fallback color, shouldn't be seen
                ],
                "fill-extrusion-opacity": 0.4,
                "fill-extrusion-base": 0,
                "fill-extrusion-height": ["to-number", ["get", "altitude_m"]]
            }
        });
        

    } catch(error) {
        console.error(error.message);
        return null;
    }
}


/**
 * 
 * @param {*} predicts_layer_defs 
 * @param {*} predict_type 
 * @param {*} predict_options 
 * @returns 
 */
async function call_get_predict_linestring(predicts_layer_defs, predict_type, predict_options){
    return (Promise.all(predicts_layer_defs.map(async (layer_def, index) => {
        let layer_def_predict_options = {
            ...predict_options
        };

        // If the predict_options argument doesn't come with a name, get it from the layer def
        if(!layer_def_predict_options["name"]){
            layer_def_predict_options["name"] = layer_def["name"];
        }

        // Handle custom launch locations
        if(layer_def_predict_options["name"] === "Custom Launch Location"){
            // If the map isn't ready we can't get custom locations, so return undefined
            if(!map){
                return new Promise((resolve, reject) => {
                    resolve(undefined);
                });
            }

            // Get the custom location data from the TerraDraw points source data
            let point_source = map.getSource("td-point");

            // If the TerraDraw point source doesn't exist, return undefined
            if(!point_source){
                return new Promise((resolve, reject) => {
                    resolve(undefined);
                });
            }

            return point_source.getData().then(async (point_data) => {
                // If there aren't any points, return undefined
                if(!point_data["features"]){
                    return new Promise((resolve, reject) => {
                        resolve(undefined);
                    });
                }

                // Filter the points source to only points created from the select mode
                // (so it doesn't fetch predicts for the grab points on a selected shape)
                let custom_point_features = point_data["features"].filter((feature) => {
                    if(feature["properties"]["mode"] === "point"){
                        return true;
                    } else{
                        return false;
                    }
                });

                // If there aren't any custom location points, return undefined
                if(!custom_point_features){
                    return new Promise((resolve, reject) => {
                        resolve(undefined);
                    });
                }

                // Return a promise after getting predicts linestrings for each custom location point
                return Promise.all(custom_point_features.map(async (point_feature, index) => {
                    return get_predict_linestring(predict_type, {
                        ...layer_def_predict_options,
                        "name": point_feature["properties"]["name"],
                        "switcher_id": ("Custom Launch Location - " + point_feature["properties"]["name"] + " - " + point_feature["id"]).replaceAll(" ", ""),
                        "longitude": point_feature["geometry"]["coordinates"][0],
                        "latitude": point_feature["geometry"]["coordinates"][1]
                    });
                })).then((feature_array) => {
                    return feature_array.flat(1);
                });
            });

        // For non-custom launch locations,
        } else{
            // If the predict_options argument doesn't come with lat/long, get it from the layer def
            if(!layer_def_predict_options["longitude"]){
                layer_def_predict_options["longitude"] = layer_def["properties"]["longitude"];
            }
            if(!layer_def_predict_options["latitude"]){
                layer_def_predict_options["latitude"] = layer_def["properties"]["latitude"];
            }

            // Return a promise for the predicts linestring for the location
            return get_predict_linestring(predict_type, layer_def_predict_options);
        }
    }))).then((feature_array) => {
        return feature_array.flat(1);
    });
}



/**
 * 
 * @param {string} predict_type The type of predict to fetch
 * @param {object} predict_options An object of parameters to use in the prediction
 * @param {boolean} [update_map=true] Whether the map (and the internal predicts_data object) should be updated or just the new data returned
 * @returns A GeoJSON object of the fetched predicts
 */
async function fetch_predicts(predict_type, predict_options, update_map=true){
    // If there are specific location ids passed in, perform a differential fetching
    if(predict_options["diff_ids"]){
        let diff_predict_layer_defs;

        // If there is a diff type passed in and the type is specifically "blacklist", fetch every location except the passed in location ids
        if(predict_options["diff_type"] && predict_options["diff_type"] === "blacklist"){
            // Filter the predicts layer defs to all except the passed in location ids
            diff_predict_layer_defs = layer_defs["Predicts"].filter((layer_def) => {
                for(let idx = 0, num_diff_ids = predict_options["diff_ids"].length; idx < num_diff_ids; idx++){
                    if(predict_options["diff_ids"][idx].startsWith(layer_def["id"]) || layer_def["id"].startsWith(predict_options["diff_ids"][idx])){
                        return false;
                    }
                }
                return true;
                // return !predict_options["diff_ids"].includes(layer_def["id"]);
            });

        // Otherwise, fetch only for the passed in location ids
        } else{
            // Filter the predicts layer defs to only the passed in location ids
            diff_predict_layer_defs = layer_defs["Predicts"].filter((layer_def) => {
                if(Array.isArray(predict_options["diff_ids"])){
                    for(let idx = 0, num_diff_ids = predict_options["diff_ids"].length; idx < num_diff_ids; idx++){
                        if(predict_options["diff_ids"][idx].startsWith(layer_def["id"]) || layer_def["id"].startsWith(predict_options["diff_ids"][idx])){
                            return true;
                        }
                    }
                } else{
                    if(predict_options["diff_ids"].startsWith(layer_def["id"]) || layer_def["id"].startsWith(predict_options["diff_ids"])){
                        return true;
                    }
                }
                return false;
                // return predict_options["diff_ids"].includes(layer_def["id"]);
            });
        }

        // Fetch the predict linestrings
        let fetched_predicts = await call_get_predict_linestring(diff_predict_layer_defs, predict_type, predict_options);

        // Filter out undefined features from the returned array (https://stackoverflow.com/a/28607462)
        fetched_predicts = fetched_predicts.filter(function (feature) {
            return feature !== undefined;
        });

        // Check whether the map (and the predicts_data object) should be updated
        if(update_map){
            // If there is a diff type passed in and the type is specifically "blacklist":
            if(predict_options["diff_type"] && predict_options["diff_type"] === "blacklist"){
                // Filter the predicts data features to only those of the passed in location ids
                predicts_data["features"] = predicts_data["features"].filter((feature) => {
                    for(let idx = 0, num_diff_ids = predict_options["diff_ids"].length; idx < num_diff_ids; idx++){
                        if(predict_options["diff_ids"][idx].startsWith(feature["properties"]["switcher_id"]) || feature["properties"]["switcher_id"].startsWith(predict_options["diff_ids"][idx])){
                            return true;
                        }
                    }
                    return false;
                    // return predict_options["diff_ids"].includes(feature["properties"]["id"])
                })

            // Otherwise:
            } else{
                // Filter the predicts data features to all except those of the passed in location ids
                predicts_data["features"] = predicts_data["features"].filter((feature) => {
                    if(Array.isArray(predict_options["diff_ids"])){
                        for(let idx = 0, num_diff_ids = predict_options["diff_ids"].length; idx < num_diff_ids; idx++){
                            if(predict_options["diff_ids"][idx].startsWith(feature["properties"]["switcher_id"]) || feature["properties"]["switcher_id"].startsWith(predict_options["diff_ids"][idx])){
                                return false;
                            }
                        }
                    } else{
                        if(predict_options["diff_ids"].startsWith(feature["properties"]["switcher_id"]) || feature["properties"]["switcher_id"].startsWith(predict_options["diff_ids"])){
                            return false;
                        }
                    }
                    return true;
                    // return !predict_options["diff_ids"].includes(feature["properties"]["id"])
                })
            }

            // Fragment the linestring features for the 3D display
            fetched_predicts = fetched_predicts.concat(BalloonBaseMap.fragment_geojson_linestrings(fetched_predicts));

            // Combine the old predicts data with the newly fetched data
            predicts_data["features"] = predicts_data["features"].concat(fetched_predicts);

            if(map){
                // Overwrite the current predicts source data with the new predicts data
                map.getSource("predicts_data_source").setData(predicts_data);
            }
        }
        // Return the fetched predicts
        return fetched_predicts;

    // Otherwise, fetch new predicts for every location
    } else{
        // Fetch the predict linestrings
        let fetched_predicts = await call_get_predict_linestring(layer_defs["Predicts"], predict_type, predict_options);

        // Filter out undefined features from the returned array (https://stackoverflow.com/a/28607462)
        fetched_predicts = fetched_predicts.filter(function (feature) {
            return feature !== undefined;
        });

        // Check whether the map (and the predicts_data object) should be updated
        if(update_map){
            // Fragment the linestring features for the 3D display
            fetched_predicts = fetched_predicts.concat(BalloonBaseMap.fragment_geojson_linestrings(fetched_predicts));

            // Overwrite the old predicts data with the newly fetched data
            predicts_data["features"] = fetched_predicts;

            if(map){
                // Overwrite the current predicts source data with the new predicts data
                map.getSource("predicts_data_source").setData(predicts_data);
            }
        }
        // Return the fetched predicts
        return fetched_predicts;
    }
}



/**
 * 
 * @param {array || string} predict_ids A or an array of TerraDraw ID strings
 * @param {boolean} [update_map=true] Whether the map (and the internal predicts_data object) should be updated or just the new data returned
 * @returns A GeoJSON object of the updated predicts after removal
 */
function remove_predicts(predict_ids, update_map=true){
    // Filter the predicts data features to all except those of the passed in location ids
    let updated_features = predicts_data["features"].filter((feature) => {
        if(Array.isArray(predict_ids)){
            for(let idx = 0, num_diff_ids = predict_ids.length; idx < num_diff_ids; idx++){
                if(feature["properties"]["switcher_id"].endsWith(predict_ids[idx])){
                    return false;
                }
            }
        } else{
            if(feature["properties"]["switcher_id"].endsWith(predict_ids)){
                return false;
            }
        }
        return true;
        // return !predict_ids.includes(feature["properties"]["id"])
    });

    // Check whether the map (and the predicts_data object) should be updated
    if(update_map){
        // Overwrite the local predicts_data object with the updated features
        predicts_data["features"] = updated_features;

        if(map){
            // Overwrite the current predicts source data with the updated features
            map.getSource("predicts_data_source").setData(predicts_data);
        }
        return predicts_data;
    } else{
        return {
            "type": "FeatureCollection",
            "name": "predicts_data",
            "features": updated_features
        };
    }

}



/**
 * 
 * @returns An array of the predict ids currently set to be visible on the map
 */
function get_visible_predicts_ids(){
    // console.log(layer_switcher._visible);
    // console.log(layer_switcher._layers);
    // console.log(layer_switcher.getLayers());

    // console.log(predicts_data);

    // let visible_predict_layer_defs = (layer_switcher._layers.filter((layer_group) => layer_group.title === "Predicts")[0]["layers"]).filter((layer) => layer.enabled);

    // console.log(visible_predict_layer_defs);

    // console.log((layer_switcher._layers.filter((layer_group) => layer_group.title === "Predicts")[0]["layers"]).map((layer) => layer["id"]));

    // console.log((layer_switcher._layers.filter((layer_group) => layer_group.title === "Predicts")[0]["layers"]).map((layer) => layer["id"]).filter((id) => layer_switcher._visible.includes(id)));

    return (layer_switcher._layers.filter((layer_group) => layer_group.title === "Predicts")[0]["layers"]).map((layer) => layer["id"]).filter((id) => layer_switcher._visible.includes(id));

    // layer_switcher._layers -> index where ["title"] === "Predicts"
    // filter to enabled === true
    // filter predicts_data to id === "predicts_data_(layer ids)"
    // return filtered predicts_data

    // debugger;
}


/**
 * 
 * @param {object} data_obj An object of GeoJSON data to convert to KML
 * @param {Array || string} switcher_id_whitelist An array of strings or a string of switcher_id properties to convert?
 * @returns 
 */
function get_kmls(data_obj={}, switcher_id_whitelist=""){
    // If there isn't an object passed in, use the current predicts data object
    if(!data_obj){
        data_obj = predicts_data;
    }

    // Split the predict linestrings into separate GeoJSON feature collections based on the launch location
    let separated_data_obj = {};
    for(let idx_feature = 0, num_features = data_obj["features"].length; idx_feature < num_features; idx_feature++){
        if(data_obj["features"][idx_feature]["geometry"]["type"] === "LineString"){
            if(Array.isArray(switcher_id_whitelist)){
                for(let idx = 0, num_diff_ids = switcher_id_whitelist.length; idx < num_diff_ids; idx++){
                    if(switcher_id_whitelist[idx].startsWith(data_obj["features"][idx_feature]["properties"]["switcher_id"]) || data_obj["features"][idx_feature]["properties"]["switcher_id"].startsWith(switcher_id_whitelist[idx])){
                        if(separated_data_obj[switcher_id_whitelist[idx]]){
                            separated_data_obj[switcher_id_whitelist[idx]]["features"].push(data_obj["features"][idx_feature]);
                        } else{
                            separated_data_obj[switcher_id_whitelist[idx]] = {
                                "name": "data_obj_" + switcher_id_whitelist[idx],
                                "type": "FeatureCollection",
                                "features": [data_obj["features"][idx_feature]]
                            };
                        }
                    }
                }
            } else if(switcher_id_whitelist === ""){
                separated_data_obj[data_obj["features"][idx_feature]["properties"]["switcher_id"]] = {
                    "name": "data_obj_" + data_obj["features"][idx_feature]["properties"]["switcher_id"],
                    "type": "FeatureCollection",
                    "features": [data_obj["features"][idx_feature]]
                };
            } else{
                if(switcher_id_whitelist.startsWith(data_obj["features"][idx_feature]["properties"]["switcher_id"]) || data_obj["features"][idx_feature]["properties"]["switcher_id"].startsWith(switcher_id_whitelist)){
                    if(separated_data_obj[switcher_id_whitelist]){
                            separated_data_obj[switcher_id_whitelist]["features"].push(data_obj["features"][idx_feature]);
                        } else{
                            separated_data_obj[switcher_id_whitelist] = {
                                "name": "data_obj_" + switcher_id_whitelist,
                                "type": "FeatureCollection",
                                "features": [data_obj["features"][idx_feature]]
                            };
                        }
                }
            }
        }
    }

    // For each separate predict GeoJSON, convert to KML, and store in an array
    let predict_kml_arr = [];
    Object.keys(separated_data_obj).forEach((key) => {
        // Initialize KML document string
        let predict_kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>`;
        
        // Loop through each feature for the predict GeoJSON feature collection
        let feature;
        for(let idx_feature = 0; idx_feature < separated_data_obj[key]["features"].length; idx_feature++){
            feature = separated_data_obj[key]["features"][idx_feature];

            // Initialize a placemark for the feature and extended data to store its properties
            predict_kml += `<Placemark><ExtendedData>`;
            // Loop through feature properties and add to placemark extended data
            let prop_keys = Object.keys(feature["properties"]);
            for(let idx_prop_key = 0; idx_prop_key < prop_keys.length; idx_prop_key++){
                // Skip unneeded properties
                if(prop_keys[idx_prop_key] === "timestamp_arr" || prop_keys[idx_prop_key] === "switcher_id"){
                    continue;
                }
                // Bodge to handle one layer of nested object properties
                if(typeof(feature["properties"][prop_keys[idx_prop_key]]) === typeof(Object())){
                    // Loop through nested object keys
                    let prop_keys_nested = Object.keys(feature["properties"][prop_keys[idx_prop_key]]);
                    for(let idx_prop_key_nested = 0; idx_prop_key_nested < prop_keys_nested.length; idx_prop_key_nested++){
                        // Add to KML data with the upper layer key prepended to the name
                        predict_kml += `<Data name="` + prop_keys[idx_prop_key] + `_` + prop_keys_nested[idx_prop_key_nested] + `"><value>` + feature["properties"][prop_keys[idx_prop_key]][prop_keys_nested[idx_prop_key_nested]] + `</value></Data>`;
                    }
                } else{
                    // Add property to KML data
                    predict_kml += `<Data name="` + prop_keys[idx_prop_key] + `"><value>` + feature["properties"][prop_keys[idx_prop_key]] + `</value></Data>`;
                }
            }
            predict_kml += `</ExtendedData>`;

            // Create a name for the placemark out of the site name and flight stage
            predict_kml += `<name>` + feature["properties"]["name"] + " " + feature["properties"]["stage"] + `</name>`;

            // Loop though the GeoJSON coordinates and add them and their associated timestamps to a track
            predict_kml += `<gx:Track><extrude>1</extrude><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode>`;
            for(let idx_coord = 0; idx_coord < feature["geometry"]["coordinates"].length; idx_coord++){
                predict_kml += `<when>` + feature["properties"]["timestamp_arr"][idx_coord] + `</when>`;
                predict_kml += `<gx:coord>` + feature["geometry"]["coordinates"][idx_coord][0] + " "  + feature["geometry"]["coordinates"][idx_coord][1] + " "  + feature["geometry"]["coordinates"][idx_coord][2] + `</gx:coord>`;
            }
            predict_kml += `</gx:Track></Placemark>`;
        }
        
        // Close the KML doc
        predict_kml += `</Document></kml>`;

        let predict_name;
        // Encode the predict parameters into the predict name
        feature = separated_data_obj[key]["features"][0];
        if(feature["properties"]["type"] === "burst"){
            predict_name = "predict_"
                + feature["properties"]["dataset"].replace(/[-_: UTC]/g, '').substring(0, 12) + "Z_"
                + key + "_"
                + feature["properties"]["type"] + "_"
                + feature["properties"]["launch_datetime"].replace(/[-_: UTC]/g, '').substring(0, 12) + "Z_"
                + feature["properties"]["ascent_rate"] + "_"
                + feature["properties"]["burst_altitude"] + "_"
                + feature["properties"]["sea_level_descent_rate"];
        } else if(feature["properties"]["type"] === "stitchfloat"){
            predict_name = "predict_"
                + feature["properties"]["dataset"].replace(/[-_: UTC]/g, '').substring(0, 12) + "Z_"
                + key + "_"
                + feature["properties"]["type"] + "_"
                + feature["properties"]["launch_datetime"].replace(/[-_: UTC]/g, '').substring(0, 12) + "Z_"
                + feature["properties"]["ascent_rate"] + "_"
                + feature["properties"]["float_altitude"] + "_"
                + feature["properties"]["float_ascent_rate"] + "_"
                + feature["properties"]["float_duration"] + "_"
                + feature["properties"]["sea_level_descent_rate"];
        } else{
            predict_name = 'predict_' + feature["properties"]["dataset"].replace(/[-_: UTC]/g, '').substring(0, 12) + "Z_" + key;
        }
        
        // Save the predict kml to the object under the key
        predict_kml_arr.push({
            "name": predict_name,
            "kml": predict_kml
        });
    });

    // Return the array of saved predict kmls
    return predict_kml_arr;
}




/**
 * init_BalloonPredictionMap - 
 * @param {string} container_id : HTML ID of the container to store the prediction map in
 */
async function init_BalloonPredictionMap(container_id){
    // Initialize the base map style and layers
    return BalloonBaseMap.init_base_map_layers().then(async (map_style) => {

        // Initialize predicts layer definitions
        return init_predicts_layers(map_style, layer_defs).then(() => {

            // Create a layer switcher and initialize layer visibility
            let layer_switcher_obj = BalloonBaseMap.create_layer_switcher(map_style, layer_defs, ["Basemap", "Reference", "Predicts"]);
            layer_switcher = layer_switcher_obj["layer_switcher"];
    
            // Create the maplibre-gl map in the given container div
            map = BalloonBaseMap.create_BalloonBaseMap(container_id, map_style, layer_switcher);
    
            // Create a TerraDraw drawing control
            let draw_control = BalloonBaseMap.create_map_drawing_control(container_id, map);
    
            let rendered_points = {};
    
            // Set layers in the "Reference" group to show their properties when clicked
            BalloonBaseMap.set_show_props_on_click(map, layer_defs, ["Reference", "Predicts"], (feature, popup_coordinates, popup_handle) => {
                // Filter to only run on public school locations
                if(feature["source"] === "public_schools"){
                    let feature_name = feature["properties"]["NAME"].replaceAll(" ", "_");
    
                    // Create a button in the popup to create a point
                    let create_point_btn = document.createElement("button");
                    create_point_btn.innerText = "Create point here";
                    // Create a button in the popup to create a point
                    let delete_point_btn = document.createElement("button");
                    delete_point_btn.innerText = "Delete point";
    
                    // If the point already exists,
                    if(rendered_points[feature_name]){
                        // Disable the create button and enable the delete button
                        create_point_btn.disabled = true;
                        delete_point_btn.disabled = false;
                    } else{
                        // Otherwise, enable the create button and disable the delete button
                        create_point_btn.disabled = false;
                        delete_point_btn.disabled = true;
                    }
    
                    // Add a listener to the create button to create a TerraDraw point at the popup location
                    create_point_btn.addEventListener("click", (event) => {
                        let draw_instance = draw_control.getTerraDrawInstance();
                        if(draw_instance && !rendered_points[feature_name]){
                            try{
                                let status = draw_instance.addFeatures([{
                                    "type": "Feature",
                                    "geometry": {
                                        "type": "Point",
                                        "coordinates": [Math.round((popup_coordinates[0])*1e6) / 1e6, Math.round((popup_coordinates[1])*1e6) / 1e6]
                                    },
                                    "properties": {
                                        "mode":"point",
                                        "name": feature_name
                                    }
                                }]);
    
                                if(status[0]["valid"]){
                                    rendered_points[feature_name] = status[0]["id"];
                                    create_point_btn.disabled = true;
                                    delete_point_btn.disabled = false;
    
                                } else{
                                    // If creating the point didn't work, log the status
                                    console.log(status);
                                }
                            } catch(error){
                                console.warn(error);
                            }
                        }
                    });
    
                    // Add a listener to the delete button to delete the TerraDraw point
                    delete_point_btn.addEventListener("click", (event) => {
                        let draw_instance = draw_control.getTerraDrawInstance();
                        if(draw_instance && rendered_points[feature_name]){
                            try{
                                draw_instance.removeFeatures([rendered_points[feature_name]]);
                                delete rendered_points[feature_name];
                                create_point_btn.disabled = false;
                                delete_point_btn.disabled = true;
                            } catch({ name, message }){
                                if(message.startsWith("No feature with")){
                                    delete rendered_points[feature_name];
                                    create_point_btn.disabled = false;
                                    delete_point_btn.disabled = true;
                                } else{
                                    console.warn(message);
                                }
                            }
                            
                        }
                    });
    
                    // Add the buttons to the popup
                    popup_handle.getElement().querySelector("pre").after(create_point_btn);
                    create_point_btn.after(delete_point_btn);
    
                    
                // If the target is from the TFR airspaces, add a link to the TFR detail page to the properties
                } else if(feature["source"] === "tfr_airspace"){
                    let split_key = feature["properties"]["NOTAM_KEY"].split("")
                    let link_text = "https://tfr.faa.gov/tfr3/?page=detail_" + split_key[0] + "_" + split_key.slice(2,6).join("") + ".html";
                    
                    let tfr_link = document.createElement("a");
                    tfr_link.target = "_blank";
                    tfr_link.href = link_text;
                    tfr_link.innerText = "NOTAM Details Link";

                    // Add the link to the popup
                    popup_handle.getElement().querySelector("pre").after(tfr_link);

                }
            });
    
            return {
                "map": map,
                "map_style": map_style,
                "layer_switcher": layer_switcher,
                "draw_control": draw_control
            };
        });
    });
}



export default init_BalloonPredictionMap
export {
    init_BalloonPredictionMap,
    fetch_predicts,
    remove_predicts,
    get_visible_predicts_ids,
    get_kmls
}
export {update_national_address_source_data} from "BalloonBaseMap"