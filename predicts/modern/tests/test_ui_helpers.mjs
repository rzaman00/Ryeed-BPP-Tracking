import assert from 'node:assert/strict';
import { deriveCityLabel, evaluateReadiness, formatSweepParameter, sortReadinessRows } from '../static/ui_helpers.mjs';

assert.equal(deriveCityLabel({properties:{name:'School Name',city:'Clear Spring',address:'1 Road, Clear Spring, MD 21722'}},0),'Clear Spring');
assert.equal(deriveCityLabel({properties:{name:'School Name',address:'1 Road, Cumberland, MD 21502'}},0),'Cumberland');
assert.equal(formatSweepParameter('ascent_rate_ms',5.5),'Ascent rate: 5.5 m/s');
assert.equal(formatSweepParameter('descent_rate_ms',9),'Descent rate: 9 m/s');
assert.equal(formatSweepParameter('altitude',28000),'Burst/Float altitude: 28,000 m');

const clearWeather={wind_gust_mph:4,wind_speed_mph:2,precipitation_in:0,rain:false};
const mediumWeather={wind_gust_mph:12,wind_speed_mph:6,precipitation_in:.01,rain:true};
const highWeather={wind_gust_mph:18,wind_speed_mph:10,precipitation_in:0,rain:false};
const safeOptimal={airspace_intrusion_m:0,water_crossing_m:0,landing_in_water:false,landing_in_high_risk_airspace:false};
const conflictOptimal={airspace_intrusion_m:800,water_crossing_m:0,landing_in_water:false,landing_in_high_risk_airspace:true};
assert.equal(evaluateReadiness(clearWeather,safeOptimal,10).status,'go');
assert.equal(evaluateReadiness(mediumWeather,safeOptimal,90).status,'caution');
assert.equal(evaluateReadiness(highWeather,conflictOptimal,10).status,'no-go');
assert.equal(evaluateReadiness(null,safeOptimal,10).factors.gusts.status,'no-go');
assert.equal(evaluateReadiness({wind_gust_mph:null,rain:false},safeOptimal,10).factors.gusts.status,'no-go');
assert.equal(evaluateReadiness(clearWeather,{airspace_intrusion_m:null,water_crossing_m:0,landing_in_water:false,landing_in_high_risk_airspace:false},10).factors.airspace.status,'no-go');

const rows=[
  {site_name:'Slow',weather:mediumWeather,flight_duration_s:7200,optimal:safeOptimal,readiness:evaluateReadiness(mediumWeather,safeOptimal,10)},
  {site_name:'Fast',weather:clearWeather,flight_duration_s:3600,optimal:safeOptimal,readiness:evaluateReadiness(clearWeather,safeOptimal,10)},
  {site_name:'Blocked',weather:highWeather,flight_duration_s:1800,optimal:conflictOptimal,readiness:evaluateReadiness(highWeather,conflictOptimal,10)},
];
assert.deepEqual(sortReadinessRows(rows,'safest').map(x=>x.site_name),['Fast','Slow','Blocked']);
assert.deepEqual(sortReadinessRows(rows,'gusts').map(x=>x.site_name),['Fast','Slow','Blocked']);
assert.deepEqual(sortReadinessRows(rows,'flight').map(x=>x.site_name),['Blocked','Fast','Slow']);
console.log('ui helper tests passed');
