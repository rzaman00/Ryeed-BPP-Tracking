// import "maplibre-gl";
import * as maplibregl from "maplibre-gl";
import { MaplibreTerradrawControl } from "maplibre-gl-terradraw";
import { TerraDrawSelectMode } from "terradraw";
import polylabel from "@mapbox/polylabel";
// import "@maplibre/maplibre-gl-inspect";
import { LayerSwitcher, Layer, LayerGroup } from "@russss/maplibregl-layer-switcher"
import { maplibre_gl_provider } from "maplibre-gl-providers"
import "@turf/turf"
import { addProtocols } from "maplibre-gl-vector-text-protocol"


// Create an object of switchable layer definitions
const layer_defs = {};



/**
 * create_base_map_style creates the initial map style for the BalloonBaseMap, with each of the map's basemaps included using the separate maplibre_gl_providers library
 * @param {Array<string>} provider_ids : An array of maplibre_gl_providers provider ID strings to include on the returned map style
 * @returns a MapLibre GL JS-compatible style object
 */
async function create_base_map_style(provider_ids){
    // Declare variables
    let map_style_result
    let map_style = {};

    // Loop through each provider ID and create a map style with all of them sequentially included
    for(const provider_id of provider_ids){
        map_style_result = await maplibre_gl_provider(provider_id, map_style);
        if(!map_style_result["success"]){
            throw new Error(`Problem in MapLibre-GL-Provider: ${map_style_result.error}`);
        }
        map_style = map_style_result["style"];
    }
    
    // Return the final combined map style
    return map_style;
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 * @returns a MapLibre GL JS-compatible style object
 */
async function append_airspace_layers(style, layer_prefixes) {
    // Add the airspace GeoJSON sources to the map
    style["sources"]["controlled_airspace"] = {
        type: "geojson",
        // data: (new URL("assets/data/controlled_airspace_reduced.geojson", import.meta.url)).href
        data: {
            "type": "FeatureCollection",
            "name": "controlled_airspace",
            "features": []
        }
    };
    style["sources"]["uncontrolled_airspace"] = {
        type: "geojson",
        // data: (new URL("assets/data/uncontrolled_airspace_reduced.geojson", import.meta.url)).href
        data: {
            "type": "FeatureCollection",
            "name": "uncontrolled_airspace",
            "features": []
        }
    };
    style["sources"]["tfr_airspace"] = {
        type: "geojson",
        data: (new URL("assets/data/tfr_airspace.geojson", import.meta.url)).href
    };
    // let style_result = await maplibre_gl_provider("FAA.V_TFR_LOC", style);
    // if(!style_result["success"]){
    //     throw new Error(`Problem in MapLibre-GL-Provider: ${style_result.error}`);
    // }
    // style = style_result["style"];

    // Append 2D airspace layers
    let layer_prefix_ctrl = layer_prefixes["ctrlair"];
    if(layer_prefix_ctrl.substring(0,3) !== "2D_"){
        layer_prefix_ctrl = "2D_" + layer_prefix_ctrl;
    }
    let layer_prefix_unctrl = layer_prefixes["unctrlair"];
    if(layer_prefix_unctrl.substring(0,3) !== "2D_"){
        layer_prefix_unctrl = "2D_" + layer_prefix_unctrl;
    }
    let layer_prefix_tfr = layer_prefixes["tfr"];
    // Source doesn't come with altitude for the moment, so the dimensionality does nothing currently
    if(layer_prefix_tfr.substring(0,3) !== "2D_"){
        layer_prefix_tfr = "2D_" + layer_prefix_tfr;
    }

    let fill_opacity_2D = "0.4";
    let airspace_layer_object = {
        "id": layer_prefix_unctrl + "_default",
        "type": "fill",
        "source": "uncontrolled_airspace",
        "layout": {
            "visibility": "none"
        },
        "paint": {
            "fill-color": "rgba(111,30,81,"+fill_opacity_2D+")", // #6f1e51
            "fill-outline-color": "rgba(111,30,81,1)" // #6f1e51
        }
    };
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_default";
    airspace_layer_object["source"] = "controlled_airspace";
    airspace_layer_object["filter"] = ["all", 
        ["!=", "LOCAL_TYPE", "R"],
        ["!=", "LOCAL_TYPE", "CLASS_B"],
        ["!=", "LOCAL_TYPE", "CLASS_C"],
        ["!=", "LOCAL_TYPE", "CLASS_D"],
    ];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_R";
    airspace_layer_object["paint"]["fill-color"] = "rgba(234,32,39,"+fill_opacity_2D+")"; // #ea2027
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(234,32,39,1)"; // #ea2027
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "R"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_B";
    airspace_layer_object["paint"]["fill-color"] = "rgba(6,82,221,"+fill_opacity_2D+")"; // #0652dd
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(6,82,221,1)"; // #0652dd
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_B"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_C";
    airspace_layer_object["paint"]["fill-color"] = "rgba(111,30,81,"+fill_opacity_2D+")"; // "#6f1e51
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(111,30,81,1)"; // #6f1e51
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_C"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_D";
    airspace_layer_object["paint"]["fill-color"] = "rgba(6,82,221,"+fill_opacity_2D+")"; // #0652dd
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(6,82,221,1)"; // #0652dd
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_D"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_tfr + "_default";
    airspace_layer_object["source"] = "tfr_airspace"
    // airspace_layer_object["source"] = style["metadata"]["maplibre-gl-providers:prefixes"]["FAA.V_TFR_LOC"] + "_source";
    airspace_layer_object["paint"]["fill-color"] = "rgba(127,17,224,"+fill_opacity_2D+")"; // #7f11e0
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(127,17,224,1)"; // #7f11e0
    airspace_layer_object["filter"] = undefined;
    style["layers"].push($.extend(true, {}, airspace_layer_object));


    // Append 3D airspace layers    
    layer_prefix_ctrl= "3D_" + layer_prefix_ctrl.substring(3);
    layer_prefix_unctrl= "3D_" + layer_prefix_unctrl.substring(3);
    layer_prefix_tfr= "3D_" + layer_prefix_tfr.substring(3);

    // ================================================================================================
    // Temp spot for this
    airspace_layer_object["id"] = layer_prefix_tfr + "_default";
    airspace_layer_object["source"] = "tfr_airspace"
    // airspace_layer_object["source"] = style["metadata"]["maplibre-gl-providers:prefixes"]["FAA.V_TFR_LOC"] + "_source";
    airspace_layer_object["paint"]["fill-color"] = "rgba(127,17,224,"+fill_opacity_2D+")"; // #7f11e0
    airspace_layer_object["paint"]["fill-outline-color"] = "rgba(127,17,224,1)"; // #7f11e0
    style["layers"].push($.extend(true, {}, airspace_layer_object));
    // ================================================================================================

    airspace_layer_object = {
        "id": layer_prefix_unctrl + "_default",
        "type": "fill-extrusion",
        "source": "uncontrolled_airspace",
        "layout": {
            "visibility": "none"
        },
        "paint": {
            "fill-extrusion-color": "#6f1e51",
            "fill-extrusion-opacity": 0.4,
            // Get the 3D geo base/height from the GeoJSON. The field can have a decimal, so it has to be converted from a string, and it's in feet, so it should be converted to meters
            "fill-extrusion-base": ["*", ["to-number", ["get", "LOWER_VAL"]], 0.3048],
            "fill-extrusion-height": ["*", ["to-number", ["get", "UPPER_VAL"]], 0.3048]
        }
    };
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_default";
    airspace_layer_object["source"] = "controlled_airspace";
    airspace_layer_object["filter"] = ["all", 
        ["!=", "LOCAL_TYPE", "R"],
        ["!=", "LOCAL_TYPE", "CLASS_B"],
        ["!=", "LOCAL_TYPE", "CLASS_C"],
        ["!=", "LOCAL_TYPE", "CLASS_D"],
    ];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_R";
    airspace_layer_object["paint"]["fill-extrusion-color"] = "#ea2027";
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "R"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_B";
    airspace_layer_object["paint"]["fill-extrusion-color"] = "#0652dd";
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_B"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_C";
    airspace_layer_object["paint"]["fill-extrusion-color"] = "#6f1e51";
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_C"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    airspace_layer_object["id"] = layer_prefix_ctrl + "_CLASS_D";
    airspace_layer_object["paint"]["fill-extrusion-color"] = "#0652dd";
    airspace_layer_object["filter"] = ["==", "LOCAL_TYPE", "CLASS_D"];
    style["layers"].push($.extend(true, {}, airspace_layer_object));

    return style;
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_public_school_locations(style, layer_prefixes) {
    // Add the GeoJSON source to the map
    style["sources"]["public_schools"] = {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "name": "public_school_locations",
            "features": []
        },
        "attribution": "NCES EDGE"
    };

    // Add a layer of circle markers for the points
    style["layers"].push({
        "id": layer_prefixes["schools"],
        "type": "circle",
        "source": "public_schools",
        "paint": {
            "circle-radius": 4,
            "circle-color": "#24ee2e",
            "circle-opacity": 0.8,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#000000",
            "circle-stroke-opacity": 1
        }
    });

    // Add the GeoJSON source to the map
    // style["sources"]["public_schools"] = {
    //     "type": "geojson",
    //     "data": {
    //         "type": "FeatureCollection",
    //         "name": "public_school_locations",
    //         "features": []
    //     },
    //     "attribution": "NCES EDGE",
    //     "cluster": true,
    //     "clusterMaxZoom": 14, // Max zoom to cluster points on
    //     "clusterRadius": 50 // Radius of each cluster when clustering points (defaults to 50)
    // };

    // Add a layer of circle markers for the unclustered points
    // style["layers"].push({
    //     "id": layer_prefixes["schools"],
    //     "type": "circle",
    //     "source": "public_schools",
    //     "filter": ['!', ['has', 'point_count']],
    //     "paint": {
    //         "circle-radius": 4,
    //         "circle-color": "#24ee2e",
    //         "circle-opacity": 0.8,
    //         "circle-stroke-width": 1,
    //         "circle-stroke-color": "#000000",
    //         "circle-stroke-opacity": 1
    //     }
    // });

    // // Add a layer of circle markers for the clustered points
    // style["layers"].push({
    //     "id": layer_prefixes["schools"] + "_clustered",
    //     "type": "circle",
    //     "source": "public_schools",
    //     "filter": ['has', 'point_count'],
    //     "paint": {
    //         "circle-color": "#24ee2e",
    //         "circle-radius": 20
    //     }
    // });

    // // Add a layer of labels for the clustered points
    // style["layers"].push({
    //     "id": layer_prefixes["schools"] + "_clustered_label",
    //     "type": "symbol",
    //     "source": "public_schools",
    //     "filter": ['has', 'point_count'],
    //     "layout": {
    //         'text-field': '{point_count_abbreviated}',
    //         'text-font': ['Noto Sans Regular'],
    //         'text-size': 12
    //     }
    // });







    // This source now uses pagniation and only serves 2000 school entries at a time. Since there are ~102,000 entries total, that 2000 doesn't cover much. I'll need to either download the dataset and
    // compile a static geoJSON to serve, loop through the pages and grab every one and compile a geoJSON on-the-fly (slow and inefficient), or set it to only grab schools in the MD-PA area (locked to using this area only).
    // I'm leaning towards making a static geoJSON to deal with this because I can cut it to down to only the info we care about (name and address basically), the info we use shouldn't be changing anywhere near often enough
    // to justify getting an updated version every load, and we already use a static geoJSON for McDonalds locations and I can combine the functions if this is also a static geoJSON

    // try {
    //     let url_query_base = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2223/MapServer/0/query?where=1%3D1&";

    //     // Get the count of public school locations
    //     let response = await fetch(url_query_base + "returnCountOnly=true&f=json");
    //     if (!response.ok) {
    //         throw new Error(`Response status: ${response.status}`);
    //     }
    //     let public_schools_count = (await response.json())["count"];

    //     // https://stackoverflow.com/questions/68596195/mapbox-gl-adding-multiple-geojson-layers-with-distinct-ids-returns-error

        
        
        
    //     // // Go through the returned style JSON object's sources and replace tile paths with actual URLs and add attributions
    //     // await Promise.all(Object.keys(tile_layer_style["sources"]).map(async (source_key) => {
    //     //     if(tile_layer_style["sources"][source_key]["url"]){
    //     //         tile_layer_style["sources"][source_key]["tiles"] = [
    //     //             (tile_layer_style["sources"][source_key]["url"] + "/tile/{z}/{y}/{x}.pbf")
    //     //         ];
    //     //         tile_layer_style["sources"][source_key]["attribution"] = await get_copyrightText(tile_layer_style["sources"][source_key]["url"]);
    //     //         delete tile_layer_style["sources"][source_key]["url"];
    //     //     }
    //     // }));

    //     // // Loop through the style layers and remove all but the first font for each to fix "Unimplemented type 3" from fonts not being found
    //     // tile_layer_style["layers"].forEach((layer, index) => {
    //     //     if(layer.layout){
    //     //         if(layer["layout"]["text-font"]){
    //     //             tile_layer_style["layers"][index]["layout"]["text-font"] = [layer["layout"]["text-font"][0]];
    //     //         }
    //     //     }
    //     // });

    //     // // console.log(tile_layer_style);
    //     // return tile_layer_style;

    // } catch(error) {
    //     console.error(error.message);
    // }

    // let public_schools_attrib = await get_copyrightText("https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2223/MapServer/0?f=pjson")

    // map.addSource("public_schools", {
    //     type: "geojson",
    //     data: "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_GEOCODE_PUBLICSCH_2223/MapServer/0/query?where=1%3D1&outFields=NAME%2CSTREET%2CCITY%2CSTATE%2CZIP&returnGeometry=true&geometryPrecision=6&f=geojson",
    //     attribution: public_schools_attrib
    // });

    // map.addLayer({
    //     id: "public_schools",
    //     type: "circle",
    //     source: "public_schools",
    //     paint: {
    //         "circle-radius": 4,
    //         "circle-color": "#24ee2e",
    //         "circle-opacity": 0.8,
    //         "circle-stroke-width": 1,
    //         "circle-stroke-color": "#000000",
    //         "circle-stroke-opacity": 1
    //     }
    // });

}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_mcdonalds_locations(style, layer_prefixes) {
    // Add the GeoJSON sources to the map
    style["sources"]["mcdonalds_locations"] = {
        "type": "geojson",
        "data": (new URL("assets/data/mcdonalds_locations.geojson", import.meta.url)).href
    };

    // Add a layer of circle markers for the GeoJSON source
    style["layers"].push({
        "id": layer_prefixes["mcdonalds"],
        "type": "circle",
        "source": "mcdonalds_locations",
        "paint": {
            "circle-radius": 4,
            "circle-color": "#ffc72c",
            "circle-opacity": 0.8,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#000000",
            "circle-stroke-opacity": 1
        }
    });
}



/**
 * append_dunkin_locations adds a layer for Dunkin' Donuts locations from a server-side GeoJSON file.
 * The original code to generate the GeoJSON file of Dunkin' Donuts locations was made by JP Bulman and retrieved from https://www.kaggle.com/datasets/jpbulman/usa-dunkin-donuts-stores/data under a 
 * Creative Commons Attribution 4.0 International license (https://creativecommons.org/licenses/by/4.0/). The code was modified by Jeremy Snyder to produce the unreduced version of the GeoJSON file used here
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_dunkin_locations(style, layer_prefixes) {
    // Add the GeoJSON sources to the map
    style["sources"]["dunkin_donuts_locations"] = {
        "type": "geojson",
        "data": (new URL("assets/data/dunkinDonuts_reduced.geojson", import.meta.url)).href,
        "attribution": "JP Bulman"
    };

    // Add a layer of circle markers for the GeoJSON source
    style["layers"].push({
        "id": layer_prefixes["dunkin"],
        "type": "circle",
        "source": "dunkin_donuts_locations",
        "paint": {
            "circle-radius": 4,
            "circle-color": "#da1884",
            "circle-opacity": 0.8,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#000000",
            "circle-stroke-opacity": 1
        }
    });
}



/**
 * append_national_address_database adds a layer for National Address Database locations from a server-side GeoJSON file
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_national_address_database(style, layer_prefixes) {
    // Add the GeoJSON sources to the map
    style["sources"]["national_address_database"] = {
        "type": "geojson",
        "data": {
            "type": "FeatureCollection",
            "name": "national_address_database",
            "features": []
        },
        "attribution": "USDOT"
    };

    // Add a layer of circle markers for the GeoJSON source
    style["layers"].push({
        "id": layer_prefixes["national_address_database"],
        "type": "circle",
        "source": "national_address_database",
        "paint": {
            "circle-radius": 4,
            "circle-color": "#0084ff",
            "circle-opacity": 0.8,
            "circle-stroke-width": 1,
            "circle-stroke-color": "#000000",
            "circle-stroke-opacity": 1
        }
    });
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_launch_locations(style, layer_prefixes) {
    // Add the GeoJSON sources to the map
    style["sources"]["launch_locations"] = {
        "type": "geojson",
        "data": (new URL("assets/data/launch_locations.geojson", import.meta.url)).href
    };

    // Add a layer of circle markers for the GeoJSON source
    style["layers"].push({
        "id": layer_prefixes["launchlocs"],
        "type": "circle",
        "source": "launch_locations",
        "paint": {
            "circle-radius": 6,
            "circle-color": "#ffffff",
            "circle-opacity": 1,
            "circle-stroke-width": 6,
            "circle-stroke-color": "#0059ff",
            "circle-stroke-opacity": 1
        }
    });
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 */
function append_poi(style, layer_prefixes) {
    // Add the GeoJSON sources to the map
    style["sources"]["poi"] = {
        "type": "geojson",
        "data": (new URL("assets/data/poi.geojson", import.meta.url)).href
    };

    // Add a layer of circle markers for the GeoJSON source
    style["layers"].push({
        "id": layer_prefixes["poi"],
        "type": "circle",
        "source": "poi",
        "paint": {
            "circle-radius": 6,
            "circle-color": "#ffffff",
            "circle-opacity": 1,
            "circle-stroke-width": 6,
            "circle-stroke-color": "#ff0000",
            "circle-stroke-opacity": 1
        }
    });
}



/**
 * append_map_reference_layers adds reference layers to an existing map style. Reference layers added are:
 *  - US controlled and uncontrolled airspaces in 2D and 3D from a server-side GeoJSON file
 *  - US public schools
 *  - US McDonalds locations from a server-side GeoJSON file
 *  - US Dunkin' Donuts locations from a server-side GeoJSON file
 *  - Common BPP launch locations from a server-side GeoJSON file
 * 
 * @param {object} map_style a MapLibre GL JS-compatible style object
 * @param {Array<object>} layer_prefixes an object where keys are IDs unique to each layer added and the associated values are the prefixes applied to the added layers' IDs
 * @returns a MapLibre GL JS-compatible style object
 */
async function append_map_reference_layers(map_style, layer_prefixes){
    // Append US airspace reference layers to the map style
    map_style = await append_airspace_layers(map_style, layer_prefixes[0]);

    // Append the National Address Database locations layer
    append_national_address_database(map_style, layer_prefixes[1])

    // Append the US public schools layer
    append_public_school_locations(map_style, layer_prefixes[2]);

    // Append the US McDonalds locations layer
    append_mcdonalds_locations(map_style, layer_prefixes[3]);

    // Append the Dunkin Donuts locations layer
    append_dunkin_locations(map_style, layer_prefixes[4]);

    // Append the BPP launch locations layer
    append_launch_locations(map_style, layer_prefixes[5]);

    // Append the BPP POI layer
    append_poi(map_style, layer_prefixes[6]);

    return map_style;
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_defs an object of layer group and layer definitions used to create a layer switcher
 * @param {Array<string>} layer_group_keys an array of strings corresponding to the layer groups in layer_defs
 */
function create_layer_switcher(style, layer_defs, layer_group_keys) {
    let layer_switcher_array = [
        // These are here to make the radio buttons in the switcher but won't be used by the actual layer switcher
        new LayerGroup("Map Dimensions", [
            new Layer("map_2D", "2D", "-----", "dimensions", true),
            new Layer("map_3D", "3D", "-----", "dimensions", false)
        ])
    ];
    let layer_array

    for(const layer_group_key of layer_group_keys){
        layer_array = [];
        for(const layer_def of layer_defs[layer_group_key]){
            layer_array.push(new Layer(layer_def["id"], layer_def["name"], layer_def["prefix"], (layer_def["group"] ? layer_def["group"] : layer_def["visible"]), layer_def["visible"]));
        }
        layer_switcher_array.push(new LayerGroup(layer_group_key, layer_array));
    }

    const layer_switcher = new LayerSwitcher(layer_switcher_array);
    layer_switcher.setInitialVisibility(style);

    return {
        "layer_switcher": layer_switcher,
        "layer_groups": layer_switcher_array
    };
}



/**
 * Steal the "Map Dimensions" radio buttons from the layer switcher and use them for controlling the map's dimensionality (set to 2D or 3D)
 * @param {object} map a Maplibre GL JS map object
 * @param {object} layer_switcher a maplibregl-layer-switcher object
 */
function init_dimension_switching(map, layer_switcher){
    let dimension_radio_inputs = layer_switcher._container.querySelectorAll(`li label input[name="dimensions"]`);
    dimension_radio_inputs[0].removeEventListener("change", dimension_radio_inputs[0].onchange, false);
    dimension_radio_inputs[1].removeEventListener("change", dimension_radio_inputs[1].onchange, false);

    function switch_dimensionality(event){
        let dim_start, dim_end;
        // If the 2D radio button was selected
        if(event.currentTarget.value === "map_2D"){
            // Reset the pitch and rotation
            // map.resetNorthPitch();

            // Set starting and ending dimension variables
            dim_start = "3";
            dim_end = "2";
            
            // These are supposed to disable map rotation, but they don't seem to work properly
            // // disable map rotation using right click + drag
            // map.dragRotate.disable();
            // // disable map rotation using keyboard
            // map.keyboard.disable();
            // // disable map rotation using touch rotation gesture
            // map.touchZoomRotate.disableRotation();

        // If the 3D radio button was selected
        } else if(event.currentTarget.value === "map_3D"){
            // Set starting and ending dimension variables
            dim_start = "2";
            dim_end = "3";
            
            // These are supposed to re-enable map rotation, but disabling doesn't seem to work properly
            // // enable map rotation using right click + drag
            // map.dragRotate.enable();
            // // enable map rotation using keyboard
            // map.keyboard.enable();
            // // ensable map rotation using touch rotation gesture
            // map.touchZoomRotate.enableRotation();
        }

        // Save the layer switcher's currently visible layers
        let visible_layers = layer_switcher._visible;

        // Clear the layer switcher's visible layers and update layer visibility
        layer_switcher._visible = [];
        for(let basemap_key in layer_defs["Basemap"]){
            for(let layer of visible_layers){
                if(layer === layer_defs["Basemap"][basemap_key]["id"]){
                    layer_switcher._visible.push(layer);
                }
            }
        }
        layer_switcher._updateVisibility();

        // Edit the layers in the layer switcher's layer index to match dim_end layer prefixes
        for(let layer_key in layer_switcher._layerIndex){
            let layer_prefix = layer_switcher._layerIndex[layer_key]["prefix"];
            if(typeof layer_prefix === "string"){
                if(layer_prefix.substring(0,2) === dim_start + "D"){
                    layer_switcher._layerIndex[layer_key]["prefix"] = dim_end + "D" + layer_prefix.substring(2);
                }
            }
        }

        // Restore the layer switcher's visible layers and update layer visibility
        layer_switcher._visible = visible_layers;
        layer_switcher._updateVisibility();
    }
    
    dimension_radio_inputs[0].addEventListener("input", switch_dimensionality);
    dimension_radio_inputs[1].addEventListener("input", switch_dimensionality);
}



/**
 * 
 * @param {string} container_id HTML ID of the element to put the BalloonBaseMap into
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_switcher a maplibregl-layer-switcher object
 * @returns {object} a Maplibre GL JS map object
 */
function create_BalloonBaseMap(container_id, style, layer_switcher) {
    // Add support for additional data protocol types to the maplibregl library
    addProtocols(maplibregl);

    // Temp?
    style["sources"]["terrainSource"] = {
        type: 'raster-dem',
        url: 'https://tiles.mapterhorn.com/tilejson.json'
    };
    
    // Create the maplibre-gl map in the given container div
    const map = new maplibregl.Map({
        container: container_id,
        center: [-77.4, 39.4], // starting position [lng, lat]
        zoom: 8, // starting zoom
        minZoom: 2, // Restrict minimum zoom level
        maxZoom: 18, // Restrict maximum zoom level
        attributionControl: false, // Disable default attribution control to re-add later
        style: style,
        boxZoom: {
            boxZoomEnd: update_national_address_source_data
        }
    });

    // Add layer switcher control
    map.addControl(layer_switcher);

    // Initialize the "Map Dimensions" toggles in the layer switcher
    init_dimension_switching(map, layer_switcher);

    // Add attribution control with Maplibre and Esri attributions (https://developers.arcgis.com/documentation/esri-and-data-attribution/#esri-attribution)
    map.addControl(new maplibregl.AttributionControl({
        compact: true,
        customAttribution: '<a href="https://maplibre.org/" target="_blank">MapLibre</a> | Powered by <a href="https://esri.com" target="_blank">Esri</a>'
    }), 'bottom-right');

    // Add zoom and rotation controls
    map.addControl(new maplibregl.NavigationControl({
        visualizePitch: true,
        visualizeRoll: true,
        showZoom: true,
        showCompass: true
    }), 'bottom-right');

    // Add globe projection toggle
    // map.addControl(new maplibregl.GlobeControl(), 'bottom-right');

    // Add terrain control
    map.addControl(new maplibregl.TerrainControl({
        source: 'terrainSource',
        exaggeration: 1
    }), 'bottom-right');

    // Add inspect control
    // map.addControl(new MaplibreInspect(), 'bottom-right');

    // Add a geolocate control
    map.addControl(new maplibregl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        trackUserLocation: true
    }), 'bottom-right');

    // Add imperial and metric scales
    map.addControl(new maplibregl.ScaleControl({
        unit: 'imperial'
    }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({
        unit: 'metric'
    }), 'bottom-left');

    map.on("load", async () => {
        // The public schools GeoJSON is ~20MB and would block loading the map, so we'll load it in after the map is loaded
        // I'd rather use something that loads the points more dynamically and as needed, but this actually 
        // works unlike everything else I've tried so far, so this'll do for now
        map.getSource("public_schools").setData((new URL("assets/data/public_school_locations_reduced.geojson", import.meta.url)).href);

        map.getSource("controlled_airspace").setData((new URL("assets/data/controlled_airspace_reduced.geojson", import.meta.url)).href);
        map.getSource("uncontrolled_airspace").setData((new URL("assets/data/uncontrolled_airspace_reduced.geojson", import.meta.url)).href);
    })

    return map;
}



/**
 * 
 * @param {*} p0_lnglat LngLat representing geographical coordinates
 * @param {*} p1_lnglat LngLat representing geographical coordinates
 * @returns Promise of a GeoJSON object of address points from the National Address Database
 */
async function query_national_address_database(p0_lnglat, p1_lnglat) {
    let api_url = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query"
    
    // Encode API query parameters for the query call
    // let query_parameter_obj = {
    //     "where":        "1=1",
    //     "geometry": {
    //         "xmin":     Math.min(p0_lnglat.lng, p1_lnglat.lng),
    //         "ymin":     Math.min(p0_lnglat.lat, p1_lnglat.lat),
    //         "xmax":     Math.max(p0_lnglat.lng, p1_lnglat.lng),
    //         "ymax":     Math.max(p0_lnglat.lat, p1_lnglat.lat),
    //         "spatialreference": {
    //             "wkid": 4326
    //         }
    //     },
    //     "geometryType":         "esriGeometryEnvelope",
    //     "spatialRel":           "esriSpatialRelContains",
    //     "outFields":            "AddNo_Full,StNam_Full,Inc_Muni,Post_City,County,State,Zip_Code",
    //     "geometryPrecision":    6,
    //     "f":                    "pgeojson"
    // };
    // let query_parameters = new URLSearchParams(query_parameter_obj);

    // URLSearchParams doesn't work with nested objects, so we'll just insert the variable parameters into a pre-serialized version of the object
    let query_string = "where=1%3D1&geometry=+%7B%0D%0A++%22xmin%22%3A+" + Math.min(p0_lnglat.lng, p1_lnglat.lng).toString()
        + "%2C%0D%0A++%22ymin%22%3A+" + Math.min(p0_lnglat.lat, p1_lnglat.lat).toString()
        + "%2C%0D%0A++%22xmax%22%3A+" + Math.max(p0_lnglat.lng, p1_lnglat.lng).toString()
        + "%2C%0D%0A++%22ymax%22%3A+" + Math.max(p0_lnglat.lat, p1_lnglat.lat).toString()
        + "%2C%0D%0A++%22spatialReference%22%3A+%7B%0D%0A++++%22wkid%22%3A+4326%0D%0A++%7D%0D%0A%7D&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelContains&outFields=AddNo_Full%2CStNam_Full%2CInc_Muni%2CPost_City%2CCounty%2CState%2CZip_Code&geometryPrecision=6&f=pgeojson"
    
    // Fetch the query response from the API
    return fetch(api_url + `?${query_string}`).then((response) => {
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        return response.json();
    });
}



/**
 * 
 * @param {*} map A Maplibre GL JS map object
 * @param {*} p0 Point representing one corner of the bounding box to get addresses within
 * @param {*} p1 Point representing the opposite corner of the bounding box to get addresses within
 * @param {boolean} [points_projected=true] Boolean for whether given point coordinates are projected (pixel coords) or unprojected (LngLat coords)
 * @returns Promise of a GeoJSON object of address points from the National Address Database
 */
async function update_national_address_source_data(map, p0=null, p1=null, points_projected=true) {
    let p0_lnglat, p1_lnglat;
    if(p0 && p1){
        // If points were given,
        if(points_projected){
            // If the points are in pixel coords, unproject them into LngLat coords
            p0_lnglat = map.unproject(p0);
            p1_lnglat = map.unproject(p1);
        } else{
            // Otherwise copy the LngLat points into the appropriate variables
            p0_lnglat = p0;
            p1_lnglat = p1;
        }
    } else{
        // If points were not given, use the map's current bounds
        let map_bounds = map.getBounds();
        p0_lnglat = map_bounds.getSouthWest();
        p1_lnglat = map_bounds.getNorthEast();
    }
    
    // Query the National Address Database with the bounding box points
    return query_national_address_database(p0_lnglat,p1_lnglat).then((new_address_data) => {
        if(new_address_data["error"]){
            // If there's an error, log to the console
            console.error("BalloonBaseMap: Error querying National Address Database feature server.\nMessage: " + new_address_data["error"]["message"] + "\nDetail: " + new_address_data["error"]["details"]);
        } else{
            // Otherwise, replace the current address source data with the new response
            map.getSource("national_address_database")?.setData(new_address_data);
            // Also log if the transfer limit is exceeded (more points in database in this envelope than were returned)
            if(new_address_data["properties"] && new_address_data["properties"]["exceededTransferLimit"]){
                console.log("BalloonBaseMap: National Address Database feature server query exceeded transfer limit. Displaying first " + new_address_data["features"].length + " results");
            }
        }
        return new_address_data;
    });
}


/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_defs an object of layer group and layer definitions used to create a layer switcher
 * @param {Array<string>} layer_group_keys an array of strings corresponding to the layer groups in layer_defs
 */
function create_map_drawing_control(container_id, map) {
    // Add TerraDraw drawing controls from maplibre-gl-terradraw
    const drawControl = new MaplibreTerradrawControl({
        modes: ['render','point','angled-rectangle','select','delete-selection','delete','download'],
        open: false,
        modeOptions: {
            select: new TerraDrawSelectMode({
                flags: {
                    'angled-rectangle': {
                        feature: {
                            draggable: true,
                            coordinates: {
                                midpoints: false, // Disable adding more points to the rectangle
                                draggable: true,
                                deletable: true,
                            }
                        }
                    }
                }
            })
        }
    });
    map.addControl(drawControl, 'top-left');

    // Create element for the selected shape GeoJSON info overlay
    const overlayElement = document.createElement('div');
    overlayElement.style = "display: none";
    overlayElement.id = "maplibregl-terradraw-overlay";
    overlayElement.dataset.shapeId = null; // Add a data attribute to the HTML element for the selected shape's ID
    document.getElementById(container_id).appendChild(overlayElement);

    // Display GeoJSON info for a drawn shape when it is selected (https://terradraw.water-gis.com/examples/select-event)
    // and hide the info overlay when deselecting
    const drawInstance = drawControl.getTerraDrawInstance();
    if(drawInstance) {
        drawInstance.on('change', (id) => {
            const overlayElement = document.getElementById("maplibregl-terradraw-overlay");
            if(overlayElement.dataset.shapeId !== null) { // If a shape has been selected
                const snapshot = drawInstance.getSnapshot();
                const features = snapshot?.find((feature) => feature.id === overlayElement.dataset.shapeId);
                if(features && features["geometry"] && features["geometry"]["coordinates"]){
                    if(features["geometry"]["coordinates"][0].length == 5){ // Angled-rectangle
                        overlayElement.innerText = "Shape Coordinates:\n"
                        + "(" + features["geometry"]["coordinates"][0][0][0] + ", " + features["geometry"]["coordinates"][0][0][1] + ")\n"
                        + "(" + features["geometry"]["coordinates"][0][1][0] + ", " + features["geometry"]["coordinates"][0][1][1] + ")\n"
                        + "(" + features["geometry"]["coordinates"][0][2][0] + ", " + features["geometry"]["coordinates"][0][2][1] + ")\n"
                        + "(" + features["geometry"]["coordinates"][0][3][0] + ", " + features["geometry"]["coordinates"][0][3][1] + ")";
                    } else if(features["geometry"]["coordinates"].length == 2){ // Point
                        overlayElement.innerText = "Shape Coordinates:\n"
                        + "(" + features["geometry"]["coordinates"][0] + ", " + features["geometry"]["coordinates"][1] + ")";
                    } else{
                        const selectedFeature = JSON.stringify(features["geometry"]["coordinates"]);
                        overlayElement.innerText = "Shape Coordinates\n" + selectedFeature;
                    }
                }
            }
        });
        drawInstance.on('select', (id) => {
            const overlayElement = document.getElementById("maplibregl-terradraw-overlay");
            overlayElement.dataset.shapeId = id;

            const snapshot = drawInstance.getSnapshot();
            const features = snapshot?.find((feature) => feature.id === overlayElement.dataset.shapeId);
            if(features && features["geometry"] && features["geometry"]["coordinates"]){
                if(features["geometry"]["coordinates"][0].length == 5){ // Angled-rectangle
                    overlayElement.innerText = "Shape Coordinates:\n"
                    + "(" + features["geometry"]["coordinates"][0][0][0] + ", " + features["geometry"]["coordinates"][0][0][1] + ")\n"
                    + "(" + features["geometry"]["coordinates"][0][1][0] + ", " + features["geometry"]["coordinates"][0][1][1] + ")\n"
                    + "(" + features["geometry"]["coordinates"][0][2][0] + ", " + features["geometry"]["coordinates"][0][2][1] + ")\n"
                    + "(" + features["geometry"]["coordinates"][0][3][0] + ", " + features["geometry"]["coordinates"][0][3][1] + ")";
                } else if(features["geometry"]["coordinates"].length == 2){ // Point
                    overlayElement.innerText = "Shape Coordinates:\n"
                        + "(" + features["geometry"]["coordinates"][0] + ", " + features["geometry"]["coordinates"][1] + ")";
                } else{
                    const selectedFeature = JSON.stringify(features["geometry"]["coordinates"]);
                    overlayElement.innerText = "Shape Coordinates\n" + selectedFeature;
                }
            }

            overlayElement.style = "";
        });
        drawInstance.on('deselect', (id) => {
            const overlayElement = document.getElementById("maplibregl-terradraw-overlay");
            overlayElement.dataset.shapeId = null;

            overlayElement.style = "display: none";
        });
    }

    // Set up labels for the TerraDraw control
    let temp_el = document.createElement("span");
    temp_el.innerText = "Open/Close Drawing Tools";
    document.querySelector(".maplibregl-terradraw-render-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Draw point";
    document.querySelector(".maplibregl-terradraw-add-point-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Draw rectangle";
    document.querySelector(".maplibregl-terradraw-add-angled-rectangle-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Select drawing";
    document.querySelector(".maplibregl-terradraw-add-select-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Delete selection";
    document.querySelector(".maplibregl-terradraw-delete-selection-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Delete all drawings";
    document.querySelector(".maplibregl-terradraw-delete-button").appendChild(temp_el);
    temp_el = document.createElement("span");
    temp_el.innerText = "Download drawings";
    document.querySelector(".maplibregl-terradraw-download-button").appendChild(temp_el);


    return drawControl;
}



/**
 * 
 * @param {object} style a MapLibre GL JS-compatible style object
 * @param {object} layer_defs an object of layer group and layer definitions used to create a layer switcher
 * @param {Array<string>} layer_group_keys an array of strings corresponding to the layer groups in layer_defs
 * @param {() => void} popup_func a function to be run after a popup is created. Map source name, popup coordinates, and popup handle are passed to it after popup creation
 */
function set_show_props_on_click(map, layer_defs, layer_group_keys, popup_func = () => {return;}) {
    map.once("load", () => {
        let show_props_on_click_layers = [];
        let layer_prefixes_show_prop = [];

        for(const layer_group_key of layer_group_keys){
            for(const layer_def of layer_defs[layer_group_key]){
                layer_prefixes_show_prop.push(layer_def["prefix"]);
                if(layer_def["prefix"].substring(0,2) === "2D"){
                    layer_prefixes_show_prop.push("3D" + layer_def["prefix"].substring(2));
                }
            }
        }

        let map_layer_ids = map.getLayersOrder();
        for (const layer_id of map_layer_ids){
            for(const pref of layer_prefixes_show_prop){
                // console.log(layer_id + " " + pref);
                if(layer_id.startsWith(pref)){
                    show_props_on_click_layers.push(layer_id);
                }
            }
        }

        map.on('click', show_props_on_click_layers, (e) => {
            // Get the coordinates to display the popup from (return of polylabel if target is a polygon (multiple coordinates), geometry coordinates if not)
            // let popup_coordinates = typeof e.features[0].geometry.coordinates.slice()[0][Symbol.iterator] === 'function' ? polylabel(e.features[0].geometry.coordinates.slice(), 0.000001) : e.features[0].geometry.coordinates.slice();

            let popup_coordinates;

            // If the target is a fill/fill-extrusion, use polylabel on the shape's geometry to get the popup coordinates
            if(["fill", "fill-extrusion"].includes(e.features[0].layer.type)){
                popup_coordinates = polylabel(e.features[0].geometry.coordinates.slice(), 0.000001);
            // If the target is a line, use the clicked event coordinates to get the popup coordinates
            } else if(e.features[0].layer.type === "line"){
                // This sets the popup to where the line was clicked, which isn't necessarily on the actual line itself
                // So when zooming in the popup can appear to drift off the line as the line's thickness adjusts with the zoom level
                // Ideally, we would snap the popup coordinates to the closest coordinates on the actual line, but this works for now
                popup_coordinates = [e.lngLat.lng, e.lngLat.lat];
            // Otherwise if the first element in the target coordinates is an array, use that for the coordinates
            } else if(Array.isArray(e.features[0].geometry.coordinates[0])){
                popup_coordinates = e.features[0].geometry.coordinates[0].slice();
            // Otherwise, use the target coordinates as the coordinates
            } else{
                popup_coordinates = e.features[0].geometry.coordinates.slice();
            }

            // Ensure that if the map is zoomed out such that multiple
            // copies of the feature are visible, the popup appears
            // over the copy being pointed to. 
            // From: https://maplibre.org/maplibre-gl-js/docs/examples/display-a-popup-on-hover/
            while (Math.abs(e.lngLat.lng - popup_coordinates[0]) > 180) {
                popup_coordinates[0] += e.lngLat.lng > popup_coordinates[0] ? 360 : -360;
            }

            // Create the popup at the coordinates on the map
            let popup_handle = new maplibregl.Popup()
                .setLngLat(popup_coordinates)
                .setHTML(
                    "<pre>" + 
                        JSON.stringify(e.features[0].properties, function (key, value) {
                            // If the first character of the value is {, then value is a pre-stringified object and needs to be parsed before being stringified here
                            if(value[0] === "{"){
                                return JSON.parse(value);

                            // Don't display specified properties
                            } else if(key === "fid" || key === "timestamp_arr"){
                                return undefined;

                            } else{
                                return value;
                            }

                            // return value[0] === "{" ? JSON.parse(value) : key === "fid" ? undefined : value;
                        }, '  ')
                    + "</pre>"
                )
                .setMaxWidth("300px") // Increase max width of the popup to fit nested JSONs better
                .addTo(map);
            
            popup_func(e.features[0], popup_coordinates, popup_handle);
        });
    });
}



/**
 * 
 * @returns 
 */
async function init_base_map_layers(){
    // Create the base map style
    // return create_base_map_style(["Esri.World_Topographic_Map", "Esri.Imagery_Hybrid", "Esri.USGS_Topo"]).then(async (map_style) => {
    // return create_base_map_style(["Esri.World_Topographic_Map", "Esri.Imagery_Hybrid", "Esri.USGS_Topo", "Esri.Global_Nighttime_Lights"]).then(async (map_style) => {
    return create_base_map_style(["Esri.World_Topographic_Map", "Esri.Imagery_Hybrid", "Esri.USGS_Topo", "Esri.Enhanced_Contrast_Dark"]).then(async (map_style) => {

        // Update layer_defs with the base maps
        layer_defs["Basemap"] = [
            {
                "id": "topo",
                "name": "Esri Topography",
                "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.World_Topographic_Map"],
                "group": "basemaps",
                "visible": true
            },
            // {
            //     "id": "imagery",
            //     "name": "Esri World Imagery",
            //     "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.World_Imagery"],
            //     "group": "basemaps",
            //     "visible": false
            // },
            // {
            //     "id": "nighttime_lights",
            //     "name": "Esri.Global_Nighttime_Lights",
            //     "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.Global_Nighttime_Lights"],
            //     "group": "basemaps",
            //     "visible": false
            // },
            {
                "id": "hybrid",
                "name": "Esri World Imagery Hybrid",
                "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.Imagery_Hybrid"],
                "group": "basemaps",
                "visible": false
            },
            {
                "id": "usgs_topo",
                "name": "Esri USGS Topo",
                "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.USGS_Topo"],
                "group": "basemaps",
                "visible": false
            },
            {
                "id": "dark",
                "name": "Esri Enhanced Contrast Dark",
                "prefix": map_style["metadata"]["maplibre-gl-providers:prefixes"]["Esri.Enhanced_Contrast_Dark"],
                "group": "basemaps",
                "visible": false
            }
        ];

        // Update layer_defs with reference layer definitions
        layer_defs["Reference"] = [
            {
                "id": "ctrlair",
                "name": "Controlled Airspace",
                "prefix": "2D_airspace_controlled",
                "visible": true
            },
            {
                "id": "unctrlair",
                "name": "Uncontrolled Airspace",
                "prefix": "2D_airspace_uncontrolled",
                "visible": false
            },
            {
                "id": "tfr",
                "name": "TFR Airspace (2D)",
                "prefix": "2D_airspace_tfr",
                "visible": true
            },
            {
                "id": "national_address_database",
                "name": "National Address DB",
                "prefix": "national_address_database",
                "visible": true
            },
            {
                "id": "schools",
                "name": "Public School Locations",
                "prefix": "public_schools",
                "visible": false
            },
            {
                "id": "mcdonalds",
                "name": "McDonald's Locations",
                "prefix": "mcdonalds",
                "visible": false
            },
            {
                "id": "dunkin",
                "name": "Dunkin' Donuts Locations",
                "prefix": "dunkin",
                "visible": false
            },
            {
                "id": "launchlocs",
                "name": "Launch Locations",
                "prefix": "launch_locations",
                "visible": false
            },
            {
                "id": "poi",
                "name": "POI",
                "prefix": "POI",
                "visible": false
            }
        ];

        // Add reference layers to the map
        return append_map_reference_layers(map_style, [
            {
                "ctrlair":                      layer_defs["Reference"][0]["prefix"],
                "unctrlair":                    layer_defs["Reference"][1]["prefix"],
                "tfr":                          layer_defs["Reference"][2]["prefix"],
            },
            {
                "national_address_database":    layer_defs["Reference"][3]["prefix"]
            },
            {
                "schools":                      layer_defs["Reference"][4]["prefix"]
            },
            {
                "mcdonalds":                    layer_defs["Reference"][5]["prefix"]
            },
            {
                "dunkin":                       layer_defs["Reference"][6]["prefix"]
            },
            {
                "launchlocs":                   layer_defs["Reference"][7]["prefix"]
            },
            {
                "poi":                      layer_defs["Reference"][8]["prefix"]
            }
        ]);
    });
}



/**
 * 
 * @param {string} container_id HTML ID of the element to put the BalloonBaseMap into
 * @returns the MapLibre GL JS map object
 */
async function init_BalloonBaseMap(container_id) {
    // Initialize the base map style and layers
    return init_base_map_layers().then(async (map_style) => {

        // Create a layer switcher and initialize layer visibility
        const layer_switcher = create_layer_switcher(map_style, layer_defs, ["Basemap", "Reference"])["layer_switcher"];
        
        // Create the maplibre-gl map in the given container div
        const map = create_BalloonBaseMap(container_id, map_style, layer_switcher);
        
        // Create a TerraDraw drawing control
        create_map_drawing_control(container_id, map);
        
        // Set layers in the "Reference" group to show their properties when clicked
        set_show_props_on_click(map, layer_defs, ["Reference"]);
        
        return {
            "map": map,
            "map_style": map_style,
            "layer_switcher": layer_switcher
        };
    });
}



/**
 * fragment_geojson_linestrings takes a features array from a GeoJSON FeatureCollection and "explodes" each coordinate of each LineString into 
 * its own LineString, from the midpoint from the previous coordinate to the midpoint to the next coordinate and adds an altitude property to 
 * the new LineStrings based on the third coordinate of the original LineString coordinate arrays. Since the map doesn't support extruding a 
 * line (or any feature) to a variety of heights, we can split it like this and extrude each feature based on its new altitude property to 
 * achieve a similar-enough effect. This code does **NOT** check whether the GeoJSON features have already been fragmented and will fragment 
 * them again if run again on the same lines
 * 
 * The code in this function is adapted from the answer by ThomasG77 at https://gis.stackexchange.com/a/403123
 * 
 * @param {object} geojson_features GeoJSON object's features array with linestring features that use a third coordinate for altitude
 * @param {{}} [custom_properties={}] Object of custom properties to add to each fragmented linestring
 * @returns A features array of **only the fragmented linestrings**, where each linestring from the original object is split into separate 
 * linestrings for each coordinate and the altitude coordinate copied into a property on the separate linestrings
 */
function fragment_geojson_linestrings(geojson_features, custom_properties={}){
    let fragmented_geojson_linestrings = [];

    // Loop through each provided feature
    geojson_features.forEach((feature, index) => {
        // Only get the linestrings
        if(feature["geometry"]["type"] === "LineString"){
            // Loop through each linestring coordinate
            let coords = feature["geometry"]["coordinates"];
            let num_coords = coords.length;

            // Skip fragmenting features with too many coordinates
            if(num_coords > 2500){
                console.warn(
                    "fragment_geojson_linestrings: LineString " 
                    + (feature["properties"]["name"] ? `"` + feature["properties"]["name"] + `" ` : "") 
                    + "has too many coordinates (" + num_coords + " > 2500). Skipping fragmenting it"
                );
                return;
            }

            for(let idx = 0; idx < num_coords; idx++){
                // Split the coordinates into their own linestrings at the midpoint between coordinates
                let line;
                if(idx == 0){
                    line = turf.lineString([
                        coords[idx].slice(0,2),
                        turf.midpoint(turf.point(coords[idx].slice(0, 2)), turf.point(coords[idx + 1].slice(0, 2))).geometry.coordinates
                    ]);
                } else if(idx == num_coords - 1){
                    line = turf.lineString([
                        turf.midpoint(turf.point(coords[idx - 1].slice(0, 2)), turf.point(coords[idx].slice(0, 2))).geometry.coordinates,
                        coords[idx].slice(0, 2)
                    ]);
                } else{
                    line = turf.lineString([
                        turf.midpoint(turf.point(coords[idx - 1].slice(0, 2)), turf.point(coords[idx].slice(0, 2))).geometry.coordinates,
                        coords[idx].slice(0, 2),
                        turf.midpoint(turf.point(coords[idx].slice(0, 2)), turf.point(coords[idx + 1].slice(0, 2))).geometry.coordinates
                    ]);
                }
                // Copy the original linestring's properties and the provided custom properties to the new ones and add properties for the altitude and center coordinates
                line["properties"] = Object.assign({}, feature["properties"], custom_properties);
                line["properties"]["coords_index"] = idx;
                line["properties"]["coords_total"] = num_coords;
                line["properties"]["longitude"] = Math.round(coords[idx][0]*1e6) / 1e6;
                line["properties"]["latitude"] = Math.round(coords[idx][1]*1e6) / 1e6;
                line["properties"]["altitude_m"] = Math.round(coords[idx][2]*1e3) / 1e3;
                fragmented_geojson_linestrings.push(line);
            }
        }
    });

    // Create a buffer around the linestrings, so they render better on the map, and
    // simplify the buffered linestring polygons and
    // truncate the final GeoJSON's coordinates to a precision of 6, for better performance
    // https://docs.mapbox.com/help/dive-deeper/geojson-coordinate-precision/
    fragmented_geojson_linestrings = turf.truncate(
        turf.simplify(
            turf.buffer({
                    "type": "FeatureCollection",
                    "name": "temp_geojson",
                    "features": fragmented_geojson_linestrings
                },
                100, {"units": "meters"}
            ),
            {"tolerance": 0.00025, "mutate": true}
        ),
        {"precision": 6, "coordinates": 2, "mutate": true}
    )["features"];

    return fragmented_geojson_linestrings;
}



/**
 * 
 */
function get_active_layer_geojsons(){

}



export default init_BalloonBaseMap
export {
    init_BalloonBaseMap,
    init_base_map_layers,
    create_base_map_style,
    append_map_reference_layers,
    create_layer_switcher,
    create_BalloonBaseMap,
    create_map_drawing_control,
    set_show_props_on_click,
    layer_defs,
    fragment_geojson_linestrings,
    update_national_address_source_data
};