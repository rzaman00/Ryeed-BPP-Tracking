import { orientedRectangle, haversineMeters } from './geometry.mjs';
import { DEFAULT_SAFETY_RULES, deriveCityLabel, evaluateReadiness, formatSweepParameter, normalizeSafetyRules, sortReadinessRows } from './ui_helpers.mjs';
const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const BUILD_VERSION = '3.8.0';
const COLORS = { ascent: '#ea2c9d', float: '#19a86b', descent: '#f28a22' };
const state = {
  workspaceMode: 'predict',
  predictType: 'burst',
  dimension: '2d',
  basemap: 'topo',
  lightBasemap: 'topo',
  theme: 'light',
  config: null,
  launchLocations: [],
  predictions: new Map(),
  activePredictionId: null,
  sweepFeatures: [],
  landingMarkers: new Map(),
  launchMarkers: new Map(),
  referenceLoaded: new Set(),
  airspaceLoaded: new Set(),
  drawings: [],
  drawMode: null,
  selectedDrawingId: null,
  rectangleStart: null,
  rectangleEnd: null,
  rectanglePreview: null,
  addressRequest: null,
  appView: 'predicts',
  burstAltitudeMode: 'auto',
  manualBurstAltitude: 28000,
  inflationResult: null,
  inflationTimer: null,
  optimalSiteAnalysis: null,
  mapMode: 'operations-basic',
  weatherBySite: new Map(),
  weatherRequestId: 0,
  weatherAbortController: null,
  launchTheme: 'standard',
  readinessRows: [],
  readinessSort: 'safest',
  readinessUpdatedAt: null,
  readinessSignature: '',
  readinessStale: false,
  readinessRunning: false,
  safetyRules: {...DEFAULT_SAFETY_RULES},
  forecastComparison: null,
  forecastRunning: false,
  faaStatus: null,
  faaRefreshRunning: false,
  faaStatusTimer: null,
};

let map;
let activeMapPopup = null;
let launchSitePopupRequestId = 0;

function openMapPopup(options = {}) {
  activeMapPopup?.remove();
  const popup = new maplibregl.Popup(options);
  activeMapPopup = popup;
  popup.on('close', () => { if (activeMapPopup === popup) activeMapPopup = null; });
  return popup;
}

function toast(message, error = false, timeout = 3600) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), timeout);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let payload = null;
  try { payload = await response.json(); } catch { /* empty */ }
  if (!response.ok) {
    const detail = payload?.detail;
    const msg = typeof detail === 'string' ? detail : (detail ? JSON.stringify(detail) : `${response.status} ${response.statusText}`);
    throw new Error(msg);
  }
  return payload;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runner = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  };
  const workerCount = Math.min(items.length, Math.max(1, Number(limit) || 1));
  await Promise.all(Array.from({ length: workerCount }, runner));
  return results;
}

function feet(m) { return Number(m || 0) * 3.28084; }
function miles(m) { return Number(m || 0) / 1609.344; }
function fmt(value, digits = 0) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
function finiteNumber(value) { return value===null||value===undefined||value===''?NaN:Number(value); }
function windDirectionLabel(degrees) {
  const directions = ['N','NE','E','SE','S','SW','W','NW'];
  return directions[Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8];
}
function gustCategory(mph) {
  const gust=Number(mph||0);
  if(gust<=5)return {label:'Low',className:'low'};
  if(gust<=15)return {label:'Medium',className:'medium'};
  return {label:'High',className:'high'};
}
function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}
function localTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site'; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function baseStyle() {
  return {
    version: 8,
    sources: {
      'base-topo': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri, TomTom, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors, and the GIS User Community' },
      'base-imagery': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
      'base-imagery-labels': { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
      'base-usgs': { type: 'raster', tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'USGS' },
      'base-dark': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
      'base-dark-labels': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
    },
    layers: [
      { id: 'basemap-topo', type: 'raster', source: 'base-topo', layout: { visibility: 'visible' } },
      { id: 'basemap-hybrid', type: 'raster', source: 'base-imagery', layout: { visibility: 'none' } },
      { id: 'basemap-hybrid-labels', type: 'raster', source: 'base-imagery-labels', layout: { visibility: 'none' } },
      { id: 'basemap-usgs', type: 'raster', source: 'base-usgs', layout: { visibility: 'none' } },
      { id: 'basemap-dark', type: 'raster', source: 'base-dark', layout: { visibility: 'none' } },
      { id: 'basemap-dark-labels', type: 'raster', source: 'base-dark-labels', layout: { visibility: 'none' } },
    ],
  };
}

function addSource(id) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
}

function addOperationalLayers() {
  ['prediction', 'prediction-3d', 'prediction-launch-points', 'prediction-landing-points', 'sweep', 'drawings', 'addresses',
   'airspace-controlled', 'airspace-class_e', 'airspace-sua', 'airspace-tfr',
   'ref-schools', 'ref-mcdonalds', 'ref-dunkin', 'ref-launch_locations', 'ref-poi', 'optimal-sites', 'launch-weather',
   'forecast-model-trajectories', 'forecast-model-landings'].forEach(addSource);

  // Airspace stays useful but visually secondary to the flight path.
  map.addLayer({ id:'airspace-controlled-fill', type:'fill', source:'airspace-controlled', layout:{visibility:'visible'}, paint:{
    'fill-color':['match',['get','LOCAL_TYPE'],'R','#ef3340','CLASS_B','#1264d8','CLASS_C','#7b3fb2','CLASS_D','#1264d8','#718096'],
    'fill-opacity':.12,
  }});
  map.addLayer({ id:'airspace-controlled-line', type:'line', source:'airspace-controlled', layout:{visibility:'visible'}, paint:{
    'line-color':['match',['get','LOCAL_TYPE'],'R','#d5192f','CLASS_B','#0d58bd','CLASS_C','#6f329f','CLASS_D','#0d58bd','#5f6874'],
    'line-width':['interpolate',['linear'],['zoom'],5,.7,10,1.25], 'line-opacity':.72,
  }});
  map.addLayer({ id:'airspace-class_e-fill', type:'fill', source:'airspace-class_e', layout:{visibility:'none'}, paint:{'fill-color':'#2f7f9d','fill-opacity':.075} });
  map.addLayer({ id:'airspace-class_e-line', type:'line', source:'airspace-class_e', layout:{visibility:'none'}, paint:{'line-color':'#28718d','line-width':.75,'line-opacity':.48,'line-dasharray':[3,2]} });
  map.addLayer({ id:'airspace-sua-fill', type:'fill', source:'airspace-sua', layout:{visibility:'none'}, paint:{'fill-color':'#b52b4a','fill-opacity':.10} });
  map.addLayer({ id:'airspace-sua-line', type:'line', source:'airspace-sua', layout:{visibility:'none'}, paint:{'line-color':'#a51f3d','line-width':1.05,'line-opacity':.68,'line-dasharray':[3,2]} });
  map.addLayer({ id:'airspace-tfr-fill', type:'fill', source:'airspace-tfr', layout:{visibility:'visible'}, paint:{'fill-color':'#7f11e0','fill-opacity':.16} });
  map.addLayer({ id:'airspace-tfr-line', type:'line', source:'airspace-tfr', layout:{visibility:'visible'}, paint:{'line-color':'#6f08c6','line-width':1.3,'line-opacity':.85} });

  map.addLayer({ id:'airspace-controlled-3d', type:'fill-extrusion', source:'airspace-controlled', layout:{visibility:'none'}, paint:{
    'fill-extrusion-color':['match',['get','LOCAL_TYPE'],'R','#ef3340','CLASS_B','#1264d8','CLASS_C','#7b3fb2','CLASS_D','#1264d8','#718096'],
    'fill-extrusion-opacity':.15,
    'fill-extrusion-base':['to-number',['get','bpp_lower_m'],0],
    'fill-extrusion-height':['to-number',['get','bpp_upper_m'],0],
  }});
  map.addLayer({ id:'airspace-class_e-3d', type:'fill-extrusion', source:'airspace-class_e', layout:{visibility:'none'}, paint:{
    'fill-extrusion-color':'#2f7f9d','fill-extrusion-opacity':.08,
    'fill-extrusion-base':['to-number',['get','bpp_lower_m'],0],
    'fill-extrusion-height':['to-number',['get','bpp_upper_m'],0],
  }});
  map.addLayer({ id:'airspace-sua-3d', type:'fill-extrusion', source:'airspace-sua', layout:{visibility:'none'}, paint:{
    'fill-extrusion-color':'#b52b4a','fill-extrusion-opacity':.11,
    'fill-extrusion-base':['to-number',['get','bpp_lower_m'],0],
    'fill-extrusion-height':['to-number',['get','bpp_upper_m'],0],
  }});

  // Reference layers from the existing BPP data files.
  map.addLayer({id:'ref-schools-layer',type:'circle',source:'ref-schools',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#24b82e','circle-opacity':.84,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-mcdonalds-layer',type:'circle',source:'ref-mcdonalds',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#ffc72c','circle-opacity':.9,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-dunkin-layer',type:'circle',source:'ref-dunkin',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#da1884','circle-opacity':.88,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-launch_locations-layer',type:'circle',source:'ref-launch_locations',layout:{visibility:'none'},paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':4,'circle-stroke-color':'#0059ff'}});
  const siteStatusColor=['match',['get','site_status'],'best','#d7a820','viable','#1f9d55','no-go','#d83a45','#8b949e'];
  map.addLayer({id:'optimal-site-halo',type:'circle',source:'optimal-sites',paint:{'circle-radius':['case',['==',['get','site_status'],'best'],18,14],'circle-color':siteStatusColor,'circle-opacity':.26,'circle-blur':.42}});
  map.addLayer({id:'optimal-site-points',type:'circle',source:'optimal-sites',paint:{'circle-radius':['case',['==',['get','site_status'],'best'],10,8.5],'circle-color':siteStatusColor,'circle-stroke-width':3,'circle-stroke-color':siteStatusColor}});
  map.addLayer({id:'ref-poi-layer',type:'circle',source:'ref-poi',layout:{visibility:'none'},paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':4,'circle-stroke-color':'#e21f26'}});
  map.addLayer({id:'addresses-layer',type:'circle',source:'addresses',layout:{visibility:'none'},minzoom:11,paint:{'circle-radius':3,'circle-color':'#0084ff','circle-opacity':.7,'circle-stroke-width':.5,'circle-stroke-color':'#fff'}});

  // Launch-weather map mode. White means dry and blue means rain. A separate
  // severity ring makes gust strength readable without reusing optimal-site green.
  map.addLayer({id:'launch-weather-gust-ring',type:'circle',source:'launch-weather',layout:{visibility:'none'},paint:{
    'circle-radius':['interpolate',['linear'],['coalesce',['to-number',['get','wind_gust_mph']],0],0,11,15,16,30,23,50,31],
    'circle-color':'rgba(0,0,0,0)',
    'circle-stroke-width':['interpolate',['linear'],['coalesce',['to-number',['get','wind_gust_mph']],0],0,2,30,4,50,6],
    'circle-stroke-color':['case',['<=',['coalesce',['to-number',['get','wind_gust_mph']],0],5],'#94a3b8',['<=',['coalesce',['to-number',['get','wind_gust_mph']],0],15],'#facc15','#ef4444'],
    'circle-stroke-opacity':.9
  }});
  map.addLayer({id:'launch-weather-points',type:'circle',source:'launch-weather',layout:{visibility:'none'},paint:{
    'circle-radius':['interpolate',['linear'],['coalesce',['to-number',['get','wind_gust_mph']],0],0,7,15,10,30,14,50,18],
    'circle-color':['case',['boolean',['get','rain'],false],'#2788ff','#ffffff'],
    'circle-opacity':.96,'circle-stroke-width':3,
    'circle-stroke-color':['case',['boolean',['get','rain'],false],'#ffffff','#1e293b']
  }});

  // Drawings.
  map.addLayer({id:'drawing-fill',type:'fill',source:'drawings',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['case',['boolean',['get','selected'],false],'#f2b84b','#9254d6'],'fill-opacity':['case',['boolean',['get','preview'],false],.12,.18]}});
  map.addLayer({id:'drawing-3d',type:'fill-extrusion',source:'drawings',filter:['all',['==',['geometry-type'],'Polygon'],['!', ['boolean',['get','preview'],false]]],layout:{visibility:'none'},paint:{'fill-extrusion-color':['case',['boolean',['get','selected'],false],'#f2b84b','#9254d6'],'fill-extrusion-base':0,'fill-extrusion-height':['coalesce',['to-number',['get','upper_altitude_m']],0],'fill-extrusion-opacity':.26}});
  map.addLayer({id:'drawing-line',type:'line',source:'drawings',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['case',['boolean',['get','selected'],false],'#b86e00','#7626c5'],'line-width':['case',['boolean',['get','selected'],false],3,2]}});
  map.addLayer({id:'drawing-guide',type:'line',source:'drawings',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#f2b84b','line-width':3,'line-dasharray':[2,1.5],'line-opacity':.95}});
  map.addLayer({id:'drawing-point',type:'circle',source:'drawings',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['case',['boolean',['get','selected'],false],7,6],'circle-color':'#9254d6','circle-stroke-width':2,'circle-stroke-color':'#fff'}});

  // Parameter sweep is deliberately quieter than the primary trajectories.
  map.addLayer({id:'sweep-lines',type:'line',source:'sweep',paint:{'line-color':['match',['get','stage'],'ascent',COLORS.ascent,'float',COLORS.float,'descent',COLORS.descent,'#777'],'line-width':2,'line-opacity':.38,'line-dasharray':[2,2]}});
  map.addLayer({id:'sweep-hitbox',type:'line',source:'sweep',paint:{'line-color':'#000000','line-width':12,'line-opacity':.001}});

  // Screening estimates from each winds-aloft model. Tawhiri remains the
  // authoritative solid trajectory displayed above these dashed comparison lines.
  map.addLayer({id:'forecast-model-lines',type:'line',source:'forecast-model-trajectories',paint:{'line-color':['get','color'],'line-width':2.5,'line-opacity':.9,'line-dasharray':[2,1.5]}});
  map.addLayer({id:'forecast-model-landings-layer',type:'circle',source:'forecast-model-landings',paint:{'circle-radius':7,'circle-color':['get','color'],'circle-stroke-width':2.5,'circle-stroke-color':'#ffffff'}});

  // Primary flight path casing + bright stage colors keep trajectory visually dominant.
  map.addLayer({id:'prediction-casing',type:'line',source:'prediction',paint:{'line-color':'#ffffff','line-width':['interpolate',['linear'],['zoom'],5,7,10,10],'line-opacity':.92}});
  map.addLayer({id:'prediction-lines',type:'line',source:'prediction',paint:{'line-color':['match',['get','stage'],'ascent',COLORS.ascent,'float',COLORS.float,'descent',COLORS.descent,'#111'],'line-width':['interpolate',['linear'],['zoom'],5,4,10,6],'line-opacity':1}});
  map.addLayer({id:'prediction-3d-curtain',type:'fill-extrusion',source:'prediction-3d',layout:{visibility:'none'},paint:{
    'fill-extrusion-color':['match',['get','stage'],'ascent',COLORS.ascent,'float',COLORS.float,'descent',COLORS.descent,'#111'],
    'fill-extrusion-opacity':.48,'fill-extrusion-base':0,'fill-extrusion-height':['to-number',['get','altitude_m'],0],
  }});

  // Render launch and landing points inside MapLibre rather than as HTML markers.
  // Keeping the points in the same WebGL coordinate system as the trajectory prevents
  // pixel drift at different zoom levels and keeps the red landing target exactly on
  // the final trajectory coordinate for every launch site.
  map.addLayer({id:'prediction-launch-halo',type:'circle',source:'prediction-launch-points',paint:{
    'circle-radius':10,'circle-color':'rgba(18,100,216,.22)','circle-blur':.25
  }});
  map.addLayer({id:'prediction-launch-points-layer',type:'circle',source:'prediction-launch-points',paint:{
    'circle-radius':6,'circle-color':'#ffffff','circle-stroke-width':3,'circle-stroke-color':'#1264d8'
  }});
  map.addLayer({id:'prediction-landing-halo',type:'circle',source:'prediction-landing-points',paint:{
    'circle-radius':['case',['boolean',['get','active'],false],18,14],
    'circle-color':'#e2262f','circle-opacity':['case',['boolean',['get','active'],false],.24,.15],
    'circle-blur':.45
  }});
  map.addLayer({id:'prediction-landing-points-layer',type:'circle',source:'prediction-landing-points',paint:{
    'circle-radius':['case',['boolean',['get','active'],false],10,8],
    'circle-color':'#e2262f','circle-stroke-width':3,'circle-stroke-color':'#ffffff'
  }});
  map.addLayer({id:'prediction-landing-center',type:'circle',source:'prediction-landing-points',paint:{
    'circle-radius':2.5,'circle-color':'#ffffff'
  }});

  map.on('click','launch-weather-points',(e)=>{
    const f=e.features?.[0];if(!f)return;const p=f.properties||{};const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    showLaunchSiteDetails({siteId:p.site_id,siteName:p.site_name,coordinates:coords.slice(0,2),weather:p});
  });
  map.on('mouseenter','launch-weather-points',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','launch-weather-points',()=>{map.getCanvas().style.cursor='';});
  registerFeaturePopups();
}

function registerFeaturePopups() {
  const simpleLayers = [
    ['ref-mcdonalds-layer','McDonald\'s'],['ref-dunkin-layer','Dunkin\''],['ref-poi-layer','Point of Interest'],['addresses-layer','Address']
  ];
  simpleLayers.forEach(([layer, title]) => {
    map.on('click', layer, (e) => {
      const f = e.features?.[0]; if (!f) return;
      const props = f.properties || {};
      const useful = Object.entries(props).filter(([k,v]) => v != null && String(v).trim() && !['fid'].includes(k)).slice(0,8);
      const body = useful.map(([k,v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');
      openMapPopup().setLngLat(e.lngLat).setHTML(`<strong>${title}</strong>${body}`).addTo(map);
    });
  });
  const airspaceLayers=['airspace-controlled-fill','airspace-class_e-fill','airspace-sua-fill','airspace-tfr-fill'];
  for(const layer of airspaceLayers){
    map.on('click',layer,(e)=>{const f=e.features?.[0];if(!f)return;const p=f.properties||{};const title=p.bpp_airspace_layer||p.LOCAL_TYPE||p.TYPE_CODE||p.type||'Airspace';const fields=[['Name',p.NAME||p.NAME_TXT||p.description||p.TITLE],['Class',p.CLASS||p.LOCAL_TYPE],['Lower',p.LOWER_VAL?`${p.LOWER_VAL} ${p.LOWER_UOM||'ft'}`:null],['Upper',p.UPPER_VAL?`${p.UPPER_VAL} ${p.UPPER_UOM||'ft'}`:null],['NOTAM',p.notam_id||p.NOTAM_KEY]].filter(x=>x[1]!=null&&String(x[1]).trim());openMapPopup().setLngLat(e.lngLat).setHTML(`<strong>${esc(title)}</strong>${fields.map(([k,v])=>`<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('')}`).addTo(map);});
    map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
  }
  map.on('click','sweep-hitbox',(e)=>{
    const feature=e.features?.[0];if(!feature)return;const props=feature.properties||{};
    const label=formatSweepParameter(props.sweep_parameter,props.sweep_value);
    const stage=props.stage?String(props.stage).replace(/^./,x=>x.toUpperCase()):'Trajectory';
    openMapPopup().setLngLat(e.lngLat).setHTML(`<strong>Parameter Sweep</strong><div>${esc(label)}</div><div><b>Stage:</b> ${esc(stage)}</div>`).addTo(map);
  });
  map.on('mouseenter','sweep-hitbox',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','sweep-hitbox',()=>{map.getCanvas().style.cursor='';});
  map.on('click','optimal-site-points',(e)=>{
    const f=e.features?.[0];if(!f)return;const p=f.properties||{};
    const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];showLaunchSiteDetails({siteId:p.site_id,siteName:p.site_name,coordinates:coords.slice(0,2),optimal:p});
  });
  map.on('mouseenter','optimal-site-points',()=>{map.getCanvas().style.cursor='pointer';});
  map.on('mouseleave','optimal-site-points',()=>{map.getCanvas().style.cursor='';});
  map.on('click','ref-schools-layer',(e)=>{
    const f=e.features?.[0]; if(!f)return;
    const props=f.properties||{}; const coord=e.lngLat;
    const wrap=document.createElement('div');
    wrap.innerHTML=`<strong>${esc(props.NAME || props.name || 'Public School')}</strong><div style="font-size:10px;margin-top:4px">${esc(props.STREET || props.address || '')} ${esc(props.CITY || '')}</div>`;
    const btn=document.createElement('button');btn.textContent='Create predict point here';btn.style.marginTop='7px';btn.onclick=()=>{addPointDrawing(coord.lng,coord.lat,props.NAME||'School launch');popup.remove();};wrap.appendChild(btn);
    const popup=openMapPopup().setLngLat(coord).setDOMContent(wrap).addTo(map);
  });
  map.on('click','prediction-lines',(e)=>{
    const id=e.features?.[0]?.properties?.site_id;if(id&&state.predictions.has(id)){state.activePredictionId=id;renderSummary();refreshPredictionSources();}
  });
  map.on('click','prediction-launch-points-layer',(e)=>{
    const f=e.features?.[0];if(!f)return;const p=f.properties||{};const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    showLaunchSiteDetails({siteId:p.site_id,siteName:p.site_name,coordinates:coords.slice(0,2)});
  });
  map.on('click','ref-launch_locations-layer',(e)=>{
    const f=e.features?.[0];if(!f)return;const p=f.properties||{};const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    showLaunchSiteDetails({siteId:p.site_id,siteName:p.site_name||p.city||p.name,coordinates:coords.slice(0,2)});
  });
  map.on('click','prediction-landing-points-layer',(e)=>{
    const f=e.features?.[0];if(!f)return;
    const id=f.properties?.site_id;if(id&&state.predictions.has(id)){state.activePredictionId=id;renderSummary();refreshPredictionSources();}
    const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    const landingTime=f.properties?.landing_time||'';
    openMapPopup({offset:12}).setLngLat(coords.slice(0,2)).setHTML(`<strong>${esc(f.properties?.site_name||'Predicted landing')}</strong><br>${Number(coords[1]).toFixed(5)}, ${Number(coords[0]).toFixed(5)}${landingTime?`<br>${esc(localTime(landingTime))}`:''}`).addTo(map);
  });
  map.on('click','forecast-model-landings-layer',(e)=>{
    const f=e.features?.[0];if(!f)return;const p=f.properties||{};const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    openMapPopup({offset:12}).setLngLat(coords.slice(0,2)).setHTML(`<strong>${esc(p.model_name||'Forecast model')}</strong><div>Screening landing estimate</div><div>${Number(coords[1]).toFixed(5)}, ${Number(coords[0]).toFixed(5)}</div><div><b>From consensus:</b> ${fmt(miles(p.distance_from_consensus_m),1)} mi</div>`).addTo(map);
  });
  ['prediction-lines','prediction-launch-points-layer','prediction-landing-points-layer','ref-launch_locations-layer','forecast-model-landings-layer'].forEach(layer=>{
    map.on('mouseenter',layer,()=>{map.getCanvas().style.cursor='pointer';});
    map.on('mouseleave',layer,()=>{map.getCanvas().style.cursor='';});
  });
}

function setBasemap(name) {
  state.basemap = name;
  const groups = {
    topo:['basemap-topo'], hybrid:['basemap-hybrid','basemap-hybrid-labels'], usgs:['basemap-usgs'], dark:['basemap-dark','basemap-dark-labels']
  };
  Object.entries(groups).forEach(([key, ids]) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id,'visibility',key===name?'visible':'none')));
}

function setDimension(mode) {
  state.dimension = mode;
  const is3d = mode === '3d';
  map.easeTo({ pitch:is3d?55:0, bearing:is3d?-12:0, duration:500 });
  if (map.getLayer('prediction-3d-curtain')) map.setLayoutProperty('prediction-3d-curtain','visibility',is3d?'visible':'none');
  if (map.getLayer('drawing-3d')) map.setLayoutProperty('drawing-3d','visibility',is3d?'visible':'none');
  syncAirspaceVisibility();
}

function checkboxForLayer(key) { return qs(`input[data-layer="${key}"]`); }
function layerChecked(key) { return !!checkboxForLayer(key)?.checked; }

function syncAirspaceVisibility() {
  const is3d = state.dimension === '3d';
  const advanced = state.mapMode === 'operations-advanced';
  const safetyBasic = state.mapMode === 'operations-basic';
  for (const key of ['controlled','class_e','sua']) {
    const visible = layerChecked(key) && (advanced || (safetyBasic && ['controlled','sua'].includes(key)));
    for (const suffix of ['fill','line']) {
      const id=`airspace-${key}-${suffix}`; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible&&!is3d?'visible':'none');
    }
    const id3=`airspace-${key}-3d`; if(map.getLayer(id3)) map.setLayoutProperty(id3,'visibility',visible&&is3d?'visible':'none');
  }
  for (const suffix of ['fill','line']) { const id=`airspace-tfr-${suffix}`; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',(advanced||safetyBasic)&&layerChecked('tfr')?'visible':'none'); }
}

async function loadAirspace(key, reload = false) {
  if (state.airspaceLoaded.has(key) && !reload) return;
  try {
    const r = await api(`/api/airspace/${key}`);
    map.getSource(`airspace-${key}`).setData(r.data);
    state.airspaceLoaded.add(key);
    if (r.warning) toast(`${key} airspace: ${r.warning}`, true, 5200);
  } catch (e) { toast(`Could not load ${key} airspace: ${e.message}`, true, 5200); }
}

function formatFreshnessAge(seconds){
  const value=Number(seconds);if(!Number.isFinite(value))return 'not cached';
  if(value<60)return 'less than 1 min old';if(value<3600)return `${Math.round(value/60)} min old`;
  return `${(value/3600).toFixed(1)} hr old`;
}
function renderFaaStatus(){
  const chip=$('faaStatusChip'),detail=$('faaStatusDetail'),button=$('refreshFaaData');if(!chip||!detail||!button)return;
  button.disabled=state.faaRefreshRunning;
  if(state.faaRefreshRunning){chip.className='faa-status-chip refreshing';chip.textContent='Refreshing FAA…';detail.textContent='Checking B/C/D, SUA, Class E, and TFR sources.';return;}
  const datasets=state.faaStatus?.datasets||[];const unavailable=datasets.filter(item=>!item.available||item.source==='unavailable');const stale=datasets.filter(item=>item.stale);
  const tfr=datasets.find(item=>item.dataset==='tfr');
  if(!datasets.length){chip.className='faa-status-chip pending';chip.textContent='FAA status pending';detail.textContent='FAA layers refresh automatically every 15 minutes.';return;}
  chip.className=`faa-status-chip ${unavailable.length?'error':stale.length?'warning':'fresh'}`;
  chip.textContent=unavailable.length?`${unavailable.length} FAA layer${unavailable.length===1?'':'s'} unavailable`:stale.length?`${stale.length} FAA layer${stale.length===1?'':'s'} stale`:'FAA data current';
  detail.textContent=`TFR ${formatFreshnessAge(tfr?.age_seconds)} · automatic refresh every ${Math.round(Number(state.faaStatus?.automatic_refresh_seconds||900)/60)} min`;
}
async function refreshFaaData(force=false){
  if(state.faaRefreshRunning)return;
  state.faaRefreshRunning=force;renderFaaStatus();
  try{
    if(force){
      state.faaStatus=await api('/api/airspace-refresh',{method:'POST',body:JSON.stringify({datasets:['controlled','class_e','sua','tfr']})});
      await Promise.all(['controlled','class_e','sua','tfr'].map(key=>loadAirspace(key,true)));
      syncAirspaceVisibility();markReadinessStale();toast('FAA airspace and TFR data refreshed.');
    }else state.faaStatus=await api('/api/airspace-status');
  }catch(error){if(force)toast(`FAA refresh: ${error.message}`,true,6200);}
  finally{state.faaRefreshRunning=false;renderFaaStatus();}
}

const REFERENCE_LAYER_IDS = { schools:'ref-schools-layer',mcdonalds:'ref-mcdonalds-layer',dunkin:'ref-dunkin-layer',launch_locations:'ref-launch_locations-layer',poi:'ref-poi-layer',addresses:'addresses-layer' };
async function loadReference(key) {
  if (key === 'addresses') { queryAddresses(); return; }
  if (state.referenceLoaded.has(key)) return;
  try {
    const r = await api(`/api/reference/${key}`);
    map.getSource(`ref-${key}`).setData(r.data);
    state.referenceLoaded.add(key);
    if (r.warning) toast(`${key.replace('_',' ')}: ${r.warning}`, true, 5200);
  } catch (e) { toast(`Could not load ${key}: ${e.message}`, true, 5200); }
}
function setReferenceVisibility(key, visible) {
  const enabled=visible&&state.mapMode==='operations-advanced';
  const id=REFERENCE_LAYER_IDS[key]; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',enabled?'visible':'none');
  if (enabled) loadReference(key);
}

function syncReferenceVisibility(){
  Object.keys(REFERENCE_LAYER_IDS).forEach(key=>{
    const checked=Boolean(checkboxForLayer(key)?.checked);
    setReferenceVisibility(key,checked);
  });
}


function weatherSitePayload(target){
  const [lon,lat]=target.geometry.coordinates;
  return {site_id:target._id||slug(target._label||'site'),name:target._label||target.properties?.name||'Launch site',latitude:Number(lat),longitude:Number(lon)};
}
function allWeatherTargets(){return [...state.launchLocations,...allCustomPointTargets()];}
function launchTargetById(siteId){
  return state.launchLocations.find(x=>x._id===siteId)||allCustomPointTargets().find(x=>x._id===siteId)||null;
}
function launchTargetNear(coordinates){
  const [lon,lat]=coordinates.map(Number);let best=null,bestDistance=Infinity;
  for(const target of allWeatherTargets()){
    const [x,y]=target.geometry?.coordinates||[];const distance=Math.hypot(Number(x)-lon,Number(y)-lat);
    if(distance<bestDistance){best=target;bestDistance=distance;}
  }
  return bestDistance<.001?best:null;
}
function launchAddress(properties={}){
  const direct=properties.address||properties.ADDRESS||properties.Address;
  if(direct)return String(direct);
  return [properties.street||properties.STREET,properties.city||properties.CITY,properties.state||properties.STATE,properties.zip||properties.ZIP].filter(Boolean).join(', ')||'No street address available';
}
function ventuskyUrl(lat,lon){return `https://www.ventusky.com/?p=${Number(lat).toFixed(5)};${Number(lon).toFixed(5)};9&l=wind-10m`;}
function launchDetailsHtml({target,siteName,coordinates,weather,optimal,loading=false}){
  const [lon,lat]=coordinates.map(Number);const props=target?.properties||{};const title=siteName||target?._label||props.name||'Launch site';
  const rain=weather&&(String(weather.rain)==='true'||weather.rain===true);const direction=Number(weather?.wind_direction_deg);const gust=gustCategory(weather?.wind_gust_mph);
  const weatherHtml=loading?'<p class="launch-popup-loading">Loading launch conditions…</p>':weather?`<div class="popup-weather-row"><b>${rain?'Rain':'Dry'}</b><span>Wind ${fmt(weather.wind_speed_mph,1)} mph</span><span class="gust-${gust.className}">${gust.label} gust · ${fmt(weather.wind_gust_mph,1)} mph</span></div><div class="launch-popup-grid"><span><small>Direction</small><b>${Number.isFinite(direction)?`${Math.round(direction)}° ${windDirectionLabel(direction)}`:'—'}</b></span><span><small>Temperature</small><b>${weather.temperature_f==null?'—':`${fmt(weather.temperature_f,0)}°F`}</b></span><span><small>Precipitation</small><b>${fmt(weather.precipitation_in,2)} in</b></span><span><small>Forecast time</small><b>${esc(localTime(weather.datetime))}</b></span></div><small class="weather-source">${esc(weather.source||'Weather forecast')}</small>`:'<p class="launch-popup-loading">Conditions are unavailable for this site.</p>';
  const optimalHtml=optimal?`<div class="launch-optimal-detail"><b>${esc(optimal.site_status==='best'?'Preferred + viable':optimal.site_status==='viable'?'Viable':'No-go')}</b><span>Best ascent ${fmt(optimal.best_ascent_rate_ms,1)} m/s · Airspace ${fmt(miles(optimal.airspace_horizontal_intrusion_m??optimal.airspace_intrusion_m),2)} mi · Water ${fmt(miles(optimal.water_crossing_m),2)} mi</span></div>`:'';
  return `<div class="launch-site-popup"><h3>${esc(title)}</h3><section><strong>Weather</strong>${weatherHtml}<a class="ventusky-link" href="${esc(ventuskyUrl(lat,lon))}" target="_blank" rel="noopener noreferrer">Open this launch site in Ventusky ↗</a></section><section><strong>Launch details</strong><div class="launch-detail-row"><small>Address</small><b>${esc(launchAddress(props))}</b></div><div class="launch-detail-row"><small>Coordinates</small><b>${lat.toFixed(5)}, ${lon.toFixed(5)}</b></div>${props.data_source?`<div class="launch-detail-row"><small>Location source</small><b>${esc(props.data_source)}</b></div>`:''}${optimalHtml}</section></div>`;
}
async function showLaunchSiteDetails({siteId,siteName,coordinates,weather=null,optimal=null}){
  const requestId=++launchSitePopupRequestId;const target=launchTargetById(siteId)||launchTargetNear(coordinates);const resolvedId=siteId||target?._id;
  let currentWeather=weather||state.weatherBySite.get(resolvedId)||null;
  const popup=openMapPopup({offset:14,className:'launch-site-detail-popup',maxWidth:'360px'}).setLngLat(coordinates).setHTML(launchDetailsHtml({target,siteName,coordinates,weather:currentWeather,optimal,loading:!currentWeather})).addTo(map);
  if(currentWeather)return;
  try{
    const [lon,lat]=coordinates;currentWeather=await api(`/api/weather/site?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&launch_datetime=${encodeURIComponent(buildLaunchDateTime().toISOString())}`);
    if(resolvedId)state.weatherBySite.set(resolvedId,currentWeather);
    if(requestId===launchSitePopupRequestId&&activeMapPopup===popup)popup.setHTML(launchDetailsHtml({target,siteName,coordinates,weather:currentWeather,optimal}));
  }catch(e){if(requestId===launchSitePopupRequestId&&activeMapPopup===popup)popup.setHTML(launchDetailsHtml({target,siteName,coordinates,weather:null,optimal}));}
}
function setWeatherLayerVisibility(visible){
  ['launch-weather-gust-ring','launch-weather-points'].forEach(id=>{if(map?.getLayer(id))map.setLayoutProperty(id,'visibility',visible?'visible':'none');});
  $('weatherMapLegend')?.classList.toggle('hidden',!visible);
  if(map?.getLayer('prediction-lines'))map.setPaintProperty('prediction-lines','line-opacity',visible ? .48 : 1);
  if(map?.getLayer('prediction-casing'))map.setPaintProperty('prediction-casing','line-opacity',visible ? .45 : .92);
  if(map?.getLayer('sweep-lines'))map.setPaintProperty('sweep-lines','line-opacity',visible ? .16 : .38);
}
function setMapMode(mode){
  const allowed=new Set(['operations-basic','operations-advanced','weather']);
  state.mapMode=allowed.has(mode)?mode:'operations-basic';
  const advanced=state.mapMode==='operations-advanced';
  document.documentElement.dataset.operationMode=advanced?'advanced':'basic';
  if(state.mapMode!=='weather')state.weatherAbortController?.abort();
  setWeatherLayerVisibility(state.mapMode==='weather');
  if(state.mapMode==='operations-basic')setPredictionType('burst');
  if(!advanced){
    setDimension('2d');
    const dimension=qs('input[name="dimension"][value="2d"]');if(dimension)dimension.checked=true;
  }
  if(!advanced){$('drawingMenu')?.classList.add('hidden');$('sweepPanel')?.classList.add('hidden');}
  syncAirspaceVisibility();syncReferenceVisibility();
  if(advanced||state.mapMode==='operations-basic'){
    const requested=['controlled','class_e','sua','tfr'].filter(key=>layerChecked(key)&&(advanced||['controlled','sua','tfr'].includes(key)));
    Promise.all(requested.map(key=>loadAirspace(key))).then(syncAirspaceVisibility).catch(error=>console.warn('Airspace layers',error));
  }
  if(state.mapMode==='weather')refreshWeatherMap();
}
async function refreshWeatherMap(){
  if(state.mapMode!=='weather'||!map?.getSource('launch-weather'))return;
  state.weatherAbortController?.abort();
  const controller=new AbortController();state.weatherAbortController=controller;
  const requestId=++state.weatherRequestId;const targets=allWeatherTargets();
  if(!targets.length){state.weatherAbortController=null;map.getSource('launch-weather').setData({type:'FeatureCollection',features:[]});return;}
  const body={sites:targets.map(weatherSitePayload),launch_datetime:buildLaunchDateTime().toISOString()};
  try{
    const r=await api('/api/weather/batch',{method:'POST',body:JSON.stringify(body),signal:controller.signal});if(requestId!==state.weatherRequestId)return;
    state.weatherBySite.clear();for(const item of r.results||[]){if(item.weather)state.weatherBySite.set(item.site_id,item.weather);}
    map.getSource('launch-weather').setData(r.data||{type:'FeatureCollection',features:[]});
    const failures=(r.results||[]).filter(x=>x.error).length;if(failures)toast(`Weather loaded with ${failures} unavailable site${failures===1?'':'s'}.`,true,4200);
  }catch(e){if(e.name!=='AbortError'&&requestId===state.weatherRequestId)toast(`Weather map: ${e.message}`,true,5500);}
  finally{if(state.weatherAbortController===controller)state.weatherAbortController=null;}
}

function deriveSiteLabel(feature, idx) { return deriveCityLabel(feature, idx); }

async function loadLaunchLocations() {
  const r = await api('/api/launch-locations');
  const rawFeatures = r.data?.features || [];
  // Final UI guard: one preset row per city even if a stale cache or historical
  // source contains multiple records for the same operational launch city.
  const uniqueByCity=new Map();
  rawFeatures.forEach((f,idx)=>{const label=deriveSiteLabel(f,idx).trim();const key=label.toLowerCase();if(!uniqueByCity.has(key))uniqueByCity.set(key,f);});
  const features=[...uniqueByCity.values()];
  state.launchLocations = features.map((f,idx)=>{
    const label=deriveSiteLabel(f,idx);
    return {...f,_id:`preset-${slug(label)}`,_label:label};
  });
  buildPredictSiteList();
  const allBtn=$('findOptimalAll');if(allBtn){const label=allBtn.querySelector('.optimal-label');if(label)label.textContent=`Find Optimal: All ${state.launchLocations.length} Sites`;}
  const mapFeatures=state.launchLocations.map(site=>({...site,properties:{...(site.properties||{}),site_id:site._id,site_name:site._label}}));
  map.getSource('ref-launch_locations')?.setData({type:'FeatureCollection',features:mapFeatures});
  state.referenceLoaded.add('launch_locations');
  refreshForecastSites();
  if(r.warning) toast(`Launch locations: ${r.warning}`,true,6000);
  if(features.length) console.info(`Loaded ${features.length} launch sites from`,r.sources||[]);
  if(state.mapMode==='weather')refreshWeatherMap();
  if(state.appView==='readiness'&&!state.readinessRows.length)refreshReadiness();
}

function buildPredictSiteList() {
  const root=$('predictSiteList');root.innerHTML='';
  const clearSpringIndex=Math.max(0,state.launchLocations.findIndex(site=>/clear spring|fairview/i.test(`${site._label} ${site.properties?.address||''}`)));
  state.launchLocations.forEach((site,idx)=>{
    const label=document.createElement('label');label.className='predict-site';label.dataset.predictSiteRow=site._id;
    const span=document.createElement('span');span.textContent=site._label;span.title=site.properties?.address||site.properties?.name||site._label;
    const input=document.createElement('input');input.type='checkbox';input.dataset.predictSite=site._id;input.checked=idx===clearSpringIndex;
    input.addEventListener('change',()=>{refreshPredictionSources();renderSummary();refreshMarkers();markReadinessStale();});
    label.append(span,input);root.appendChild(label);
  });
  if(!state.launchLocations.length)root.innerHTML='<p class="loading-text">No launch locations available.</p>';
  refreshSweepSites();
  refreshOptimalSiteHighlights();
}

function buildCustomPredictSiteList(){
  const root=$('customPredictSiteList');if(!root)return;root.innerHTML='';
  const points=state.drawings.filter(d=>d.properties?.kind==='point');
  for(const d of points){const id=`custom-${d.properties.drawing_id}`;const label=document.createElement('label');label.className='predict-site custom-predict-site';label.dataset.customPredictSiteRow=id;const span=document.createElement('span');span.textContent=d.properties?.name||'Custom Launch';const input=document.createElement('input');input.type='checkbox';input.dataset.customPredictSite=id;input.checked=d.properties?.predict_enabled!==false;input.addEventListener('change',()=>{d.properties.predict_enabled=input.checked;refreshPredictionSources();renderSummary();markReadinessStale();});label.append(span,input);root.appendChild(label);}
  if(!points.length)root.innerHTML='<p class="loading-text">Draw a point to add a custom launch site.</p>';
}
function clearPredictSites(){
  qsa('input[data-predict-site],input[data-custom-predict-site]').forEach(input=>{input.checked=false;});
  state.drawings.filter(d=>d.properties?.kind==='point').forEach(d=>{d.properties.predict_enabled=false;});
  refreshPredictionSources();refreshMarkers();renderSummary();markReadinessStale();toast('All launch sites deselected.');
}
function selectedPresetSites() {
  const checked=new Set(qsa('input[data-predict-site]:checked').map(x=>x.dataset.predictSite));
  return state.launchLocations.filter(s=>checked.has(s._id));
}
function isSiteVisible(id){const input=qs(`input[data-predict-site="${CSS.escape(id)}"]`);if(input)return input.checked;if(id.startsWith('custom-')){const c=qs(`input[data-custom-predict-site="${CSS.escape(id)}"]`);return $('customPredictEnabled').checked&&(c?c.checked:true);}return true;}

function invalidateOptimalSiteAnalysis(){
  if(!state.optimalSiteAnalysis)return;
  state.optimalSiteAnalysis=null;$('siteStatusLegend')?.classList.add('hidden');refreshOptimalSiteHighlights();
}
function siteStatusClass(status){return status==='best'?'site-best':status==='viable'?'site-viable':'site-nogo';}
function showSiteStatusLegend(){ const el=$('siteStatusLegend');if(!el||!state.optimalSiteAnalysis)return;el.classList.remove('hidden'); }
function refreshOptimalSiteHighlights(){
  const analysis=state.optimalSiteAnalysis;
  const ranking=analysis?.ranking||[];const byId=new Map(ranking.map(x=>[x.site_id,x]));
  qsa('[data-predict-site-row],[data-custom-predict-site-row]').forEach(row=>{
    row.classList.remove('site-best','site-viable','site-nogo');
    const id=row.dataset.predictSiteRow||row.dataset.customPredictSiteRow;const result=byId.get(id);
    if(result){row.classList.add(siteStatusClass(result.site_status));const adjust=Math.abs(Number(result.best_ascent_rate_ms)-Number(result.requested_ascent_rate_ms));const reasons=(result.decision_reasons||[]).join('; ');row.title=`${result.site_name} · ${result.site_status} · best ascent ${fmt(result.best_ascent_rate_ms,1)} m/s${adjust?` (${adjust.toFixed(1)} m/s adjustment)`:''} · ${reasons}`;}
  });
  const features=ranking.map(result=>({type:'Feature',geometry:{type:'Point',coordinates:[Number(result.longitude),Number(result.latitude)]},properties:{...result}}));
  map?.getSource?.('optimal-sites')?.setData({type:'FeatureCollection',features});
  const result=$('optimalResult');
  if(!result)return;
  if(!analysis){result.classList.add('hidden');result.textContent='';return;}
  const gold=ranking.find(x=>x.site_status==='best');
  if(gold){const adjustment=Math.abs(Number(gold.best_ascent_rate_ms)-Number(gold.requested_ascent_rate_ms));result.textContent=`Gold: ${gold.site_name} · preferred + viable · best ascent ${fmt(gold.best_ascent_rate_ms,1)} m/s${adjustment?` · adjust ${adjustment.toFixed(1)} m/s`:''}${analysis.cache_hit?' · cached':''}`;}
  else if(Number(analysis.viable_count||0)>0){result.textContent=`No preferred gold site · ${analysis.viable_count}/${ranking.length} viable sites are green${analysis.cache_hit?' · cached':''}`;}
  else{result.textContent=`No viable sites found · all evaluated sites are red/no-go${analysis.cache_hit?' · cached':''}`;}
  result.classList.remove('hidden');showSiteStatusLegend();
}
function setOptimalButton(which,running,detail=''){
  const id=which==='all'?'findOptimalAll':'findOptimalCurrent';const stateId=which==='all'?'optimalAllState':'optimalCurrentState';
  const btn=$(id);if(!btn)return;btn.disabled=running;btn.classList.toggle('running',running);$(stateId).textContent=detail;
}
function candidateFromTarget(target){
  const [lon,lat]=target.geometry.coordinates;const city=String(target._label||'');
  return {site_id:target._id,name:target._label,latitude:Number(lat),longitude:Number(lon),preferred:String(target._id||'').startsWith('preset-')&&/^(clear spring|hancock)$/i.test(city.trim())};
}
function optimalSweepRates(){
  const current=Number($('ascentRate').value);
  if(!$('optimalAscentSweep')?.checked)return [current];
  return [current,current-.5,current+.5,current-1,current+1].filter((v,i,a)=>v>0&&v<=20&&a.indexOf(v)===i);
}
function updateOptimalSweepLabel(){
  const on=Boolean($('optimalAscentSweep')?.checked);
  const label=$('optimalSweepModeLabel');if(label)label.textContent=on?'Try ±0.5 / ±1.0 m/s':'Current rate only';
}
function optimalAirspaceLayers(){
  // B/C/D, Special Use and active TFRs are operational conflict layers. Class E
  // is only added when the operator explicitly turns that broad layer on.
  const layers=['controlled','sua','tfr'];
  const classE=qs('input[data-layer="class_e"]');if(classE?.checked)layers.push('class_e');
  return layers;
}
function optimalRequestBody(sites){
  const template=predictionBody(sites[0]);
  return {
    launch_sites:sites.map(candidateFromTarget),
    mode:template.mode,launch_datetime:template.launch_datetime,ascent_rate_ms:template.ascent_rate_ms,descent_rate_ms:template.descent_rate_ms,
    burst_altitude_m:template.burst_altitude_m,float_altitude_m:template.float_altitude_m,float_ascent_rate_ms:template.float_ascent_rate_ms,float_duration_min:template.float_duration_min,
    airspace_layers:optimalAirspaceLayers(),ascent_rate_sweep_ms:optimalSweepRates(),
    automatic_burst:state.predictType==='burst'&&state.burstAltitudeMode==='auto',inflation:inflationRequestBody(),
  };
}
async function findOptimalSite(scope='current'){
  if(state.workspaceMode!=='predict'){toast('Optimal-site search is available in Predict mode.',true);return;}
  if(!(await ensureAutomaticBurst()))return;
  const targets=scope==='all'?[...state.launchLocations]:[...selectedPresetSites(),...allCustomPointTargets()];
  const unique=new Map(targets.map(t=>[t._id,t]));const sites=[...unique.values()];
  if(!sites.length){toast(scope==='all'?'No launch sites are loaded.':'Select at least one launch site or draw a custom point first.',true);return;}
  const body=optimalRequestBody(sites);
  const rates=optimalSweepRates();setOptimalButton(scope,true,`${sites.length}×${rates.length}`);
  try{
    const result=await api('/api/optimal-site',{method:'POST',body:JSON.stringify(body)});result.scope=scope;state.optimalSiteAnalysis=result;refreshOptimalSiteHighlights();
    markReadinessStale();
    const gold=result.ranking?.find(x=>x.site_status==='best');const viable=result.viable_count||0;if(gold){toast(`Preferred viable site: ${gold.site_name} (gold). ${viable}/${result.ranking.length} viable · ${rates.length===1?'current rate only':'ascent sweep'}.${result.cache_hit?' Cached result.':''}`,false,7200);}else{toast(`No preferred gold site. ${viable}/${result.ranking.length} sites viable · ${rates.length===1?'current rate only':'ascent sweep'}.${result.cache_hit?' Cached result.':''}`,false,7200);}
    if(result.warnings?.length)console.warn('Optimal-site airspace warnings',result.warnings);
  }catch(e){refreshOptimalSiteHighlights();toast(`Optimal-site search: ${e.message}`,true,7000);}
  finally{setOptimalButton(scope,false,'');}
}

// BPP safety rules ----------------------------------------------------------
const SAFETY_RULES_STORAGE_KEY='bpp-safety-rules-v1';
function populateSafetyRulesForm(){
  const r=state.safetyRules;
  $('ruleGustLowMax').value=r.gustLowMaxMph;$('ruleGustNoGoAbove').value=r.gustNoGoAboveMph;
  $('ruleRainCaution').value=r.precipitationCautionAboveIn;$('ruleRainNoGo').value=r.precipitationNoGoAboveIn;
  $('ruleForecastCaution').value=r.forecastCautionAfterMin;$('ruleForecastNoGo').value=r.forecastNoGoAfterMin;
  $('ruleAirspaceMax').value=r.maxAirspaceCrossingM;$('ruleWaterMax').value=r.maxWaterCrossingM;
  $('ruleHighRiskLanding').checked=r.highRiskLandingNoGo;
  renderSafetyRulesSummary();
}
function safetyRulesFromForm(){
  return normalizeSafetyRules({
    gustLowMaxMph:$('ruleGustLowMax').value,gustNoGoAboveMph:$('ruleGustNoGoAbove').value,
    precipitationCautionAboveIn:$('ruleRainCaution').value,precipitationNoGoAboveIn:$('ruleRainNoGo').value,
    forecastCautionAfterMin:$('ruleForecastCaution').value,forecastNoGoAfterMin:$('ruleForecastNoGo').value,
    maxAirspaceCrossingM:$('ruleAirspaceMax').value,maxWaterCrossingM:$('ruleWaterMax').value,
    highRiskLandingNoGo:$('ruleHighRiskLanding').checked,
  });
}
function renderSafetyRulesSummary(){
  const r=state.safetyRules;
  if($('safetyRulesSummary'))$('safetyRulesSummary').textContent=`Low gusts ≤ ${fmt(r.gustLowMaxMph,1)} mph · NO-GO gusts > ${fmt(r.gustNoGoAboveMph,1)} mph · forecast caution after ${fmt(r.forecastCautionAfterMin)} min · NO-GO after ${fmt(r.forecastNoGoAfterMin)} min`;
  if($('readinessPolicyText'))$('readinessPolicyText').textContent=`GO requires every enabled factor to clear. Gusts above ${fmt(r.gustLowMaxMph,1)} through ${fmt(r.gustNoGoAboveMph,1)} mph, precipitation above ${Number(r.precipitationCautionAboveIn).toFixed(2)} in, or a forecast over ${fmt(r.forecastCautionAfterMin)} minutes old produces CAUTION. Gusts over ${fmt(r.gustNoGoAboveMph,1)} mph, precipitation over ${Number(r.precipitationNoGoAboveIn).toFixed(2)} in, airspace over ${fmt(r.maxAirspaceCrossingM)} m, water over ${fmt(r.maxWaterCrossingM)} m, unavailable safety data, or a forecast over ${fmt(r.forecastNoGoAfterMin)} minutes old produces NO-GO.`;
  if($('criteriaGoText'))$('criteriaGoText').textContent=`Gusts at or below ${fmt(r.gustLowMaxMph,1)} mph, precipitation within the GO limit, fresh forecast, operational airspace crossing at or below ${fmt(r.maxAirspaceCrossingM)} m, water crossing at or below ${fmt(r.maxWaterCrossingM)} m, and a permitted landing.`;
  if($('criteriaCautionText'))$('criteriaCautionText').textContent=`Gusts above ${fmt(r.gustLowMaxMph,1)} through ${fmt(r.gustNoGoAboveMph,1)} mph, precipitation above ${Number(r.precipitationCautionAboveIn).toFixed(2)} in, or forecast data ${fmt(r.forecastCautionAfterMin)}–${fmt(r.forecastNoGoAfterMin)} minutes old.`;
  if($('criteriaNoGoText'))$('criteriaNoGoText').textContent=`Gusts over ${fmt(r.gustNoGoAboveMph,1)} mph, precipitation over ${Number(r.precipitationNoGoAboveIn).toFixed(2)} in, missing data, an airspace/water crossing above its limit,${r.highRiskLandingNoGo?' a high-risk landing,':''} or forecast older than ${fmt(r.forecastNoGoAfterMin)} minutes.`;
}
function restoreSafetyRules(){
  try{state.safetyRules=normalizeSafetyRules(JSON.parse(localStorage.getItem(SAFETY_RULES_STORAGE_KEY)||'{}'));}
  catch{state.safetyRules={...DEFAULT_SAFETY_RULES};}
  populateSafetyRulesForm();
}
function saveSafetyRules(){
  state.safetyRules=safetyRulesFromForm();localStorage.setItem(SAFETY_RULES_STORAGE_KEY,JSON.stringify(state.safetyRules));
  populateSafetyRulesForm();markReadinessStale();renderReadiness();toast('BPP safety rules saved on this computer.');
}
function resetSafetyRules(){
  state.safetyRules={...DEFAULT_SAFETY_RULES};localStorage.removeItem(SAFETY_RULES_STORAGE_KEY);
  populateSafetyRulesForm();markReadinessStale();renderReadiness();toast('BPP safety rules reset to operational defaults.');
}

// Forecast-model comparison + winds aloft ---------------------------------
function forecastTargets(){
  const unique=new Map([...state.launchLocations,...allCustomPointTargets()].map(target=>[target._id,target]));return [...unique.values()];
}
function refreshForecastSites(){
  const select=$('forecastSite');if(!select)return;const current=select.value;select.innerHTML='';
  for(const target of forecastTargets()){const option=document.createElement('option');option.value=target._id;option.textContent=target._label;select.appendChild(option);}
  const preferred=state.activePredictionId||current;if([...select.options].some(option=>option.value===preferred))select.value=preferred;
}
function forecastTarget(){return forecastTargets().find(target=>target._id===$('forecastSite')?.value)||null;}
function clearForecastMap(){
  map?.getSource?.('forecast-model-trajectories')?.setData({type:'FeatureCollection',features:[]});
  map?.getSource?.('forecast-model-landings')?.setData({type:'FeatureCollection',features:[]});
}
function renderWindsAloft(models){
  const root=$('windsAloftChart');if(!root)return;const available=models.filter(model=>model.ok&&model.profile?.length);
  if(!available.length){root.innerHTML='<p class="forecast-empty">Winds-aloft profiles are unavailable.</p>';return;}
  const width=760,height=330,pad={left:58,right:18,top:22,bottom:40};
  const maxAltitude=Math.max(...available.flatMap(model=>model.profile.map(row=>Number(row.altitude_ft)||0)),feet($('burstAltitude')?.value||0));
  const maxWind=Math.max(10,...available.flatMap(model=>model.profile.map(row=>Number(row.wind_speed_mph)||0)));
  const x=value=>pad.left+(Number(value)/maxWind)*(width-pad.left-pad.right);const y=value=>height-pad.bottom-(Number(value)/maxAltitude)*(height-pad.top-pad.bottom);
  const yTicks=[0,.25,.5,.75,1].map(fraction=>`<g><line x1="${pad.left}" x2="${width-pad.right}" y1="${y(maxAltitude*fraction)}" y2="${y(maxAltitude*fraction)}"/><text x="${pad.left-9}" y="${y(maxAltitude*fraction)+4}" text-anchor="end">${Math.round(maxAltitude*fraction/1000)}k</text></g>`).join('');
  const xTicks=[0,.25,.5,.75,1].map(fraction=>`<g><line x1="${x(maxWind*fraction)}" x2="${x(maxWind*fraction)}" y1="${pad.top}" y2="${height-pad.bottom}"/><text x="${x(maxWind*fraction)}" y="${height-15}" text-anchor="middle">${Math.round(maxWind*fraction)}</text></g>`).join('');
  const lines=available.map(model=>{const points=model.profile.map(row=>`${x(row.wind_speed_mph).toFixed(1)},${y(row.altitude_ft).toFixed(1)}`).join(' ');const dots=model.profile.map(row=>`<circle cx="${x(row.wind_speed_mph).toFixed(1)}" cy="${y(row.altitude_ft).toFixed(1)}" r="3" fill="${esc(model.color)}"><title>${esc(model.model_name)} · ${fmt(row.altitude_ft)} ft · ${fmt(row.wind_speed_mph,1)} mph from ${fmt(row.wind_direction_deg)}°</title></circle>`).join('');return `<polyline points="${points}" fill="none" stroke="${esc(model.color)}" stroke-width="3"/>${dots}`;}).join('');
  const legend=available.map(model=>`<span><i style="background:${esc(model.color)}"></i>${esc(model.model_name)}</span>`).join('');
  root.innerHTML=`<div class="winds-chart-legend">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Wind speed by altitude for available forecast models"><g class="winds-grid">${yTicks}${xTicks}</g>${lines}<text class="axis-label" x="${width/2}" y="${height-2}" text-anchor="middle">Wind speed (mph)</text><text class="axis-label" transform="translate(14 ${height/2}) rotate(-90)" text-anchor="middle">Altitude (thousand ft)</text></svg>`;
}
function renderForecastComparison(result){
  const models=result?.models||[];const available=models.filter(model=>model.ok);const agreement=result?.agreement||{};
  const badge=$('forecastAgreement');badge.className=`forecast-agreement ${agreement.level||'unavailable'}`;badge.textContent=agreement.level==='unavailable'?'Agreement unavailable':`${String(agreement.level).toUpperCase()} agreement`;
  $('forecastAgreementDetail').textContent=available.length?`${available.length}/${models.length} models · maximum landing spread ${fmt(miles(agreement.max_landing_spread_m),1)} mi · gust spread ${fmt(agreement.gust_spread_mph,1)} mph`:'No forecast model returned a complete profile.';
  const body=$('forecastModelTableBody');body.innerHTML='';
  for(const model of models){const tr=document.createElement('tr');if(!model.ok){tr.innerHTML=`<td><span class="model-name"><i style="background:${esc(model.color)}"></i>${esc(model.model_name)}</span></td><td colspan="8" class="model-error">${esc(model.error||'Unavailable')}</td>`;body.appendChild(tr);continue;}
    const surface=model.surface||{},landing=model.estimate?.landing||{},strongest=(model.profile||[]).reduce((best,row)=>Number(row.wind_speed_mph)>Number(best?.wind_speed_mph||-1)?row:best,null);const conservative=agreement.conservative_model_id===model.model_id;
    tr.innerHTML=`<td><span class="model-name"><i style="background:${esc(model.color)}"></i>${esc(model.model_name)}${conservative?'<b>Conservative</b>':''}</span></td><td>${fmt(surface.wind_speed_mph,1)} mph · ${fmt(surface.wind_direction_deg)}°</td><td>${fmt(surface.wind_gust_mph,1)} mph</td><td>${Number(surface.precipitation_in||0).toFixed(2)} in</td><td>${surface.temperature_f==null?'—':`${fmt(surface.temperature_f)}°F`}</td><td>${Number.isFinite(Number(landing.latitude))?`${Number(landing.latitude).toFixed(4)}, ${Number(landing.longitude).toFixed(4)}`:'—'}</td><td>${fmt(miles(model.distance_from_consensus_m),1)} mi</td><td>${duration(model.estimate?.flight_duration_s)}</td><td>${strongest?`${fmt(strongest.wind_speed_mph,1)} mph @ ${fmt(strongest.altitude_ft)} ft`:'—'}</td>`;body.appendChild(tr);
  }
  renderWindsAloft(models);
  const lineFeatures=[],landingFeatures=[];
  for(const model of available){const estimate=model.estimate||{};if(estimate.trajectory?.length)lineFeatures.push({type:'Feature',geometry:{type:'LineString',coordinates:estimate.trajectory},properties:{model_id:model.model_id,model_name:model.model_name,color:model.color}});if(estimate.landing)landingFeatures.push({type:'Feature',geometry:{type:'Point',coordinates:[estimate.landing.longitude,estimate.landing.latitude]},properties:{model_id:model.model_id,model_name:model.model_name,color:model.color,distance_from_consensus_m:model.distance_from_consensus_m||0}});}
  map?.getSource?.('forecast-model-trajectories')?.setData({type:'FeatureCollection',features:lineFeatures});map?.getSource?.('forecast-model-landings')?.setData({type:'FeatureCollection',features:landingFeatures});
}
async function loadForecastComparison(){
  const target=forecastTarget();if(!target){toast('Choose a launch site for forecast analysis.',true);return;}if(!(await ensureAutomaticBurst()))return;
  state.forecastRunning=true;$('refreshForecastComparison').disabled=true;$('forecastPanelState').textContent='Loading models and winds aloft…';
  try{const result=await api('/api/forecast-comparison',{method:'POST',body:JSON.stringify(predictionBody(target))});state.forecastComparison=result;renderForecastComparison(result);$('forecastPanelState').textContent=`Updated ${new Date(result.generated_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;}
  catch(error){clearForecastMap();$('forecastPanelState').textContent='Forecast analysis unavailable';toast(`Forecast models: ${error.message}`,true,7000);}
  finally{state.forecastRunning=false;$('refreshForecastComparison').disabled=false;}
}
function openForecastPanel(){refreshForecastSites();$('forecastPanel').classList.remove('hidden');loadForecastComparison();}
function closeForecastPanel(){$('forecastPanel').classList.add('hidden');clearForecastMap();}

// Launch readiness ----------------------------------------------------------
function readinessTargets(){
  const unique=new Map([...selectedPresetSites(),...customPointTargets()].map(target=>[target._id,target]));
  return [...unique.values()];
}
function readinessInputSignature(targets=readinessTargets()){
  return JSON.stringify({
    sites:targets.map(x=>x._id).sort(),date:$('launchDate')?.value,time:$('launchTime')?.value,timezone:$('launchTimezone')?.value,
    type:state.predictType,ascent:$('ascentRate')?.value,descent:$('descentRate')?.value,burst:$('burstAltitude')?.value,burstMode:state.burstAltitudeMode,
    floatAltitude:$('floatAltitude')?.value,floatRate:$('floatRate')?.value,floatDuration:$('floatDuration')?.value,sweep:Boolean($('optimalAscentSweep')?.checked),airspace:optimalAirspaceLayers(),safetyRules:state.safetyRules,
  });
}
function markReadinessStale(){
  if(!state.readinessRows.length)return;
  state.readinessStale=true;
  if(state.appView==='readiness')renderReadiness();
}
function readinessAgeMinutes(row){
  return Number.isFinite(Number(row.weather_received_at))?Math.max(0,(Date.now()-Number(row.weather_received_at))/60000):Infinity;
}
function readinessLabel(status){return status==='go'?'GO':status==='caution'?'CAUTION':'NO-GO';}
function readinessFactorTitle(key){return {gusts:'Gusts',precipitation:'Precipitation',airspace:'Airspace conflicts',freshness:'Forecast age',landing:'Landing / water risk'}[key]||key;}
function readinessReason(readiness){
  const issues=Object.entries(readiness.factors).filter(([,value])=>value.status!=='go').map(([key,value])=>`${readinessFactorTitle(key)}: ${value.detail}`);
  return issues.length?issues.join(' · '):'All weather, airspace, water, freshness, and landing checks clear.';
}
function renderReadinessConditions(){
  const launch=(()=>{try{return buildLaunchDateTime();}catch{return null;}})();
  $('readinessConditionDate').textContent=launch?launch.toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'}):($('launchDate')?.value||'—');
  $('readinessConditionTime').textContent=launch?`${launch.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · ${$('launchTimezone')?.value==='utc'?'UTC':'Local'}`:'—';
  $('readinessConditionAscent').textContent=`${fmt($('ascentRate')?.value,1)} m/s · ${$('optimalAscentSweep')?.checked?'best-rate sweep on':'current rate only'}`;
  $('readinessConditionBurst').textContent=`${fmt($('burstAltitude')?.value)} m · ${fmt(feet($('burstAltitude')?.value))} ft${state.burstAltitudeMode==='auto'?' · automatic':''}`;
}
function resetReadinessFactor(id){const el=$(id);if(!el)return;el.className='readiness-factor pending';const strong=qs('strong',el);if(strong)strong.textContent='—';}
function renderReadinessFactor(id,factorResult){
  const el=$(id);if(!el)return;el.className=`readiness-factor ${factorResult.status}`;const strong=qs('strong',el);if(strong)strong.textContent=factorResult.detail;
}
function renderReadiness(){
  renderReadinessConditions();
  const tableWrap=$('readinessTableWrap'),empty=$('readinessEmpty'),body=$('readinessTableBody');
  const evaluated=state.readinessRows.map(row=>{
    const forecast_age_min=readinessAgeMinutes(row);return {...row,forecast_age_min,readiness:evaluateReadiness(row.weather,row.optimal,forecast_age_min,state.safetyRules)};
  });
  $('readinessSiteCount').textContent=`${evaluated.length} site${evaluated.length===1?'':'s'}`;
  $('refreshReadiness').disabled=state.readinessRunning;$('readinessRunState').textContent=state.readinessRunning?'Checking…':'';
  if(!evaluated.length){
    tableWrap.classList.add('hidden');empty.classList.remove('hidden');body.innerHTML='';
    $('readinessStatus').className='readiness-status pending';$('readinessStatus').textContent='NOT EVALUATED';
    $('readinessSite').textContent=readinessTargets().length?'Update readiness to evaluate the current selection':'Select launch sites in Predicts';
    $('readinessExplanation').textContent='Readiness uses current weather, trajectory, and airspace data. Every factor remains visible below.';
    $('readinessUpdated').textContent='—';$('readinessUpdated').className='readiness-updated';
    ['Gusts','Precipitation','Airspace','Freshness','Landing'].forEach(name=>resetReadinessFactor(`readinessFactor${name}`));
    return;
  }
  empty.classList.add('hidden');tableWrap.classList.remove('hidden');
  const safest=sortReadinessRows(evaluated,'safest')[0];const status=safest.readiness.status;const factors=safest.readiness.factors;
  $('readinessStatus').className=`readiness-status ${status}`;$('readinessStatus').textContent=readinessLabel(status);
  $('readinessSite').textContent=`${safest.site_name} · safest selected site`;
  $('readinessExplanation').textContent=readinessReason(safest.readiness);
  $('readinessUpdated').textContent=state.readinessStale?'Inputs changed · update required':`Updated ${new Date(state.readinessUpdatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  $('readinessUpdated').className=`readiness-updated${state.readinessStale?' readiness-stale':''}`;
  renderReadinessFactor('readinessFactorGusts',factors.gusts);renderReadinessFactor('readinessFactorPrecipitation',factors.precipitation);renderReadinessFactor('readinessFactorAirspace',factors.airspace);renderReadinessFactor('readinessFactorFreshness',factors.freshness);renderReadinessFactor('readinessFactorLanding',factors.landing);
  body.innerHTML='';
  for(const row of sortReadinessRows(evaluated,state.readinessSort)){
    const w=row.weather,o=row.optimal,r=row.readiness;const landing=row.landing||o?.landing;const lat=Number(row.latitude),lon=Number(row.longitude);
    const wind=finiteNumber(w?.wind_speed_mph),gust=finiteNumber(w?.wind_gust_mph),temp=finiteNumber(w?.temperature_f),intrusion=finiteNumber(o?.airspace_horizontal_intrusion_m??o?.airspace_intrusion_m),water=finiteNumber(o?.water_crossing_m),ascent=finiteNumber(o?.best_ascent_rate_ms);
    const direction=finiteNumber(w?.wind_direction_deg);const windText=Number.isFinite(wind)?`${wind.toFixed(1)} mph${Number.isFinite(direction)?` · ${Math.round(direction)}° ${windDirectionLabel(direction)}`:''}`:'Unavailable';
    const rainText=w?(w.rain||finiteNumber(w.precipitation_in)>0?`${Number(w.precipitation_in||0).toFixed(2)} in`:'Dry'):'Unavailable';
    const landingLat=finiteNumber(landing?.latitude),landingLon=finiteNumber(landing?.longitude);const landingText=Number.isFinite(landingLat)&&Number.isFinite(landingLon)?`${landingLat.toFixed(4)}, ${landingLon.toFixed(4)}`:'Unavailable';
    const hazardParts=[];if(Number.isFinite(intrusion)&&intrusion>0)hazardParts.push(`${miles(intrusion).toFixed(2)} mi airspace`);if(Number.isFinite(water)&&water>0)hazardParts.push(`${miles(water).toFixed(2)} mi water`);if(!hazardParts.length)hazardParts.push(Number.isFinite(intrusion)&&Number.isFinite(water)?'Clear':'Unavailable');
    const landingRisk=o?(o.landing_in_water?'Landing in mapped water':o.water_crossing_m>0?'Trajectory crosses Chesapeake Bay':o.landing_in_high_risk_airspace?'High-risk landing zone':'Safe landing area'):'Risk unavailable';
    const tr=document.createElement('tr');tr.innerHTML=`<td><div class="readiness-site-name"><strong>${esc(row.site_name)}</strong><small>${esc(row.address)}</small></div></td><td><span class="site-readiness ${r.status}">${readinessLabel(r.status)}</span></td><td class="readiness-reason-cell">${esc(readinessReason(r))}</td><td>${esc(windText)}</td><td class="factor-cell ${r.factors.gusts.status}">${Number.isFinite(gust)?`${gust.toFixed(1)} mph`:'Unavailable'}</td><td class="factor-cell ${r.factors.precipitation.status}">${esc(rainText)}</td><td>${Number.isFinite(temp)?`${temp.toFixed(0)}°F`:'—'}</td><td class="factor-cell ${r.factors.freshness.status}">${r.forecast_age_min<1?'&lt;1 min':Number.isFinite(r.forecast_age_min)?`${Math.round(r.forecast_age_min)} min`:'Unavailable'}</td><td>${Number.isFinite(ascent)?`${ascent.toFixed(1)} m/s`:'—'}</td><td>${Number.isFinite(Number(row.flight_duration_s))?duration(row.flight_duration_s):'—'}</td><td class="landing-cell factor-cell ${r.factors.landing.status}">${esc(landingText)}<small>${esc(landingRisk)}</small></td><td class="factor-cell ${r.factors.airspace.status}">${esc(hazardParts.join(' · '))}</td><td><a class="table-ventusky" href="${esc(ventuskyUrl(lat,lon))}" target="_blank" rel="noopener noreferrer">Ventusky ↗</a></td>`;body.appendChild(tr);
  }
}
async function refreshReadiness(){
  if(state.readinessRunning)return;
  const targets=readinessTargets();
  if(!targets.length){state.readinessRows=[];state.readinessUpdatedAt=null;renderReadiness();toast('Select at least one launch site in Predicts first.',true);return;}
  if(!(await ensureAutomaticBurst()))return;
  let launchDatetime;
  try{launchDatetime=buildLaunchDateTime().toISOString();}catch(e){toast(e.message,true);return;}
  state.readinessRunning=true;renderReadiness();
  const receivedAt=Date.now();const weatherRequest={sites:targets.map(weatherSitePayload),launch_datetime:launchDatetime};const optimalRequest=optimalRequestBody(targets);
  const [weatherOutcome,optimalOutcome]=await Promise.allSettled([
    api('/api/weather/batch',{method:'POST',body:JSON.stringify(weatherRequest)}),
    api('/api/optimal-site',{method:'POST',body:JSON.stringify(optimalRequest)}),
  ]);
  const weatherById=new Map();const optimalById=new Map();const errors=[];
  if(weatherOutcome.status==='fulfilled'){
    for(const item of weatherOutcome.value.results||[]){if(item.weather){weatherById.set(item.site_id,item.weather);state.weatherBySite.set(item.site_id,item.weather);}else if(item.error)errors.push(`${item.name||item.site_id} weather: ${item.error}`);}
  }else errors.push(`Weather: ${weatherOutcome.reason?.message||weatherOutcome.reason}`);
  if(optimalOutcome.status==='fulfilled'){
    const result=optimalOutcome.value;result.scope='current';state.optimalSiteAnalysis=result;for(const item of result.ranking||[])optimalById.set(item.site_id,item);refreshOptimalSiteHighlights();
    for(const [siteId,message] of Object.entries(result.errors||{}))errors.push(`${siteId}: ${message}`);
  }else errors.push(`Airspace and landing analysis: ${optimalOutcome.reason?.message||optimalOutcome.reason}`);
  state.readinessRows=targets.map(target=>{
    const [longitude,latitude]=target.geometry.coordinates;const optimal=optimalById.get(target._id)||null;const prediction=state.predictions.get(target._id)?.summary||{};
    return {site_id:target._id,site_name:target._label,latitude:Number(latitude),longitude:Number(longitude),address:launchAddress(target.properties),weather:weatherById.get(target._id)||null,weather_received_at:weatherById.has(target._id)?receivedAt:null,optimal,flight_duration_s:optimal?.flight_duration_s??prediction.flight_duration_s??null,landing:optimal?.landing??prediction.landing??null};
  });
  state.readinessUpdatedAt=receivedAt;state.readinessSignature=readinessInputSignature(targets);state.readinessStale=false;state.readinessRunning=false;renderReadiness();
  if(errors.length)toast(`Readiness completed with unavailable data: ${errors.join(' | ')}`,true,7500);
}

function setPredictionType(type) {
  state.predictType = type;
  qs('.control-strip')?.classList.toggle('float-mode',type==='float');
  qsa('.burst-control').forEach(el=>el.classList.toggle('hidden',type!=='burst'));
  qsa('.float-control').forEach(el=>el.classList.toggle('hidden',type!=='float'));
  $('predictType').value=type;
  updateAltitudeLabels();
}
function updateAltitudeLabels(){
  const auto=state.burstAltitudeMode==='auto';
  $('burstFeet').textContent=auto&&state.inflationResult?`${fmt(feet($('burstAltitude').value))} ft · auto`:`${fmt(feet($('burstAltitude').value))} ft${auto?' · calculating…':''}`;
  $('floatFeet').textContent=`${fmt(feet($('floatAltitude').value))} ft`;
}

function setAppView(view){
  const allowed=new Set(['predicts','safety','readiness','inflation','info']);
  state.appView=allowed.has(view)?view:'predicts';
  const mapView=state.appView==='predicts';
  $('predictsView').classList.toggle('hidden',!mapView);
  $('safetyRulesView')?.classList.toggle('hidden',state.appView!=='safety');
  $('readinessView')?.classList.toggle('hidden',state.appView!=='readiness');
  $('inflationView').classList.toggle('hidden',state.appView!=='inflation');
  $('infoView')?.classList.toggle('hidden',state.appView!=='info');
  qsa('[data-app-view]').forEach(b=>{const active=b.dataset.appView===state.appView;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');});
  setWorkspaceMode('predict');
  if(mapView)setTimeout(()=>map?.resize?.(),40);
  else if($('forecastPanel')&&!$('forecastPanel').classList.contains('hidden'))closeForecastPanel();
  if(state.appView==='readiness'){
    if(state.readinessRows.length&&state.readinessSignature!==readinessInputSignature())state.readinessStale=true;
    renderReadiness();
    if(!state.readinessRows.length&&state.launchLocations.length)setTimeout(()=>refreshReadiness(),0);
  }
}

function inflationRequestBody(){
  return {
    station_pressure_inhg:Number($('inflationPressure').value),
    site_temperature_f:Number($('inflationTemperature').value),
    balloon_neck_mass_kg:Number($('inflationBalloonMass').value),
    payload_mass_kg:Number($('inflationPayloadMass').value),
    target_ascent_rate_ms:Number($('inflationAscentRate').value),
  };
}
function renderInflationResult(r){
  state.inflationResult=r;$('inflationError').classList.add('hidden');$('inflationStatus').textContent='Calculated';
  $('inflationExpectedAscent').textContent=`${fmt(r.expected_ascent_rate_ms,3)} m/s`;
  $('inflationLift').textContent=`${fmt(r.required_scale_lift_lb,3)} lb`;
  $('inflationPsi').textContent=`${fmt(r.required_psi,3)} PSI`;
  $('inflationBurstM').textContent=`${fmt(r.burst_altitude_m)} m`;
  $('inflationBurstFt').textContent=`${fmt(r.burst_altitude_ft)} ft above launch site`;
  if(state.burstAltitudeMode==='auto'){ $('burstAltitude').value=String(Math.round(r.burst_altitude_m)); $('burstAltitude').disabled=true; updateAltitudeLabels(); }
}
async function calculateInflation(silent=false){
  $('inflationStatus').textContent='Calculating…';
  try{
    const r=await api('/api/inflation/calculate',{method:'POST',body:JSON.stringify(inflationRequestBody())});
    renderInflationResult(r);return r;
  }catch(e){
    state.inflationResult=null;$('inflationStatus').textContent='Check inputs';$('inflationError').textContent=e.message;$('inflationError').classList.remove('hidden');
    if(!silent)toast(`Inflation calculator: ${e.message}`,true,6500);throw e;
  }
}
function scheduleInflationCalculation(){clearTimeout(state.inflationTimer);state.inflationTimer=setTimeout(()=>calculateInflation(true).catch(()=>{}),220);}
function setBurstAltitudeMode(mode){
  state.burstAltitudeMode=mode==='manual'?'manual':'auto';$('burstAltitudeMode').value=state.burstAltitudeMode;
  if(state.burstAltitudeMode==='manual'){ $('burstAltitude').disabled=false;$('burstAltitude').value=String(state.manualBurstAltitude);updateAltitudeLabels(); }
  else { $('burstAltitude').disabled=true;if(state.inflationResult){$('burstAltitude').value=String(Math.round(state.inflationResult.burst_altitude_m));updateAltitudeLabels();}else calculateInflation(true).catch(()=>{}); }
}
async function ensureAutomaticBurst(){
  if(state.predictType!=='burst'||state.burstAltitudeMode!=='auto')return true;
  try{await calculateInflation(true);return true;}catch(e){toast(`Cannot run automatic burst prediction: ${e.message}`,true,6500);return false;}
}

function setWorkspaceMode(mode) {
  state.workspaceMode='predict';
  $('predictControlStrip')?.classList.remove('hidden');
}

function buildLaunchDateTime() {
  const date=$('launchDate').value,time=$('launchTime').value||'10:00';
  if(!date)throw new Error('Choose a launch date');
  const zone=$('launchTimezone').value;
  const d=new Date(`${date}T${time}:00${zone==='utc'?'Z':''}`);
  if(Number.isNaN(d.getTime()))throw new Error('Invalid launch date/time');
  if(d.getTime()<Date.now()-5*60*1000)throw new Error('Past predictions are not supported. Choose the current time or a future launch time.');
  return d;
}
function updateLaunchTimeControl(){
  const value=$('launchTime')?.value||'10:00';const [rawHour,rawMinute]=value.split(':').map(Number);const hour=rawHour%12||12;const suffix=rawHour>=12?'PM':'AM';const zone=$('launchTimezone')?.value==='utc'?'UTC':'Local';
  if($('launchTimeDisplay'))$('launchTimeDisplay').textContent=`${hour}:${String(rawMinute||0).padStart(2,'0')} ${suffix} · ${zone}`;
}
function toggleLaunchTimePopover(force){
  const popover=$('launchTimePopover'),button=$('launchTimeButton');if(!popover||!button)return;
  const open=typeof force==='boolean'?force:popover.classList.contains('hidden');popover.classList.toggle('hidden',!open);button.setAttribute('aria-expanded',String(open));
  if(open)setTimeout(()=>$('launchTime')?.focus(),0);
}
function predictionBody(target) {
  const [lon,lat]=target.geometry.coordinates;
  return {
    mode:state.predictType,
    launch:{name:target._label||target.properties?.name||'Launch',latitude:Number(lat),longitude:Number(lon)},
    launch_datetime:buildLaunchDateTime().toISOString(),
    ascent_rate_ms:Number($('ascentRate').value),descent_rate_ms:Number($('descentRate').value),
    burst_altitude_m:Number($('burstAltitude').value),float_altitude_m:Number($('floatAltitude').value),
    float_ascent_rate_ms:Number($('floatRate').value),float_duration_min:Number($('floatDuration').value),
  };
}

function customPointTargets() {
  if(!$('customPredictEnabled').checked)return[];
  const enabled=new Set(qsa('input[data-custom-predict-site]:checked').map(x=>x.dataset.customPredictSite));
  return state.drawings.filter(d=>d.properties?.kind==='point'&&enabled.has(`custom-${d.properties.drawing_id}`)).map(d=>({
    type:'Feature',geometry:d.geometry,properties:d.properties,_id:`custom-${d.properties.drawing_id}`,_label:d.properties.name||'Custom Launch Location'
  }));
}

function allCustomPointTargets() {
  return state.drawings.filter(d=>d.properties?.kind==='point').map(d=>({
    type:'Feature',geometry:d.geometry,properties:d.properties,_id:`custom-${d.properties.drawing_id}`,_label:d.properties.name||'Custom Launch Location'
  }));
}

function setRunButton(status, detail='') {
  const btn=$('runPredicts');btn.classList.remove('running','success');
  if(status==='running')btn.classList.add('running');if(status==='success')btn.classList.add('success');
  btn.disabled=status==='running';$('runState').textContent=detail;
  if(status==='success')setTimeout(()=>{btn.classList.remove('success');$('runState').textContent='';},1100);
}

async function runPredicts() {
  if(!(await ensureAutomaticBurst()))return;
  const targets=[...selectedPresetSites(),...customPointTargets()];
  if(!targets.length){toast('Select at least one preset launch site or draw a custom point.',true);return;}
  // Keep optimal-site colors stable while the operator explores the map and edits
  // controls. A new normal predicts run is the explicit boundary that clears them.
  markReadinessStale();
  invalidateOptimalSiteAnalysis();
  state.forecastComparison=null;closeForecastPanel();
  $('siteStatusLegend')?.classList.add('hidden');
  state.predictions.clear();state.activePredictionId=null;clearPredictionMarkers();refreshPredictionSources();renderSummary();
  let completed=0,failed=0,finished=0;
  setRunButton('running',`0/${targets.length}`);
  const outcomes=await mapWithConcurrency(targets,4,async target=>{
    try{return {target,result:await api('/api/predict',{method:'POST',body:JSON.stringify(predictionBody(target))})};}
    catch(error){return {target,error};}
    finally{finished++;$('runState').textContent=`${finished}/${targets.length}`;}
  });
  for(const outcome of outcomes){
    if(outcome.error){failed++;console.error(outcome.target._label,outcome.error);continue;}
    const entry=decoratePrediction(outcome.target._id,outcome.target._label,outcome.result);
    state.predictions.set(outcome.target._id,entry);if(!state.activePredictionId)state.activePredictionId=outcome.target._id;completed++;
  }
  refreshPredictionSources();refreshMarkers();renderSummary();
  setRunButton('success',failed?`${completed} ok, ${failed} failed`:`${completed} updated`);
  if(completed){fitPredictions();toast(`${completed} prediction${completed===1?'':'s'} updated.`);}
  if(failed){const details=outcomes.filter(x=>x.error).map(x=>`${x.target._label}: ${x.error.message}`).join(' | ');toast(details,true,7000);}
}

function decoratePrediction(id,label,result) {
  const features=(result.features||[]).map(f=>({...f,properties:{...(f.properties||{}),site_id:id,site_name:label}}));
  return {...result,features,site_id:id,site_name:label};
}

function visiblePredictionEntries(){return[...state.predictions.values()].filter(p=>isSiteVisible(p.site_id));}
function visiblePredictionFeatures(){return visiblePredictionEntries().flatMap(p=>p.features||[]);}

function build3dCurtains(features) {
  const output=[];
  for(const f of features){if(f.geometry?.type!=='LineString')continue;const c=f.geometry.coordinates||[];if(c.length<2)continue;const stride=Math.max(1,Math.ceil(c.length/180));
    for(let i=0;i<c.length-1;i+=stride){const a=c[i],b=c[Math.min(i+stride,c.length-1)];const lat=(a[1]+b[1])/2;const dx=(b[0]-a[0])*111320*Math.cos(lat*Math.PI/180),dy=(b[1]-a[1])*111320;const len=Math.hypot(dx,dy)||1;const half=85;const nx=-dy/len*half,ny=dx/len*half;const cl=Math.cos(lat*Math.PI/180)||.1;const dlon=nx/(111320*cl),dlat=ny/111320;output.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[a[0]+dlon,a[1]+dlat],[b[0]+dlon,b[1]+dlat],[b[0]-dlon,b[1]-dlat],[a[0]-dlon,a[1]-dlat],[a[0]+dlon,a[1]+dlat]]]},properties:{...(f.properties||{}),altitude_m:Math.max(Number(a[2]||0),Number(b[2]||0))}});}
  }
  return{type:'FeatureCollection',features:output};
}

function predictionPointCollections() {
  const launches=[];const landings=[];
  for(const pred of visiblePredictionEntries()){
    const s=pred.summary;if(!s?.landing||!s?.launch)continue;
    launches.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(s.launch.longitude),Number(s.launch.latitude)]},properties:{site_id:pred.site_id,site_name:pred.site_name}});
    landings.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(s.landing.longitude),Number(s.landing.latitude)]},properties:{site_id:pred.site_id,site_name:pred.site_name,landing_time:s.landing_time||'',active:pred.site_id===state.activePredictionId}});
  }
  return {launches:{type:'FeatureCollection',features:launches},landings:{type:'FeatureCollection',features:landings}};
}

function refreshPredictionSources() {
  if(!map?.getSource('prediction'))return;
  const features=visiblePredictionFeatures();
  const points=predictionPointCollections();
  map.getSource('prediction').setData({type:'FeatureCollection',features});
  map.getSource('prediction-3d').setData(build3dCurtains(features));
  map.getSource('prediction-launch-points').setData(points.launches);
  map.getSource('prediction-landing-points').setData(points.landings);
  map.getSource('sweep').setData({type:'FeatureCollection',features:state.sweepFeatures});
}

// Prediction endpoints are rendered as map layers so there are no DOM marker offsets.
function clearPredictionMarkers(){}
function refreshMarkers(){refreshPredictionSources();}

function renderSummary() {
  const panel=$('predictionSummary'),list=$('summaryList');const entries=visiblePredictionEntries();
  if(state.optimalSiteAnalysis)requestAnimationFrame(showSiteStatusLegend);
  if(!entries.length){panel.classList.add('hidden');return;}panel.classList.remove('hidden');
  if(!state.activePredictionId||!entries.some(x=>x.site_id===state.activePredictionId))state.activePredictionId=entries[0].site_id;
  $('summaryTitle').textContent=entries.length===1?entries[0].site_name:`${entries.length} launch sites`;
  list.innerHTML='';
  entries.forEach(pred=>{const s=pred.summary;const btn=document.createElement('button');btn.className=`summary-row ${pred.site_id===state.activePredictionId?'active':''}`;btn.type='button';btn.innerHTML=`<div><strong>${esc(pred.site_name)}</strong><small>${esc(localTime(s?.landing_time))} · ${fmt(miles(s?.ground_distance_m),1)} mi track</small></div><div class="landing-mini">⌖ ${s?.landing?.latitude?.toFixed(3)??'—'}, ${s?.landing?.longitude?.toFixed(3)??'—'}</div>`;btn.onclick=()=>{state.activePredictionId=pred.site_id;renderSummary();refreshPredictionSources();focusPrediction(pred.site_id);};list.appendChild(btn);});
  const pred=state.predictions.get(state.activePredictionId);const s=pred?.summary;const active=$('activeSummary');
  if(!s){active.classList.add('hidden');return;}active.classList.remove('hidden');
  $('landingCoords').textContent=`${s.landing.latitude.toFixed(5)}°, ${s.landing.longitude.toFixed(5)}°`;$('landingTime').textContent=`Landing ${localTime(s.landing_time)}`;$('flightDuration').textContent=duration(s.flight_duration_s);$('maxAltitude').textContent=`${fmt(feet(s.max_altitude_m))} ft`;$('groundDistance').textContent=`${fmt(miles(s.ground_distance_m),1)} mi`;$('modelDataset').textContent=s.historical?'Historical':(s.dataset?String(s.dataset).slice(0,16):'Latest');$('modelDataset').title=s.historical_source||s.dataset||'Latest model';
  const stageList=$('stageList');stageList.innerHTML='';(s.stages||[]).forEach(st=>{const row=document.createElement('div');row.className='stage-item';row.innerHTML=`<i class="stage-dot ${esc(st.stage)}"></i><strong>${esc(st.stage[0].toUpperCase()+st.stage.slice(1))} · ${fmt(feet(st.end?.altitude_m))} ft</strong><span>${duration(st.duration_s)}</span>`;stageList.appendChild(row);});
  
}

function predictionBounds(entries=visiblePredictionEntries()) {
  const b=new maplibregl.LngLatBounds();let count=0;for(const p of entries)for(const f of p.features||[])if(f.geometry?.type==='LineString')for(const c of f.geometry.coordinates){b.extend([c[0],c[1]]);count++;}return count?b:null;
}
function fitPredictions(){const b=predictionBounds();if(!b){toast('Run a prediction first.',true);return;}map.fitBounds(b,{padding:{top:70,bottom:80,left:65,right:$('layerPanel').classList.contains('collapsed')?70:295},maxZoom:10,duration:700});}
function focusPrediction(id){const p=state.predictions.get(id);const b=predictionBounds(p?[p]:[]);if(b)map.fitBounds(b,{padding:{top:80,bottom:90,left:80,right:$('layerPanel').classList.contains('collapsed')?80:300},maxZoom:10,duration:600});}
function centerLanding(){const s=state.predictions.get(state.activePredictionId)?.summary;if(s)map.easeTo({center:[s.landing.longitude,s.landing.latitude],zoom:11,pitch:state.dimension==='3d'?45:0,duration:550});}
async function copyLanding(){const s=state.predictions.get(state.activePredictionId)?.summary;if(!s)return;await navigator.clipboard.writeText(`${s.landing.latitude.toFixed(6)}, ${s.landing.longitude.toFixed(6)}`);toast('Landing coordinates copied.');}

function exportKml() {
  const entries=visiblePredictionEntries();if(!entries.length){toast('Run a prediction first.',true);return;}
  let k='<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>BPP Predicts</name>';
  const color={ascent:'ff9d2cea',float:'ff6ba819',descent:'ff228af2'};
  for(const pred of entries){k+=`<Folder><name>${esc(pred.site_name)}</name>`;for(const f of pred.features||[]){if(f.geometry?.type!=='LineString')continue;const st=f.properties?.stage||'path';k+=`<Placemark><name>${esc(st)}</name><Style><LineStyle><color>${color[st]||'ffffffff'}</color><width>5</width></LineStyle></Style><LineString><altitudeMode>absolute</altitudeMode><coordinates>${f.geometry.coordinates.map(c=>`${c[0]},${c[1]},${c[2]||0}`).join(' ')}</coordinates></LineString></Placemark>`;}k+='</Folder>';}
  k+='</Document></kml>';downloadBlob(k,'application/vnd.google-earth.kml+xml',`BPP_predicts_${new Date().toISOString().replace(/[:.]/g,'-')}.kml`);
}
function downloadBlob(content,type,name){const blob=content instanceof Blob?content:new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

// Drawing and geofence workflow ------------------------------------------------
function drawingFeatureCollection(includePreview=true){const features=state.drawings.map(d=>({...d,properties:{...(d.properties||{}),selected:d.properties?.drawing_id===state.selectedDrawingId}}));if(includePreview&&state.rectanglePreview)features.push(state.rectanglePreview);return{type:'FeatureCollection',features};}
function refreshDrawings(){map.getSource('drawings')?.setData(drawingFeatureCollection());buildCustomPredictSiteList();refreshSweepSites();refreshForecastSites();}
function nextDrawingName(kind){const n=state.drawings.filter(x=>x.properties?.kind===kind).length+1;return kind==='point'?`Custom Launch ${n}`:`Geofence ${n}`;}
function addPointDrawing(lon,lat,name=null){const id=crypto.randomUUID?crypto.randomUUID():`p-${Date.now()}-${Math.random()}`;state.drawings.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(lon),Number(lat)]},properties:{kind:'point',drawing_id:id,name:name||nextDrawingName('point'),predict_enabled:true}});state.selectedDrawingId=id;refreshDrawings();showSelectedDrawing();setDrawMode('select');markReadinessStale();toast('Custom launch site added and enabled for predicts.');}
function rectangleBaselinePreview(a,b){return{type:'Feature',geometry:{type:'LineString',coordinates:[[a.lng,a.lat],[b.lng,b.lat]]},properties:{kind:'rectangle-guide',preview:true}};}
function rectanglePolygonFeature(a,b,c,preview=false){const g=orientedRectangle(a,b,c);return{type:'Feature',geometry:{type:'Polygon',coordinates:[g.ring]},properties:{kind:'rectangle',drawing_id:preview?'preview':(crypto.randomUUID?crypto.randomUUID():`r-${Date.now()}-${Math.random()}`),name:preview?'Rectangle preview':nextDrawingName('rectangle'),preview,baseline_length_m:g.baseline_length_m,width_m:g.width_m,area_m2:g.area_m2,upper_altitude_ft:10000,upper_altitude_m:3048}};}
function cancelRectangleDraft(message='Rectangle drawing cancelled.'){state.rectangleStart=null;state.rectangleEnd=null;state.rectanglePreview=null;refreshDrawings();if(message)toast(message);}
function setDrawMode(mode){state.drawMode=mode;state.rectangleStart=null;state.rectangleEnd=null;state.rectanglePreview=null;qsa('[data-draw-mode]').forEach(b=>b.classList.toggle('active',b.dataset.drawMode===mode));refreshDrawings();if(mode==='point')toast('Draw point: click once to create a working custom launch site.');if(mode==='rectangle')toast('Oriented rectangle: click the START of the first edge, then its END, then click to set the width.');if(mode==='select')toast('Select drawing: click a custom launch point or rectangle.');}
function handleMapDrawClick(e){
  if(!state.drawMode)return false;
  if(state.drawMode==='point'){addPointDrawing(e.lngLat.lng,e.lngLat.lat);return true;}
  if(state.drawMode==='rectangle'){
    if(!state.rectangleStart){state.rectangleStart={lng:e.lngLat.lng,lat:e.lngLat.lat};state.rectanglePreview=null;toast('Baseline started. Move in any direction and click to set its direction and length.');}
    else if(!state.rectangleEnd){const next={lng:e.lngLat.lng,lat:e.lngLat.lat};if(haversineMeters(state.rectangleStart,next)<1){toast('Make the baseline at least 1 meter long.',true);return true;}state.rectangleEnd=next;state.rectanglePreview=rectangleBaselinePreview(state.rectangleStart,state.rectangleEnd);toast('Baseline locked. Move to either side and click to set the rectangle width.');}
    else{try{const f=rectanglePolygonFeature(state.rectangleStart,state.rectangleEnd,{lng:e.lngLat.lng,lat:e.lngLat.lat},false);state.drawings.push(f);state.selectedDrawingId=f.properties.drawing_id;state.rectangleStart=null;state.rectangleEnd=null;state.rectanglePreview=null;refreshDrawings();showSelectedDrawing();setDrawMode('select');toast(`Oriented geofence created: ${fmt(f.properties.baseline_length_m)} m × ${fmt(f.properties.width_m)} m.`);}catch(err){toast(err.message,true);}}
    refreshDrawings();return true;
  }
  if(state.drawMode==='select'){const hits=map.queryRenderedFeatures(e.point,{layers:['drawing-point','drawing-fill','drawing-line']});const id=hits[0]?.properties?.drawing_id;if(id){state.selectedDrawingId=id;refreshDrawings();showSelectedDrawing();}else{state.selectedDrawingId=null;refreshDrawings();$('drawingInfo').classList.add('hidden');qs('.map-workspace')?.classList.remove('geofence-focus');$('deleteDrawing').disabled=true;}return true;}return false;
}
function handleDrawMouseMove(e){if(state.drawMode!=='rectangle'||!state.rectangleStart)return;if(!state.rectangleEnd){state.rectanglePreview=rectangleBaselinePreview(state.rectangleStart,{lng:e.lngLat.lng,lat:e.lngLat.lat});}else{try{state.rectanglePreview=rectanglePolygonFeature(state.rectangleStart,state.rectangleEnd,{lng:e.lngLat.lng,lat:e.lngLat.lat},true);}catch{state.rectanglePreview=rectangleBaselinePreview(state.rectangleStart,state.rectangleEnd);}}refreshDrawings();}
function selectedDrawing(){return state.drawings.find(d=>d.properties?.drawing_id===state.selectedDrawingId);}
function drawingCoordinateText(d){if(!d)return'';if(d.geometry.type==='Point'){const [lon,lat]=d.geometry.coordinates;return `Point:\n(${lon.toFixed(6)}, ${lat.toFixed(6)})\nEnabled for predicts: ${d.properties?.predict_enabled!==false?'yes':'no'}`;}const ring=d.geometry.coordinates?.[0]||[];const metrics=d.properties?.baseline_length_m?`\nLength: ${fmt(d.properties.baseline_length_m,1)} m\nWidth: ${fmt(d.properties.width_m,1)} m\nArea: ${fmt(d.properties.area_m2,0)} m²\n3D upper bound: ${fmt(d.properties?.upper_altitude_ft??10000,0)} ft (${fmt(d.properties?.upper_altitude_m??3048,0)} m)`:'';return 'Oriented geofence corners:\n'+ring.slice(0,-1).map(c=>`(${Number(c[0]).toFixed(6)}, ${Number(c[1]).toFixed(6)})`).join('\n')+metrics;}
function showSelectedDrawing(){const d=selectedDrawing();const workspace=qs('.map-workspace');if(!d){$('drawingInfo').classList.add('hidden');workspace?.classList.remove('geofence-focus');$('rectangleAltitudeRow')?.classList.add('hidden');$('deleteDrawing').disabled=true;return;}$('drawingInfo').classList.remove('hidden');workspace?.classList.add('geofence-focus');$('drawingInfoTitle').textContent=d.properties?.name||'Selected drawing';$('drawingCoordinates').textContent=drawingCoordinateText(d);$('drawingName').value=d.properties?.name||'';const isRect=d.properties?.kind==='rectangle'||d.geometry?.type==='Polygon';$('rectangleAltitudeRow')?.classList.toggle('hidden',!isRect);if(isRect&&$('drawingUpperAltitude'))$('drawingUpperAltitude').value=Number(d.properties?.upper_altitude_ft??10000).toFixed(0);$('deleteDrawing').disabled=false;}

function saveDrawingAltitude(){
  const d=selectedDrawing();if(!d||!(d.properties?.kind==='rectangle'||d.geometry?.type==='Polygon'))return;
  const feetValue=Number($('drawingUpperAltitude')?.value);
  if(!Number.isFinite(feetValue)||feetValue<0||feetValue>200000){toast('Enter a 3D upper bound from 0 to 200,000 ft.',true);return;}
  d.properties.upper_altitude_ft=feetValue;d.properties.upper_altitude_m=feetValue*0.3048;
  refreshDrawings();showSelectedDrawing();toast(`3D geofence upper bound set to ${fmt(feetValue)} ft.`);
}

function saveDrawingName(){const d=selectedDrawing();if(!d)return;const name=$('drawingName').value.trim();if(!name){toast('Enter a name first.',true);return;}d.properties.name=name;refreshDrawings();showSelectedDrawing();markReadinessStale();toast('Drawing name saved.');}
function deleteSelectedDrawing(){const id=state.selectedDrawingId;if(!id)return;state.drawings=state.drawings.filter(d=>d.properties?.drawing_id!==id);state.predictions.delete(`custom-${id}`);state.selectedDrawingId=null;refreshDrawings();refreshPredictionSources();refreshMarkers();renderSummary();showSelectedDrawing();markReadinessStale();}
function deleteAllDrawings(){const customIds=state.drawings.filter(d=>d.properties?.kind==='point').map(d=>`custom-${d.properties.drawing_id}`);state.drawings=[];customIds.forEach(id=>state.predictions.delete(id));state.selectedDrawingId=null;state.rectangleStart=null;state.rectangleEnd=null;state.rectanglePreview=null;refreshDrawings();refreshPredictionSources();refreshMarkers();renderSummary();showSelectedDrawing();markReadinessStale();toast('All drawings cleared.');}
function downloadDrawings(){if(!state.drawings.length){toast('No drawings to download.',true);return;}downloadBlob(JSON.stringify({type:'FeatureCollection',features:state.drawings},null,2),'application/geo+json','BPP_map_drawings.geojson');}
function downloadGeofence(){const rectangles=state.drawings.filter(d=>d.properties?.kind==='rectangle');if(!rectangles.length){toast('Draw an oriented rectangle first.',true);return;}downloadBlob(JSON.stringify({type:'FeatureCollection',features:rectangles},null,2),'application/geo+json','BPP_geofence.geojson');}
async function copyDrawing(){const d=selectedDrawing();if(!d)return;await navigator.clipboard.writeText(drawingCoordinateText(d));toast('Drawing coordinates copied.');}

// National Address Database --------------------------------------------------
async function queryAddresses(){
  if(map.getZoom()<11){toast('Zoom in to at least level 11 before querying the National Address Database.',true);return;}
  if(!checkboxForLayer('addresses').checked){checkboxForLayer('addresses').checked=true;setReferenceVisibility('addresses',true);}
  const b=map.getBounds();const params=new URLSearchParams({west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()});
  try{const r=await api(`/api/national-addresses?${params}`);map.getSource('addresses').setData(r.data||{type:'FeatureCollection',features:[]});state.referenceLoaded.add('addresses');toast(`Address query loaded ${(r.data?.features||[]).length} points.`);}catch(e){toast(e.message,true,5200);}
}

// Parameter sweep ------------------------------------------------------------
function refreshSweepSites(){const select=$('sweepSite');if(!select)return;const current=select.value;select.innerHTML='';for(const s of state.launchLocations){const o=document.createElement('option');o.value=s._id;o.textContent=s._label;select.appendChild(o);}for(const d of state.drawings.filter(x=>x.properties?.kind==='point')){const o=document.createElement('option');o.value=`custom-${d.properties.drawing_id}`;o.textContent=d.properties.name||'Custom Launch';select.appendChild(o);}if([...select.options].some(o=>o.value===current))select.value=current;}
function findSweepTarget(id){if(id.startsWith('custom-')){const did=id.slice(7),d=state.drawings.find(x=>x.properties?.drawing_id===did);return d?{...d,_id:id,_label:d.properties.name}:null;}return state.launchLocations.find(x=>x._id===id)||null;}
async function runSweep(){const target=findSweepTarget($('sweepSite').value);if(!target){toast('Choose a launch site for the sweep.',true);return;}if(!(await ensureAutomaticBurst()))return;const lower=Number($('sweepLower').value),upper=Number($('sweepUpper').value),step=Number($('sweepStep').value);if(!Number.isFinite(lower)||!Number.isFinite(upper)||!Number.isFinite(step)||step<=0||lower>upper){toast('Invalid sweep bounds.',true);return;}const values=[];for(let v=lower;v<=upper+step*1e-6;v+=step){values.push(Number(v.toFixed(6)));if(values.length>20){toast('Sweep is limited to 20 predictions at a time.',true);return;}}state.sweepFeatures=[];$('sweepProgress').textContent=`Running 0/${values.length}…`;
  const param=$('sweepParameter').value;let done=0;
  const outcomes=await mapWithConcurrency(values,4,async value=>{const body=predictionBody(target);if(param==='altitude'){if(state.predictType==='burst')body.burst_altitude_m=value;else body.float_altitude_m=value;}else body[param]=value;try{return {value,result:await api('/api/predict',{method:'POST',body:JSON.stringify(body)})};}catch(error){console.warn('sweep',value,error);return {value,error};}finally{done++;$('sweepProgress').textContent=`Running ${done}/${values.length}…`;}});
  const failures=outcomes.filter(x=>x.error);for(const outcome of outcomes.filter(x=>!x.error)){for(const f of outcome.result.features||[])state.sweepFeatures.push({...f,properties:{...(f.properties||{}),sweep_value:outcome.value,sweep_parameter:param}});}refreshPredictionSources();
  $('sweepProgress').textContent=`Finished ${values.length-failures.length}/${values.length} sweep predictions. Dashed lines are sweep results.`;toast(failures.length?`Parameter sweep completed with ${failures.length} failure${failures.length===1?'':'s'}.`:'Parameter sweep complete.',Boolean(failures.length),5200);
}
function clearSweep(){state.sweepFeatures=[];refreshPredictionSources();$('sweepProgress').textContent='Sweep results cleared.';}


const LAUNCH_THEME_PRESETS={
  standard:{primary:'#d71920',secondary:'#ffd200',accent:'#6f2da8'},
  maryland:{primary:'#e21833',secondary:'#ffd200',accent:'#111111'},
  night:{primary:'#5b78ff',secondary:'#b6c4ff',accent:'#7b4ce0'},
  aurora:{primary:'#16b889',secondary:'#7ee8c8',accent:'#8b5cf6'},
  country:{primary:'#b58b4c',secondary:'#ddc28f',accent:'#8e6b39'},
  summer:{primary:'#087fbd',secondary:'#edcf81',accent:'#ffd34f'},
  pride:{primary:'#e40303',secondary:'#ffed00',accent:'#750787'},
};
function applyLaunchTheme(name='standard',persist=true){
  const key=Object.prototype.hasOwnProperty.call(LAUNCH_THEME_PRESETS,name)?name:'standard';
  const preset=LAUNCH_THEME_PRESETS[key];state.launchTheme=key;
  document.documentElement.style.setProperty('--launch-primary',preset.primary);
  document.documentElement.style.setProperty('--launch-secondary',preset.secondary);
  document.documentElement.style.setProperty('--launch-accent',preset.accent);
  document.documentElement.dataset.launchTheme=key;
  if($('launchThemeSelect'))$('launchThemeSelect').value=key;
  if(persist)localStorage.setItem('bpp-launch-theme-preset',key);
}
function restoreLaunchTheme(){applyLaunchTheme(localStorage.getItem('bpp-launch-theme-preset')||'standard',false);}

function preferredTheme(){
  const saved=localStorage.getItem('bpp-predicts-theme');
  if(saved==='dark'||saved==='light')return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
}
function applyTheme(theme,persist=true){
  state.theme=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=state.theme;
  const icon=$('themeIcon'),label=$('themeLabel'),button=$('themeToggle');
  if(icon)icon.textContent=state.theme==='dark'?'☀':'☾';
  if(label)label.textContent=state.theme==='dark'?'Light':'Dark';
  if(button)button.setAttribute('aria-label',`Switch to ${state.theme==='dark'?'light':'dark'} mode`);
  const meta=qs('meta[name="theme-color"]');if(meta)meta.setAttribute('content',state.theme==='dark'?'#0b0f15':'#050505');
  if(map?.loaded?.()){
    if(state.theme==='dark'&&state.basemap!=='dark'){state.lightBasemap=state.basemap;setBasemap('dark');const r=qs('input[name="basemap"][value="dark"]');if(r)r.checked=true;}
    else if(state.theme==='light'&&state.basemap==='dark'){const target=state.lightBasemap||'topo';setBasemap(target);const r=qs(`input[name="basemap"][value="${target}"]`);if(r)r.checked=true;}
  }
  if(persist)localStorage.setItem('bpp-predicts-theme',state.theme);
}
function toggleTheme(){applyTheme(state.theme==='dark'?'light':'dark');}

function wireControls(){
  $('themeToggle')?.addEventListener('click',toggleTheme);
  $('launchThemeSelect')?.addEventListener('change',e=>{applyLaunchTheme(e.target.value);toast(`${e.target.options[e.target.selectedIndex].text} launch theme applied.`);});
  $('predictsTab').addEventListener('click',()=>setAppView('predicts'));$('safetyRulesTab')?.addEventListener('click',()=>setAppView('safety'));$('readinessTab')?.addEventListener('click',()=>setAppView('readiness'));$('inflationTab').addEventListener('click',()=>setAppView('inflation'));$('infoTab')?.addEventListener('click',()=>setAppView('info'));
  $('saveSafetyRules')?.addEventListener('click',saveSafetyRules);$('resetSafetyRules')?.addEventListener('click',resetSafetyRules);
  $('refreshReadiness')?.addEventListener('click',refreshReadiness);$('readinessSort')?.addEventListener('change',e=>{state.readinessSort=e.target.value;renderReadiness();});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(!$('launchTimePopover')?.classList.contains('hidden')){toggleLaunchTimePopover(false);return;}if(!$('forecastPanel')?.classList.contains('hidden')){closeForecastPanel();return;}if(!$('sweepPanel')?.classList.contains('hidden')){$('sweepPanel').classList.add('hidden');return;}if(state.drawMode==='rectangle'&&(state.rectangleStart||state.rectangleEnd)){cancelRectangleDraft();}});
  $('launchTimeButton')?.addEventListener('click',e=>{e.stopPropagation();toggleLaunchTimePopover();});
  $('launchTimePopover')?.addEventListener('click',e=>e.stopPropagation());
  document.addEventListener('click',()=>toggleLaunchTimePopover(false));
  $('predictType').addEventListener('change',e=>{setPredictionType(e.target.value);markReadinessStale();});
  $('burstAltitudeMode').addEventListener('change',e=>{setBurstAltitudeMode(e.target.value);markReadinessStale();});
  $('burstAltitude').addEventListener('input',()=>{if(state.burstAltitudeMode==='manual')state.manualBurstAltitude=Number($('burstAltitude').value);updateAltitudeLabels();markReadinessStale();});$('floatAltitude').addEventListener('input',()=>{updateAltitudeLabels();markReadinessStale();});
  $('ascentRate').addEventListener('input',()=>{$('inflationAscentRate').value=$('ascentRate').value;scheduleInflationCalculation();markReadinessStale();});
  $('inflationAscentRate').addEventListener('input',()=>{$('ascentRate').value=$('inflationAscentRate').value;scheduleInflationCalculation();});
  ['inflationPressure','inflationTemperature','inflationBalloonMass','inflationPayloadMass'].forEach(id=>$(id).addEventListener('input',scheduleInflationCalculation));
  ['launchDate','launchTime','launchTimezone','descentRate','floatRate','floatDuration'].forEach(id=>$(id)?.addEventListener('change',()=>{if(id==='launchTime'||id==='launchTimezone')updateLaunchTimeControl();if(['launchDate','launchTime','launchTimezone'].includes(id)&&state.mapMode==='weather')refreshWeatherMap();markReadinessStale();}));
  $('inflationForm').addEventListener('submit',e=>{e.preventDefault();calculateInflation(false).catch(()=>{});});$('useInflationBurst').addEventListener('click',()=>{setBurstAltitudeMode('auto');setAppView('predicts');toast('Automatic burst altitude enabled from Inflation Calculator.');});
  $('runPredicts').addEventListener('click',runPredicts);$('optimalAscentSweep').addEventListener('change',()=>{updateOptimalSweepLabel();markReadinessStale();});$('findOptimalCurrent').addEventListener('click',()=>findOptimalSite('current'));$('findOptimalAll').addEventListener('click',()=>findOptimalSite('all'));
  qsa('input[name="mapmode"]').forEach(x=>x.addEventListener('change',()=>setMapMode(x.value)));
  qsa('input[name="basemap"]').forEach(x=>x.addEventListener('change',()=>{if(x.value!=='dark')state.lightBasemap=x.value;setBasemap(x.value);}));qsa('input[name="dimension"]').forEach(x=>x.addEventListener('change',()=>setDimension(x.value)));
  qsa('input[data-layer]').forEach(x=>x.addEventListener('change',async()=>{const key=x.dataset.layer;if(['controlled','class_e','sua','tfr'].includes(key)){if(x.checked)await loadAirspace(key);syncAirspaceVisibility();markReadinessStale();}else setReferenceVisibility(key,x.checked);}));
  $('customPredictEnabled').addEventListener('change',()=>{refreshPredictionSources();refreshMarkers();renderSummary();markReadinessStale();});
  $('clearPredictSites')?.addEventListener('click',clearPredictSites);
  $('collapseLayers').addEventListener('click',()=>{$('layerPanel').classList.add('collapsed');$('reopenLayers').classList.remove('hidden');});$('reopenLayers').addEventListener('click',()=>{$('layerPanel').classList.remove('collapsed');$('reopenLayers').classList.add('hidden');});
  $('drawingToggle').addEventListener('click',()=>{$('drawingMenu').classList.toggle('hidden');$('drawingToggle').classList.toggle('active',!$('drawingMenu').classList.contains('hidden'));});qsa('[data-draw-mode]').forEach(b=>b.addEventListener('click',()=>setDrawMode(b.dataset.drawMode)));$('deleteDrawing').addEventListener('click',deleteSelectedDrawing);$('deleteAllDrawings').addEventListener('click',deleteAllDrawings);$('downloadDrawings').addEventListener('click',downloadDrawings);$('closeDrawingInfo').addEventListener('click',()=>{$('drawingInfo').classList.add('hidden');qs('.map-workspace')?.classList.remove('geofence-focus');});$('copyDrawingCoordinates').addEventListener('click',copyDrawing);$('saveDrawingName').addEventListener('click',saveDrawingName);$('saveDrawingAltitude')?.addEventListener('click',saveDrawingAltitude);
  $('zoomPredicts').addEventListener('click',fitPredictions);$('downloadKml').addEventListener('click',exportKml);$('downloadGeofence').addEventListener('click',downloadGeofence);$('queryAddresses').addEventListener('click',queryAddresses);$('aboutMap').addEventListener('click',()=>setAppView('info'));
  $('openForecastAnalysis')?.addEventListener('click',openForecastPanel);$('closeForecastPanel')?.addEventListener('click',closeForecastPanel);$('refreshForecastComparison')?.addEventListener('click',loadForecastComparison);$('forecastSite')?.addEventListener('change',loadForecastComparison);
  $('refreshFaaData')?.addEventListener('click',()=>refreshFaaData(true));
  $('openSweep').addEventListener('click',()=>{refreshSweepSites();$('sweepPanel').classList.toggle('hidden');});$('closeSweepPanel')?.addEventListener('click',()=>$('sweepPanel').classList.add('hidden'));$('runSweep').addEventListener('click',runSweep);$('clearSweep').addEventListener('click',clearSweep);
  $('closeSummary').addEventListener('click',()=>$('predictionSummary').classList.add('hidden'));$('centerLanding').addEventListener('click',centerLanding);$('copyLanding').addEventListener('click',copyLanding);

  qsa('.layer-group').forEach((group,index)=>{
    const heading=qs('h3',group);if(!heading)return;
    heading.tabIndex=0;heading.setAttribute('role','button');heading.setAttribute('aria-expanded',String(!group.classList.contains('collapsed')));
    const toggle=()=>{group.classList.toggle('collapsed');heading.setAttribute('aria-expanded',String(!group.classList.contains('collapsed')));};
    heading.addEventListener('click',toggle);heading.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
  });
}

function setDefaultDate(){const now=new Date();const tomorrow=new Date(now.getTime()+24*3600*1000);const todayValue=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');$('launchDate').min=todayValue;$('launchDate').value=[tomorrow.getFullYear(),String(tomorrow.getMonth()+1).padStart(2,'0'),String(tomorrow.getDate()).padStart(2,'0')].join('-');}

async function init() {
  restoreLaunchTheme();
  applyTheme(preferredTheme(),false);
  if($('buildBadge'))$('buildBadge').textContent=`v${BUILD_VERSION}`;
  setDefaultDate();restoreSafetyRules();wireControls();updateLaunchTimeControl();updateOptimalSweepLabel();setAppView('predicts');setPredictionType('burst');setBurstAltitudeMode('auto');
  await calculateInflation(true).catch(()=>{});
  try{state.config=await api('/api/config');}catch(e){console.warn(e);}
  map=new maplibregl.Map({container:'map',style:baseStyle(),center:[-77.4,39.4],zoom:8,minZoom:2,maxZoom:18,attributionControl:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'MapLibre'}),'bottom-right');map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true}),'bottom-right');map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-left');map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
  map.on('load',async()=>{addOperationalLayers();if(state.theme==='dark'){state.lightBasemap='topo';setBasemap('dark');const r=qs('input[name="basemap"][value="dark"]');if(r)r.checked=true;}await Promise.all([loadAirspace('controlled'),loadAirspace('sua'),loadAirspace('tfr'),loadLaunchLocations()]);syncAirspaceVisibility();await refreshFaaData(false);state.faaStatusTimer=setInterval(()=>refreshFaaData(false),60000);});
  map.on('click',e=>handleMapDrawClick(e));map.on('mousemove',handleDrawMouseMove);
}

init();
