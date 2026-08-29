/**
 * maplibre-gl-providers - A helper library to streamline adding remotely-provided layers to a MapLibre GL JS map
 * This will provide a simple interface for adding remotely-provided sources/layers to MapLibre, similar to leaflet-provders[https://github.com/leaflet-extras/leaflet-providers]
 * Currently only planning to support a handful of the free Esri layers provided by ArcGIS, but may add more and from different sources in the future
 * Supported layers are:
 *  - Esri: World Topographic Map (with Contours and Hillshade), https://www.arcgis.com/home/item.html?id=18d32a699af64bfba4e78eba5a4dd705
 *  - Esri: World Imagery, https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9
 *  - Esri: Imagery Hybrid, https://www.arcgis.com/home/item.html?id=86265e5a4bbb4187a59719cf134e0018
 *  - Esri: Terrain 3D, https://www.arcgis.com/home/item.html?id=7029fb60158543ad845c7e1527af11e4
 *  - Esri: Enhanced Contrast Dark Map, https://www.arcgis.com/home/item.html?id=3e23478909194c54992eaaee78b5f754 <-- this one isn't working so well
 *  - Esri: USGS Topo base map (aka USGS National Map), https://esri.maps.arcgis.com/home/item.html?id=6d9fa6d159ae4a1f80b9e296ed300767
 * 
 * Not implemented yet:
 *  - Esri: National Hydrography Dataset Plus Version 2.1, https://www.arcgis.com/home/item.html?id=4bd9b6892530404abfe13645fcb5099a
 * 
 *  - Esri Federal Data: Transportation, https://www.arcgis.com/home/item.html?id=f42ecc08a3634182b8678514af35fac3
 *  - Esri Federal Data: National Address Database, https://www.arcgis.com/home/item.html?id=ddcaa5e1a9e24c27bff3c3ce16ea2944
 * 
 * https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#getbounds
 * https://developers.arcgis.com/maplibre-gl-js/query-and-edit/query-a-feature-layer-spatial/
 * https://developers.arcgis.com/maplibre-gl-js/layers/add-a-feature-layer-as-geojson/
 * https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service/#request-parameters
 * 
 * 
 * @param {object} map a MapLibre GL JS Map object
 * @param {string} provider_id a string with two parts separated by a '.' indicating which provider (source/layers combination) to use, 
 *                             such as "Esri.World_Topographic_Map" to use Esri's World Topographic Map (with Contours and Hillshade)
 * @param {object} initial_style an optional initial style object to combine the retrieved style into
 * 
 * @returns {Promise<object>} an object containing a "success" boolean field indicating whether the operation was successful.
 * If success is true, the object also contains a "style" field with the final MapLibre GL JS-compatible style object.
 * If success is false, the object also contains an "error" field with an error message string.
 */
async function maplibre_gl_provider(provider_id="Esri.World_Topographic_Map", initial_style={}){
    const providers = {
        "Esri": {
            "World_Topographic_Map": {
                "prefix":       "esri_world_topo",
                "type":         "vector",
                "url":          "https://www.arcgis.com/sharing/rest/content/items/18d32a699af64bfba4e78eba5a4dd705/resources/styles/root.json"
            },
            "World_Imagery": {
                "prefix":       "esri_world_imagery",
                "type":         "raster",
                "url":          "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
            },
            "Imagery_Hybrid": {
                "prefix":       "esri_imagery_hybrid",
                "type":         "hybrid",
                "keys":         ["World_Imagery", "Hybrid_Reference_Layer"],
                "subproviders": {
                    "World_Imagery": {
                        "prefix":       "esri_imagery_hybrid_world_imagery",
                        "type":         "raster",
                        "url":          "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer"
                    },
                    "Hybrid_Reference_Layer": {
                        "prefix":       "esri_imagery_hybrid_reference",
                        "type":         "vector",
                        "url":          "https://www.arcgis.com/sharing/rest/content/items/30d6b8271e1849cd9c3042060001f425/resources/styles/root.json"
                    }
                }
            },
            "Enhanced_Contrast_Dark": {
                "prefix":       "esri_enhanced_contrast_dark",
                "type":         "hybrid",
                "keys":         ["Enhanced_Contrast_Dark_Base", "Enhanced_Contrast_Dark_Reference"],
                "subproviders": {
                    "Enhanced_Contrast_Dark_Base": {
                        "prefix":       "esri_enhanced_contrast_dark_base",
                        "type":         "vector",
                        "url":          "https://www.arcgis.com/sharing/rest/content/items/4dd826e83b044acfb519a26fc9b20f80/resources/styles/root.json"
                    },
                    "Enhanced_Contrast_Dark_Reference": {
                        "prefix":       "esri_enhanced_contrast_dark_reference",
                        "type":         "vector",
                        "url":          "https://www.arcgis.com/sharing/rest/content/items/946b41c44c9549758b89f50ce9d8872d/resources/styles/root.json"
                    }
                }
            },
            "USGS_Topo": {
                "prefix":       "esri_usgs_topo",
                "type":         "raster",
                "url":          "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer",
                "tile_path":    "/tile/{z}/{y}/{x}",
                "source_options": {
                    "maxzoom":      16
                }
            },
            // "Global_Nighttime_Lights": {
            //     "prefix":       "esri_global_nighttime_lights",
            //     "type":         "raster",
            //     "url":          "https://tiledimageservices.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/global_nighttime_lights/ImageServer"
            // },
            "Terrain_3D": {
                "prefix":       "esri_terrain_3d",
                "type":         "raster-dem",
                "url":          "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
            }
        },
        // "FAA": {
        //     "V_TFR_LOC": {
        //         "prefix":       "faa_v_tfr_loc",
        //         "type":         "geojson",
        //         "url":          "https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=TFR:V_TFR_LOC&outputFormat=application/json",
        //         "attribution":  "FAA"
        //     }
        //     // "VFR_Sectional": {
        //     //     "prefix":       "faa_vfr_sectional",
        //     //     "type":         "raster-wmts",
        //     //     "url":          "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer",
        //     //     "tile_path":    "/WMTS/tile/1.0.0/VFR_Sectional/default/default028mm/{z}/{x}/{y}.png"
        //     // }
        // }
    }

    // Split provider_id into name and variant (first and second keys for providers object)
    let provider_name, provider_variant;
    [provider_name, provider_variant] = provider_id.split(".", 2);
    // If the provider name is valid,
    if(providers[provider_name]){
        // If the provider variant is valid,
        if(providers[provider_name][provider_variant]){
            // Check if this provider name/variant combination has already been used in the map's style to combine with
            if(initial_style["metadata"] && initial_style["metadata"]["maplibre-gl-providers:providers"] ? initial_style["metadata"]["maplibre-gl-providers:providers"].includes(provider_id) : false){
                return {
                    success: false,
                    error: "Selected provider already exists in the given map's style"
                };
            }

            // Handle the type of source and combining with the map's style, if requested
            let provided_style = await handle_source_type(provider_id, providers[provider_name][provider_variant], initial_style);

            return {
                success: true,
                style: provided_style
            };
        } else{
            // Invalid provider variant
            return {
                success: false,
                error: "Invalid provider variant"
            };
        }
    } else{
        // Invalid provider name
        return {
            success: false,
            error: "Invalid provider name"
        };
    }
}



/**
 * 
 * @param {string} provider_id - the internal ID of the specific provider
 * @param {object} provider_obj - the object for a specific provider, either from providers[provider_name][provider_variant] or a subprovider of a hybrid provider
 * @param {object} initial_style - an initial style object to combine the retrieved style into
 * @returns {object} a MapLibre GL JS-compatible style object
 */
async function handle_source_type(provider_id, provider_obj, initial_style={}){
    let provided_style = {};
    switch(provider_obj["type"]){
        case "vector": {
            provided_style = await get_arcgis_vtl_style(provider_obj["prefix"], provider_obj["url"]);
            break;
        }
        case "raster": {
            provided_style = await create_arcgis_raster_style(provider_obj["prefix"], provider_obj["url"],
                provider_obj["metadata_path"] ? provider_obj["metadata_path"] : undefined,
                provider_obj["tile_path"] ? provider_obj["tile_path"] : undefined
            );
            break;
        }
        case "raster-dem": {
            provided_style = await create_arcgis_raster_dem_style(provider_obj["prefix"], provider_obj["url"]);
            break;
        }
        case "hybrid": {
            // Loop through and handle the subproviders
            for(let idx = 0; idx < provider_obj.keys.length; idx++){
                provided_style = await handle_source_type(provider_id + "_" + provider_obj["keys"][idx], provider_obj["subproviders"][provider_obj["keys"][idx]], provided_style);
            }

            // Loop through each source and prepend this providers prefix on top of the subprovider's
            // Object.keys(provided_style["sources"]).forEach((source_key, index) => {
            //     // Prefix source key with provider prefix (https://stackoverflow.com/a/14592469)
            //     if (source_key !== provider_obj["prefix"] + source_key) {
            //         Object.defineProperty(provided_style["sources"], provider_obj["prefix"] + source_key,
            //             Object.getOwnPropertyDescriptor(provided_style["sources"], source_key));
            //         delete provided_style["sources"][source_key];
            //     }
            // });

            // // Loop through each layer and prepend this providers prefix on top of the subprovider's
            // provided_style["layers"].forEach((layer, index) => {
            //     provided_style["layers"][index]["id"] = provider_obj["prefix"] + layer["id"];
            //     provided_style["layers"][index]["source-layer"] = provider_obj["prefix"] + layer["source-layer"];
            // });

            break;
        }
        case "geojson": {
            provided_style = await create_geojson_source(provider_obj["prefix"], provider_obj["url"], provider_obj["attribution"])
            break;
        }
        default: {
            
            break;
        }
    }
    // Set the provider id in the new style metadata
    if(!provided_style["metadata"]){
        provided_style["metadata"] = {};
    }
    provided_style["metadata"]["maplibre-gl-providers:providers"] = provided_style["metadata"]["maplibre-gl-providers:providers"] ? provided_style["metadata"]["maplibre-gl-providers:providers"].concat([provider_id]) : [provider_id];
    provided_style["metadata"]["maplibre-gl-providers:prefixes"] = Object.assign({}, provided_style["metadata"]["maplibre-gl-providers:prefixes"], {[provider_id]: provider_obj["prefix"]});

    // Apply any source options set for this provider
    if(provider_obj["source_options"] && provided_style["sources"]){
        Object.keys(provided_style["sources"]).forEach((key) => {
            provided_style["sources"][key] = {
                ...provided_style["sources"][key],
                ...provider_obj["source_options"]
            };
        });
    }

    // If there is an initial style to combine into, combine the retrieved style into it
    // if(Object.keys(initial_style).length > 0){
        // debugger;
        provided_style = combine_styles(initial_style, provided_style, provider_obj["prefix"]);
    // }

    return provided_style;
}



/**
 * A helper function to combine two MapLibre GL JS styles
 * @param {object} previous_style the initial MapLibre GL JS style
 * @param {object} next_style a MapLibre GL JS style to combine into the initial one
 * @param {string} next_style_prefix a prefix string to identify some properties from next_style
 * @returns {object} the final combined style object
 */
function combine_styles(previous_style={}, next_style, next_style_prefix=""){
    let combined_style = {
        ...previous_style, // Get everything from the previous map style
        metadata: { // Set the metadata to be the metadata from the previous style, the metadata from the new style, and our providers array metadata to a concat of the previous and new providers arrays
            ...previous_style["metadata"],
            ...next_style["metadata"],
            // If the previous style has a metadata providers array, concat the new one to it. Otherwise, set it to the new one
            "maplibre-gl-providers:providers": previous_style["metadata"] ? (previous_style["metadata"]["maplibre-gl-providers:providers"] ? previous_style["metadata"]["maplibre-gl-providers:providers"].concat(next_style["metadata"]["maplibre-gl-providers:providers"]) : next_style["metadata"]["maplibre-gl-providers:providers"]) : next_style["metadata"]["maplibre-gl-providers:providers"],
            "maplibre-gl-providers:prefixes": {
                ...(previous_style["metadata"] ? Object.assign({}, previous_style["metadata"]["maplibre-gl-providers:prefixes"], next_style["metadata"]["maplibre-gl-providers:prefixes"]) : next_style["metadata"]["maplibre-gl-providers:prefixes"])
            }
        },
        sources: { // Set the sources to be every source from the previous style and every source from the new style. Should probably check for conflicts
            ...previous_style.sources,
            ...next_style.sources
        },
        "version": 8
    };

    // If there is a terrain field in the next style,
    if(next_style["terrain"]){
        // Write it to the combined style (over any that might already be there)
        combined_style["terrain"] = next_style["terrain"];
    }

    // If there is a glyphs field in the next style,
    if(next_style["glyphs"]){
        // Write it to the combined style (over any that might already be there)
        combined_style["glyphs"] = next_style["glyphs"];
    }

    let next_style_layers = [...next_style.layers];

    if(next_style_prefix !== "" && (previous_style["sprite"] || next_style["sprite"])){
        // Loop through each layer and prepend sprite references with the next_style_prefix
        next_style_layers.forEach((layer, index) => {
            // If the sprite referencing field exists and isn't already set up for multiple sources
            if(layer["paint"] && layer["paint"]["background-pattern"]){
                if(typeof layer["paint"]["background-pattern"] === typeof "" && layer["paint"]["background-pattern"].indexOf(":") !== -1){
                    // Already a sprite id prefixed, skip prefixing a new one
                } else{
                    next_style_layers[index]["paint"]["background-pattern"] = handle_prepending(next_style_layers[index]["paint"]["background-pattern"], next_style_prefix + ":");
                }
            }
            if(layer["paint"] && layer["paint"]["fill-pattern"]){
                if(typeof layer["paint"]["fill-pattern"] === typeof "" && layer["paint"]["fill-pattern"].indexOf(":") !== -1){
                    // Already a sprite id prefixed, skip prefixing a new one
                } else{
                    next_style_layers[index]["paint"]["fill-pattern"] = handle_prepending(next_style_layers[index]["paint"]["fill-pattern"], next_style_prefix + ":");
                }
            }
            if(layer["paint"] && layer["paint"]["line-pattern"]){
                if(typeof layer["paint"]["line-pattern"] === typeof "" && layer["paint"]["line-pattern"].indexOf(":") !== -1){
                    // Already a sprite id prefixed, skip prefixing a new one
                } else{
                    next_style_layers[index]["paint"]["line-pattern"] = handle_prepending(next_style_layers[index]["paint"]["line-pattern"], next_style_prefix + ":");
                }
            }
            if(layer["paint"] && layer["paint"]["fill-extrusion-pattern"]){
                if(typeof layer["paint"]["fill-extrusion-pattern"] === typeof "" && layer["paint"]["fill-extrusion-pattern"].indexOf(":") !== -1){
                    // Already a sprite id prefixed, skip prefixing a new one
                } else{
                    next_style_layers[index]["paint"]["fill-extrusion-pattern"] = handle_prepending(next_style_layers[index]["paint"]["fill-extrusion-pattern"], next_style_prefix + ":");
                }
            }
            try{
                if(layer["layout"] && layer["layout"]["icon-image"]){
                    if(typeof layer["layout"]["icon-image"] === typeof "" && layer["layout"]["icon-image"].indexOf(":") !== -1){
                        // Already a sprite id prefixed, skip prefixing a new one
                    } else{
                        next_style_layers[index]["layout"]["icon-image"] = handle_prepending(next_style_layers[index]["layout"]["icon-image"], next_style_prefix + ":");
                    }
                }
            } catch{
                layer;
                debugger;
            }
        });

        // If there is a sprite field in the new style
        if(next_style["sprite"]){
            // If there was a sprite field in the previous style
            if(combined_style["sprite"]){
                // If the previous style's sprite field was an array
                if(Array.isArray(combined_style["sprite"])){
                    // and the next style's sprite field is also an array
                    if(Array.isArray(next_style["sprite"])){
                        // then concat the arrays (which should be fine assuming there aren't any conflicts)
                        combined_style["sprite"] = combined_style["sprite"].concat(next_style["sprite"]);
                    // If the next style's sprite field isn't an array, push an element to the previous style's sprite array
                    } else{
                        combined_style["sprite"].push({
                            "id": next_style_prefix,
                            "url": next_style["sprite"]
                        });
                    }
                // If the previous style's sprite field was not an array,
                } else{
                    console.warn("maplibre-gl-provider: Previous style with non-array sprite field found. This should not happen and can cause problems. Creating style sprite array entry with default ID.");
                    // and the next style's sprite field is an array
                    if(Array.isArray(next_style["sprite"])){
                        // then get the next style's sprite array and push an element for the previous style's sprite set as the default sprite
                        let temp = next_style["sprite"];
                        temp.push({
                            "id": "default",
                            "url": previous_style["sprite"]
                        });
                        combined_style["sprite"] = temp;
                    // If the next style's sprite field also isn't an array, create an array out of the two sprite fields with the previous one as the default
                    } else{
                        combined_style["sprite"] = [{
                            "id": next_style_prefix,
                            "url": next_style["sprite"]
                        },
                        {
                            "id": "default",
                            "url": previous_style["sprite"]
                        }];
                    }
                }
            // If there was not a sprite field in the previous style,
            } else{
                // If the next style's sprite field is an array,
                if(Array.isArray(next_style["sprite"])){
                    // set the combined style's sprite to the new style's sprite array
                    combined_style["sprite"] = next_style["sprite"];
                // If the next style's sprite field isn't an array, create an array out of the new style's sprite field
                } else{
                    combined_style["sprite"] = [{
                        "id": next_style_prefix,
                        "url": next_style["sprite"]
                    }];
                }
            }
        }
    }
    
    // Set the layers field in the combined style be all of the layers from the previous and next styles
    if(previous_style["layers"]){
        combined_style["layers"] = [
            ...previous_style.layers,
            ...next_style_layers
        ];
    } else{
        combined_style["layers"] = next_style_layers;
    }

    return combined_style;
}



/**
 * A helper function to handle prepending to fields that use expressions
 * @param {string|object} field : the field to prepend to
 * @param {string} prefix : the prefix to prepend to the field
 * @returns {string|object} : The field contents with the prefix prepended
 */
function handle_prepending(field, prefix){
    // If the field is just a string
    if(typeof field === typeof ""){
        // Check if there is already a prefix prepended
        if(field.indexOf(":") !== -1){
            return field;
        } else{
            // Return the field with prefix prepended
            return prefix + field;
        }

    // If the field is an array
    } else if(Array.isArray(field)){
        field.forEach((field_item, index) => {
            // and handle prepending to each one
            field[index] = handle_prepending(field[index], prefix);
        });

        // // Check the first two elements to see if field is an array of arrays
        // if(Array.isArray(field[0] || field[1])){
        //     // Loop through each field item
        //     field.forEach((field_item, index) => {
        //         // and handle prepending to each one
        //         field[index] = handle_prepending(field[index], prefix);
        //     });
        // // If the first two elements aren't arrays, then the item we want to prepend to is probably the second one
        // } else{
        //     // Check if there is already a prefix prepended
        //     if(field.indexOf(":") !== -1){
        //         return field;
        //     } else{
        //         field[1] = prefix + field[1];
        //         return field;
        //     }
        // }

    // If the field is an object
    } else if(typeof field === typeof({})){
        // Loop through each key
        Object.keys(field).forEach((key, index) => {
            // and handle prepending to each one
            field[key] = handle_prepending(field[key], prefix);
        });
    }

    return field;
}



/**
 * A helper function to retrieve the copyrightText field of an ArcGIS Map/VectorTile/etc. Server
 * @param {string} source_url : the URL to get the metadata JSON from
 * @returns {string|null} : The string contents of the copyrightText field or null on error
 */
async function get_copyrightText(source_url){
    try {
        let response = await fetch(source_url);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let source_json = await response.json();

        if (typeof source_json["copyrightText"] === 'string') {
            return source_json["copyrightText"];
        } else {
            return '';
        }

    } catch(error) {
        console.error(error.message);
        return null;
    }
}



/**
 * A helper function to get a Vector Tile Layer style provided from an ArcGIS URL. The provided style is modified to replace its source URLs with direct links to the tiles and the attribution from source's URL.
 * It then loops through the provided style's layers to prepend each ID with provider_prefix and remove all but the first font used by "text-font" (to fix "Unimplemented type 3" errors from fonts not being found)
 * @param {string} provider_prefix : the identifying prefix string to prepend to each source and layer ID
 * @param {string} style_url : the URL to get the ArcGIS Vector Tile Layer style from
 * @returns {object|null} : A style object that should be compatible with MapLibre GL JS or null on error
 */
async function get_arcgis_vtl_style(provider_prefix="esri_topo", style_url="https://www.arcgis.com/sharing/rest/content/items/18d32a699af64bfba4e78eba5a4dd705/resources/styles/root.json"){
    try {
        // Get the style JSON
        let response = await fetch(style_url);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let vtl_style = await response.json();

        // Go through the returned style JSON object's sources and replace tile paths with actual URLs, add attributions, and prepend the provider prefix to the source keys
        await Promise.all(Object.keys(vtl_style["sources"]).map(async (source_key) => {
            if(vtl_style["sources"][source_key]["url"]){
                vtl_style["sources"][source_key]["tiles"] = [
                    (vtl_style["sources"][source_key]["url"] + "/tile/{z}/{y}/{x}.pbf")
                ];
                vtl_style["sources"][source_key]["attribution"] = await get_copyrightText(vtl_style["sources"][source_key]["url"]);
                delete vtl_style["sources"][source_key]["url"];
            }
            // Prefix source key with provider prefix (https://stackoverflow.com/a/14592469)
            if (source_key !== provider_prefix + "_" + source_key) {
                Object.defineProperty(vtl_style["sources"], provider_prefix + "_" + source_key,
                    Object.getOwnPropertyDescriptor(vtl_style["sources"], source_key));
                delete vtl_style["sources"][source_key];
            }
        }));

        // Loop through the style layers, prepend provider_prefix to the layer ids and source-layers, and remove all but the first font (to fix "Unimplemented type 3" from fonts not being found)
        vtl_style["layers"].forEach((layer, index) => {
            vtl_style["layers"][index]["id"] = provider_prefix + "_" + layer["id"];
            if(vtl_style["layers"][index]["source"]){
                vtl_style["layers"][index]["source"] = provider_prefix + "_" + layer["source"];
            }
            if(layer.layout){
                if(layer["layout"]["text-font"]){
                    vtl_style["layers"][index]["layout"]["text-font"] = [layer["layout"]["text-font"][0]];
                }
            }
        });

        return vtl_style;

    } catch(error) {
        console.error(error.message);
        return null;
    }
}



/**
 * A helper function to create a style for a raster tile layer from an ArcGID URL.
 * @param {string} provider_prefix : the identifying prefix string to prepend to each source and layer ID
 * @param {string} mapserver_url : the URL to the ArcGIS MapServer for the layer
 * @param {string} metadata_path : the path on the MapServer to the metadata json, defaults to "?f=json"
 * @param {string} tile_path : the path on the MapServer to the tiles, defaults to "/tile/{z}/{y}/{x}.pbf"
 * 
 * @returns {object|null} : A style object that should be compatible with MapLibre GL JS or null on error
 */
async function create_arcgis_raster_style(provider_prefix, mapserver_url, metadata_path="?f=json", tile_path="/tile/{z}/{y}/{x}.pbf"){
    // Create the style object
    let raster_style = {
        "version": 8,
        "sources": {},
        "layers": []
    }
    // Create the source with the mapserver URL, tile path, and attribution from the metadata path
    raster_style["sources"][provider_prefix + "_source"] = {
        "type": "raster",
        "tiles": [
            (mapserver_url + tile_path)
        ],
        "attribution": (await get_copyrightText(mapserver_url + metadata_path))
    };
    // Create a layer for the raster source
    raster_style["layers"].push({
        "id": (provider_prefix + "_layer"),
        "type": "raster",
        "source": (provider_prefix + "_source")
    });

    return raster_style;
}



/**
 * A helper function to create a style for a raster Digital Elevation Map tile layer from an ArcGID URL.
 * @param {string} provider_prefix : the identifying prefix string to prepend to each source and terrain ID
 * @param {string} imageserver_url : the URL to the ArcGIS ImageServer for the DEM
 * @param {string} metadata_path : the path on the MapServer to the metadata json, defaults to "?f=json"
 * @param {string} tile_path : the path on the ImageServer to the tiles, defaults to "/tile/{z}/{y}/{x}.pbf"
 * 
 * @returns {object|null} : A style object that should be compatible with MapLibre GL JS or null on error
 */
async function create_arcgis_raster_dem_style(provider_prefix, imageserver_url, metadata_path="?f=json", tile_path="/tile/{z}/{y}/{x}.pbf"){
    // Create the style object
    let dem_style = {
        "version": 8,
        "sources": {},
        "layers": []
    }
    // Create the source with the URL, tile path, and attribution from the metadata path
    dem_style["sources"][provider_prefix + "_terrain_source"] = {
        "type": "raster-dem",
        "tiles": [
            (imageserver_url + tile_path)
        ],
        "attribution": (await get_copyrightText(imageserver_url + metadata_path))
    };
    // Create a terrain for the DEM source
    dem_style["terrain"] = {
        "source": (provider_prefix + "_terrain_source"),
        "exaggeration": 1
    };

    return dem_style;
}



/**
 * A helper function to create a style for a GeoJSON source.
 * @param {string} provider_prefix : the identifying prefix string to prepend to each source
 * @param {string} geojson_url : the URL to the GeoJSON source
 * @param {string} attribution : a string for the attribution for the GeoJSON source
 * 
 * @returns {object|null} : A style object that should be compatible with MapLibre GL JS or null on error
 */
async function create_geojson_source(provider_prefix, geojson_url, attribution=""){
    // Fetch the GeoJSON object from the provider URL
    try {
        let response = await fetch(geojson_url);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let source_json = await response.json();

        // Create the style object
        let style = {
            "version": 8,
            "sources": {},
            "layers": []
        }
        // Create the source with the GeoJSON URL and the attribution string
        style["sources"][provider_prefix + "_source"] = {
            "type": "geojson",
            "data": source_json,
            "attribution": attribution
        };

        return style;
        

    } catch(error) {
        console.error(error.message);
        return null;
    }
}



export default maplibre_gl_provider;
export { maplibre_gl_provider };