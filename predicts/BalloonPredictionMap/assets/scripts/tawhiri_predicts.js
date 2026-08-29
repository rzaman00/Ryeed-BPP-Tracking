const API_URL = "https://api.v2.sondehub.org/tawhiri";



/**
 * 
 * @param {string} name Name of the launch location
 * @param {string} switcher_id ID of the launch location to use for the layer switcher
 * @param {number} launch_longitude Longitude of the launch location
 * @param {number} launch_latitude Latitude of the launch location
 * @param {Date} launch_datetime Datetime of the launch
 * @param {number} ascent_rate Balloon ascent rate in meters per second
 * @param {number} burst_altitude Intended balloon burst altitude
 * @param {number} sea_level_descent_rate Balloon descent rate at sea level in meters per second
 * @returns An array of GeoJSON features containing the predicted trajectory of the balloon for a standard burst flight profile
 */
async function get_burst_linestring(name, switcher_id, launch_longitude, launch_latitude, launch_datetime, ascent_rate, burst_altitude, sea_level_descent_rate){
    let output_features = [];
    
    // Encode API query parameters
    let query_parameter_obj = {
        "launch_longitude": launch_longitude,
        "launch_latitude":  launch_latitude,
        "launch_datetime":  launch_datetime.toISOString(),
        "ascent_rate":      ascent_rate,
        "burst_altitude":   burst_altitude,
        "descent_rate":     sea_level_descent_rate
    };
    let query_parameters = new URLSearchParams(query_parameter_obj);

    try {
        // Fetch the query response from the API
        let response = await fetch(API_URL + `?${query_parameters}`);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let response_json = await response.json();

        // Create GeoJSON features for the ascent and descent stages of the burst prediction
        output_features[0] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_ascent",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response_json["request"]["dataset"] + " UTC",
                "stage": "ascent",
                "type": "burst",
                "launch_longitude": Math.round((launch_longitude - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(launch_latitude*1e6) / 1e6,
                "launch_datetime": launch_datetime.toISOString(),
                "ascent_rate": ascent_rate,
                "burst_altitude": burst_altitude,
                "sea_level_descent_rate": sea_level_descent_rate,
                "query": {
                    ...query_parameter_obj
                },
                "timestamp_arr": []
            }
        };
        output_features[1] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_descent",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response_json["request"]["dataset"] + " UTC",
                "stage": "descent",
                "type": "burst",
                "launch_longitude": Math.round((launch_longitude - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(launch_latitude*1e6) / 1e6,
                "launch_datetime": launch_datetime.toISOString(),
                "ascent_rate": ascent_rate,
                "burst_altitude": burst_altitude,
                "sea_level_descent_rate": sea_level_descent_rate,
                "query": {
                    ...query_parameter_obj
                },
                "timestamp_arr": []
            }
        };

        // Get the ascent and descent trajectories from the prediction API response
        let ascent_trajectory = response_json['prediction'][0]['trajectory'];
        let descent_trajectory = response_json['prediction'][1]['trajectory'];

        // Loop through the ascent and descent trajectories, shift the longitudes, and push coordinates to the corresponding output feature
        for(let entry of ascent_trajectory){
            output_features[0]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[0]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }
        for(let entry of descent_trajectory){
            output_features[1]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[1]["properties"]["timestamp_arr"].push(entry["datetime"]);
            
        }

        // Record the first and last timestamps of each stage
        output_features[0]["properties"]["timestamp_ascent_first"] = ascent_trajectory[0]["datetime"];
        output_features[0]["properties"]["timestamp_ascent_last"] = ascent_trajectory.at(-1)["datetime"];
        output_features[1]["properties"]["timestamp_descent_first"] = descent_trajectory[0]["datetime"];
        output_features[1]["properties"]["timestamp_descent_last"] = descent_trajectory.at(-1)["datetime"];
        
        // Return the output features array
        return output_features;

    } catch(error) {
        console.error(error.message);
        return null;
    }
}



/**
 * 
 * @param {string} name Name of the launch location
 * @param {string} switcher_id ID of the launch location to use for the layer switcher
 * @param {number} launch_longitude Longitude of the launch location
 * @param {number} launch_latitude Latitude of the launch location
 * @param {Date} launch_datetime Datetime of the launch
 * @param {number} ascent_rate Balloon ascent rate in meters per second
 * @param {number} float_altitude Intended balloon float altitude
 * @param {Date} float_end_datetime Balloon float prediction cutoff time
 * @returns An array of GeoJSON features containing the predicted trajectory of the balloon for a Tawhiri float flight profile (ascent and 0-m/s float, no descent)
 */
async function get_tawhiri_float_linestring(name, switcher_id, launch_longitude, launch_latitude, launch_datetime, ascent_rate, float_altitude, float_end_datetime){
    let output_features = [];
    
    // Encode API query parameters
    let query_parameter_obj = {
        "profile":          "float_profile",
        "launch_longitude": launch_longitude,
        "launch_latitude":  launch_latitude,
        "launch_datetime":  launch_datetime.toISOString(),
        "ascent_rate":      ascent_rate,
        "float_altitude":   float_altitude,
        "stop_datetime":    float_end_datetime.toISOString()
    };
    let query_parameters = new URLSearchParams(query_parameter_obj);

    try {
        // Fetch the query response from the API
        let response = await fetch(API_URL + `?${query_parameters}`);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let response_json = await response.json();

        // Create GeoJSON features for the ascent and float stages of the tawhiri float prediction
        output_features[0] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_ascent",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response_json["request"]["dataset"] + " UTC",
                "stage": "ascent",
                ...query_parameter_obj,
                "launch_longitude": Math.round((query_parameter_obj["launch_longitude"] - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(query_parameter_obj["launch_latitude"]*1e6) / 1e6,
                "timestamp_arr": []
            }
        };
        output_features[1] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_float",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response_json["request"]["dataset"] + " UTC",
                "stage": "float",
                ...query_parameter_obj,
                "launch_longitude": Math.round((query_parameter_obj["launch_longitude"] - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(query_parameter_obj["launch_latitude"]*1e6) / 1e6,
                "timestamp_arr": []
            }
        };

        // Get the ascent and float trajectories from the prediction API response
        let ascent_trajectory = response_json['prediction'][0]['trajectory'];
        let float_trajectory = response_json['prediction'][1]['trajectory'];

        // Loop through the ascent and float trajectories, shift the longitudes, and push coordinates to the corresponding output feature
        for(let entry of ascent_trajectory){
            output_features[0]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[0]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }
        for(let entry of float_trajectory){
            output_features[1]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[1]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }

        // Record the first and last timestamps of each stage
        output_features[0]["properties"]["timestamp_ascent_first"] = ascent_trajectory[0]["datetime"];
        output_features[0]["properties"]["timestamp_ascent_last"] = ascent_trajectory.at(-1)["datetime"];
        output_features[1]["properties"]["timestamp_float_first"] = float_trajectory[0]["datetime"];
        output_features[1]["properties"]["timestamp_float_last"] = float_trajectory.at(-1)["datetime"];
        
        // Return the output features array
        return output_features;

    } catch(error) {
        console.error(error.message);
        return null;
    }
}



/**
 * 
 * @param {string} name Name of the launch location
 * @param {string} switcher_id ID of the launch location to use for the layer switcher
 * @param {number} launch_longitude Longitude of the launch location
 * @param {number} launch_latitude Latitude of the launch location
 * @param {Date} launch_datetime Datetime of the launch
 * @param {number} ascent_rate Balloon ascent rate in meters per second
 * @param {number} float_altitude Intended balloon float altitude
 * @param {number} float_ascent_rate Balloon ascent rate during the float. Must be >= 0.1 m/s
 * @param {number} float_duration Balloon float duration
 * @param {number} sea_level_descent_rate Balloon descent rate at sea level in meters per second
 * @returns An array of GeoJSON features containing the predicted trajectory of the balloon for a stitched float flight profile (two bursts stitched together to get ascent, float, and descent)
 */
async function get_stitch_float_linestring(name, switcher_id, launch_longitude, launch_latitude, launch_datetime, ascent_rate, float_altitude, float_ascent_rate, float_duration, sea_level_descent_rate){
    let output_features = [];
    
    // Encode API query parameters for the ascent API call
    let query_parameter_obj = {
        "profile":          "standard_profile",
        "launch_longitude": launch_longitude,
        "launch_latitude":  launch_latitude,
        "launch_datetime":  launch_datetime.toISOString(),
        "ascent_rate":      ascent_rate,
        "burst_altitude":   float_altitude,
        "descent_rate":     99
    };
    let query_parameters = new URLSearchParams(query_parameter_obj);

    try {
        // Fetch the ascent query response from the API
        let response = await fetch(API_URL + `?${query_parameters}`);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }
        let response_json = await response.json();

        // Create a GeoJSON feature for the ascent stage of the stitched float prediction
        output_features[0] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_ascent",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response_json["request"]["dataset"] + " UTC",
                "stage": "ascent",
                "type": "stitchfloat",
                "launch_longitude": Math.round((launch_longitude - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(launch_latitude*1e6) / 1e6,
                "launch_datetime": launch_datetime.toISOString(),
                "ascent_rate": ascent_rate,
                "float_altitude": float_altitude,
                "float_ascent_rate": float_ascent_rate,
                "float_duration": float_duration,
                "sea_level_descent_rate": sea_level_descent_rate,
                "query": {
                    ...query_parameter_obj
                },
                "timestamp_arr": []
            }
        };

        // Get the ascent trajectory from the prediction API response
        let ascent_trajectory = response_json['prediction'][0]['trajectory'];

        
        // Loop through the ascent trajectory, shift the longitudes, and push coordinates to the corresponding output feature
        for(let entry of ascent_trajectory){
            output_features[0]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[0]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }

        // Record the first and last timestamps of each stage
        output_features[0]["properties"]["timestamp_ascent_first"] = ascent_trajectory[0]["datetime"];
        output_features[0]["properties"]["timestamp_ascent_last"] = ascent_trajectory.at(-1)["datetime"];

        
        // Encode API query parameters for the float and descent API call
        query_parameter_obj = {
            "profile":          "standard_profile",
            "launch_longitude": ascent_trajectory[ascent_trajectory.length-1]['longitude'],
            "launch_latitude":  ascent_trajectory[ascent_trajectory.length-1]['latitude'],
            "launch_datetime":  ascent_trajectory[ascent_trajectory.length-1]['datetime'],
            "launch_altitude":  ascent_trajectory[ascent_trajectory.length-1]['altitude'],
            "ascent_rate":      float_ascent_rate <= 0.1 ? 0.1 : float_ascent_rate,
            "burst_altitude":   Number(ascent_trajectory[ascent_trajectory.length-1]['altitude']) + (float_ascent_rate <= 0.1 ? 0.1*float_duration*60 : float_ascent_rate*float_duration*60),
            "descent_rate":     sea_level_descent_rate
        };

        // Ensure that the burst altitude for the float / descent query is greater than the launch altitude
        if(query_parameter_obj["launch_altitude"] >= query_parameter_obj["burst_altitude"]){
            query_parameter_obj["burst_altitude"] = query_parameter_obj["launch_altitude"] + 1;
        }

        query_parameters = new URLSearchParams(query_parameter_obj);
        
        // Fetch the float and descent query response from the API
        let response2 = await fetch(API_URL + `?${query_parameters}`);
        if (!response2.ok) {
            throw new Error(`Response status: ${response2.status}`);
        }
        let response2_json = await response2.json();

        // Create GeoJSON features for the float and descent stages of the stitched float prediction
        output_features[1] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_float",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response2_json["request"]["dataset"] + " UTC",
                "stage": "float",
                "type": "stitchfloat",
                "launch_longitude": Math.round((launch_longitude - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(launch_latitude*1e6) / 1e6,
                "launch_datetime": launch_datetime.toISOString(),
                "ascent_rate": ascent_rate,
                "float_altitude": float_altitude,
                "float_ascent_rate": float_ascent_rate,
                "float_duration": float_duration,
                "sea_level_descent_rate": sea_level_descent_rate,
                "query": {
                    ...query_parameter_obj
                },
                "timestamp_arr": []
            }
        };
        output_features[2] = {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": []
            },
            "id": "predicts_data_" + switcher_id + "_descent",
            "properties": {
                "name": name,
                "switcher_id": switcher_id,
                "dataset": response2_json["request"]["dataset"] + " UTC",
                "stage": "descent",
                "type": "stitchfloat",
                "launch_longitude": Math.round((launch_longitude - 360)*1e6) / 1e6,
                "launch_latitude": Math.round(launch_latitude*1e6) / 1e6,
                "launch_datetime": launch_datetime.toISOString(),
                "ascent_rate": ascent_rate,
                "float_altitude": float_altitude,
                "float_ascent_rate": float_ascent_rate,
                "float_duration": float_duration,
                "sea_level_descent_rate": sea_level_descent_rate,
                "query": {
                    ...query_parameter_obj
                },
                "timestamp_arr": []
            }
        };

        // Get the float and descent trajectories from the prediction API response
        let float_trajectory = response2_json['prediction'][0]['trajectory'];
        let descent_trajectory = response2_json['prediction'][1]['trajectory'];

        // Loop through the float and descent trajectories, shift the longitudes, and push coordinates to the corresponding output feature
        for(let entry of float_trajectory){
            output_features[1]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[1]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }
        for(let entry of descent_trajectory){
            output_features[2]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
            output_features[2]["properties"]["timestamp_arr"].push(entry["datetime"]);
        }

        // Record the first and last timestamps of each stage
        output_features[1]["properties"]["timestamp_float_first"] = float_trajectory[0]["datetime"];
        output_features[1]["properties"]["timestamp_float_last"] = float_trajectory.at(-1)["datetime"];
        output_features[2]["properties"]["timestamp_descent_first"] = descent_trajectory[0]["datetime"];
        output_features[2]["properties"]["timestamp_descent_last"] = descent_trajectory.at(-1)["datetime"];
        
        // Return the output features array
        return output_features;

    } catch(error) {
        console.error(error.message);
        return null;
    }
}


async function apply_geofence(output_features, geofence_fc={}){
    // If there are output features,
    if(output_features){
        // Loop through geofence features
        for(let geofence of geofence_fc["features"]){
            // Loop through output features
            for(let idx_of = 0, num_of = output_features.length; idx_of < num_of; idx_of += 1){
                // If we're looking at the last feature and it's descent, there is no need to check for geofence
                if(idx_of == num_of - 1 && output_features[idx_of]["properties"]["stage"] === "descent"){
                    break;
                }

                // Check for intersections
                let geofence_intersections = turf.lineIntersect(output_features[idx_of], geofence);
                if(geofence_intersections["features"].length > 0){
                    // Find the index of the output feature nearest to the geofence intersection
                    let cutdown_position_idx = turf.nearestPointOnLine(output_features[idx_of], geofence_intersections["features"][0])["properties"]["index"];
    
                    // Add 1 to cutdown index since cutdown occurs after exiting geofence
                    cutdown_position_idx = cutdown_position_idx + 1;
    
                    // Encode API query parameters for the cutdown descent API call
                    let query_parameter_obj = {
                        "profile":          "standard_profile",
                        "launch_longitude": output_features[idx_of]['geometry']['coordinates'][cutdown_position_idx][0] + 360,
                        "launch_latitude":  output_features[idx_of]['geometry']['coordinates'][cutdown_position_idx][1],
                        "launch_datetime":  output_features[idx_of]["properties"]["timestamp_arr"][cutdown_position_idx],
                        "launch_altitude":  output_features[idx_of]['geometry']['coordinates'][cutdown_position_idx][2],
                        "ascent_rate":      output_features[idx_of]["properties"]["query"]["ascent_rate"],
                        "burst_altitude":   Number(output_features[idx_of]['geometry']['coordinates'][cutdown_position_idx][2]) + 1,
                        "descent_rate":     output_features[idx_of]["properties"]["query"]["descent_rate"]
                    };
                    // Check for unreasonable descent rates (such as during stitch float ascent)
                    if(Number(query_parameter_obj["descent_rate"]) > 70){ // 70 is arbitrary
                        // Use the output feature's properties descent rate instead of the one from the previous query
                        query_parameter_obj["descent_rate"] = output_features[idx_of]["properties"]["sea_level_descent_rate"];
                    }
                    let query_parameters = new URLSearchParams(query_parameter_obj);
    
                    // Slice the output feature to only up to cutdown
                    output_features[idx_of]['geometry']['coordinates'] = output_features[idx_of]['geometry']['coordinates'].slice(0, cutdown_position_idx);
                    output_features[idx_of]["properties"]["timestamp_arr"] = output_features[idx_of]["properties"]["timestamp_arr"].slice(0, cutdown_position_idx);
                    
                    // Slice the output features array to only features up to cut down
                    output_features = output_features.slice(0, idx_of + 1);
                    
                    try {
                        // Fetch the cutdown descent query response from the API
                        let response2 = await fetch(API_URL + `?${query_parameters}`);
                        if (!response2.ok) {
                            throw new Error(`Response status: ${response2.status}`);
                        }
                        let response2_json = await response2.json();
                        
                        // Loop through the cutdown's ascent trajectory, shift the longitudes, and push coordinates to the corresponding output feature
                        for(let entry of response2_json['prediction'][0]['trajectory']){
                            output_features[idx_of]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
                            output_features[idx_of]["properties"]["timestamp_arr"].push(entry["datetime"]);
                        }
        
                        // Add a new output feature for the cutdown descent
                        output_features.push({
                            "type": "Feature",
                            "geometry": {
                                "type": "LineString",
                                "coordinates": []
                            },
                            "id": "predicts_data_" + output_features[idx_of]["properties"]["switcher_id"] + "_descent",
                            "properties": {
                                ...output_features[idx_of]["properties"],
                                "query": {
                                    ...query_parameter_obj
                                },
                                "timestamp_arr": []
                            }
                        });
                        output_features[idx_of + 1]["properties"]["dataset"] = response2_json["request"]["dataset"] + " UTC";
                        delete output_features[idx_of + 1]["properties"]["timestamp_" + output_features[idx_of + 1]["properties"]["stage"] + "_first"]
                        delete output_features[idx_of + 1]["properties"]["timestamp_" + output_features[idx_of + 1]["properties"]["stage"] + "_last"]
                        output_features[idx_of + 1]["properties"]["stage"] = "descent";
                        
                        // Loop through the descent trajectory, shift the longitudes, and push coordinates to the corresponding output feature
                        let descent_trajectory = response2_json['prediction'][1]['trajectory'];
                        for(let entry of descent_trajectory){
                            output_features[idx_of + 1]['geometry']['coordinates'].push([entry['longitude'] - 360, entry['latitude'], entry['altitude']]);
                            output_features[idx_of + 1]["properties"]["timestamp_arr"].push(entry["datetime"]);
                        }

                        // Update the recorded first and last timestamps for each updated stage
                        output_features[idx_of]["properties"]["timestamp_" + output_features[idx_of]["properties"]["stage"] + "_last"] = output_features[idx_of]["properties"]["timestamp_arr"].at(-1);
                        output_features[idx_of + 1]["properties"]["timestamp_" + output_features[idx_of + 1]["properties"]["stage"] + "_first"] = output_features[idx_of + 1]["properties"]["timestamp_arr"][0];
                        output_features[idx_of + 1]["properties"]["timestamp_" + output_features[idx_of + 1]["properties"]["stage"] + "_last"] = output_features[idx_of + 1]["properties"]["timestamp_arr"].at(-1);
                        
                        // Return the output features array
                        return output_features;
    
                    } catch(error) {
                        console.error(error.message);
                        return null;
                    }
                }
            }
        }
    }
    
    // Return the output features array
    return output_features;
}



/**
 * 
 * @param {string} predict_type The type of predict to get. One of: "burst", "tawhiri float", or "stitch float"
 * @param {object} predict_options An object of the options to be used for the prediction process
 * @returns An array of GeoJSON features containing the predicted trajectory of the balloon for the selected predict type
 */
async function get_predict_linestring(predict_type, predict_options){
    // CUSF API requires longitude in 0-360 format
    let launch_longitude = predict_options["longitude"];
    if (launch_longitude < 0) {
        launch_longitude = launch_longitude + 360;
    }

    // Add a switcher_id, if one is not given
    if(!predict_options["switcher_id"]){
        predict_options["switcher_id"] = predict_options["name"].replaceAll(" ", "");
    }

    // Get the predict linestring for the specified predict type
    let predict_linestring;
    switch(predict_type){
        case "burst": {
            predict_linestring = await get_burst_linestring(
                predict_options["name"],
                predict_options["switcher_id"],
                launch_longitude,
                predict_options["latitude"],
                predict_options["launch_datetime"],
                predict_options["ascent_rate"],
                predict_options["burst_altitude"],
                predict_options["sea_level_descent_rate"]
            );
            break;
        }
        case "tawhiri float": {
            predict_linestring =  await get_tawhiri_float_linestring(
                predict_options["name"],
                predict_options["switcher_id"],
                launch_longitude,
                predict_options["latitude"],
                predict_options["launch_datetime"],
                predict_options["ascent_rate"],
                predict_options["float_altitude"],
                predict_options["float_end_datetime"]
            );
            break;
        }
        case "stitch float": {
            predict_linestring = await get_stitch_float_linestring(
                predict_options["name"],
                predict_options["switcher_id"],
                launch_longitude,
                predict_options["latitude"],
                predict_options["launch_datetime"],
                predict_options["ascent_rate"],
                predict_options["float_altitude"],
                predict_options["float_ascent_rate"],
                predict_options["float_duration"],
                predict_options["sea_level_descent_rate"]
            );
            break;
        }
    }

    // Apply geofence, if there are any geofence features
    // TODO: add a checkbox toggle to this IF statement
    if(predict_options["geofence_features"]){
        return await apply_geofence(predict_linestring, predict_options["geofence_features"]);
    } else{
        return predict_linestring;
    }
}



export default get_predict_linestring;
export { get_predict_linestring }