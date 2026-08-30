const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const BUILD_VERSION = '2.3.0';
const COLORS = { ascent: '#ea2c9d', float: '#19a86b', descent: '#f28a22' };
const DEFAULT_CALLSIGNS = ['KC3SKW-8', 'KC3SKW-9', 'KC3SKW-10'];
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
  liveMarkers: new Map(),
  liveHistory: [],
  liveCallsigns: [...DEFAULT_CALLSIGNS],
  liveTimer: null,
  livePredictTimer: null,
  referenceLoaded: new Set(),
  airspaceLoaded: new Set(),
  drawings: [],
  drawMode: null,
  selectedDrawingId: null,
  rectangleStart: null,
  rectanglePreview: null,
  addressRequest: null,
};

let map;

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
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
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

function feet(m) { return Number(m || 0) * 3.28084; }
function miles(m) { return Number(m || 0) / 1609.344; }
function fmt(value, digits = 0) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
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

function parseLiveCallsigns() {
  const raw = $('callsign')?.value || '';
  const maxCount = Number(state.config?.max_live_callsigns || 8);
  const tokens = raw.split(/[,;\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean);
  const callsigns = [...new Set(tokens)];
  if (!callsigns.length) throw new Error('Enter at least one APRS callsign.');
  const invalid = callsigns.find(x=>!/^[A-Z0-9][A-Z0-9-]{0,14}$/.test(x));
  if (invalid) throw new Error(`Invalid APRS callsign: ${invalid}`);
  if (callsigns.length > maxCount) throw new Error(`Live tracking is limited to ${maxCount} callsigns at a time.`);
  state.liveCallsigns = callsigns;
  return callsigns;
}

function packetAgeText(point) {
  if (!point?.time) return 'latest';
  const age = Math.max(0, Math.round(Date.now()/1000 - point.time));
  return age < 60 ? `${age}s` : `${Math.round(age/60)} min`;
}

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
  ['prediction', 'prediction-3d', 'prediction-launch-points', 'prediction-landing-points', 'sweep', 'live-track', 'drawings', 'addresses',
   'airspace-controlled', 'airspace-uncontrolled', 'airspace-tfr',
   'ref-schools', 'ref-mcdonalds', 'ref-dunkin', 'ref-launch_locations', 'ref-poi'].forEach(addSource);

  // Airspace stays useful but visually secondary to the flight path.
  map.addLayer({ id:'airspace-controlled-fill', type:'fill', source:'airspace-controlled', layout:{visibility:'visible'}, paint:{
    'fill-color':['match',['get','LOCAL_TYPE'],'R','#ef3340','CLASS_B','#1264d8','CLASS_C','#7b3fb2','CLASS_D','#1264d8','#718096'],
    'fill-opacity':.12,
  }});
  map.addLayer({ id:'airspace-controlled-line', type:'line', source:'airspace-controlled', layout:{visibility:'visible'}, paint:{
    'line-color':['match',['get','LOCAL_TYPE'],'R','#d5192f','CLASS_B','#0d58bd','CLASS_C','#6f329f','CLASS_D','#0d58bd','#5f6874'],
    'line-width':['interpolate',['linear'],['zoom'],5,.7,10,1.25], 'line-opacity':.72,
  }});
  map.addLayer({ id:'airspace-uncontrolled-fill', type:'fill', source:'airspace-uncontrolled', layout:{visibility:'none'}, paint:{'fill-color':'#6f1e51','fill-opacity':.10} });
  map.addLayer({ id:'airspace-uncontrolled-line', type:'line', source:'airspace-uncontrolled', layout:{visibility:'none'}, paint:{'line-color':'#6f1e51','line-width':.9,'line-opacity':.55} });
  map.addLayer({ id:'airspace-tfr-fill', type:'fill', source:'airspace-tfr', layout:{visibility:'visible'}, paint:{'fill-color':'#7f11e0','fill-opacity':.16} });
  map.addLayer({ id:'airspace-tfr-line', type:'line', source:'airspace-tfr', layout:{visibility:'visible'}, paint:{'line-color':'#6f08c6','line-width':1.3,'line-opacity':.85} });

  map.addLayer({ id:'airspace-controlled-3d', type:'fill-extrusion', source:'airspace-controlled', layout:{visibility:'none'}, paint:{
    'fill-extrusion-color':['match',['get','LOCAL_TYPE'],'R','#ef3340','CLASS_B','#1264d8','CLASS_C','#7b3fb2','CLASS_D','#1264d8','#718096'],
    'fill-extrusion-opacity':.15,
    'fill-extrusion-base':['*',['to-number',['get','LOWER_VAL'],0],0.3048],
    'fill-extrusion-height':['*',['to-number',['get','UPPER_VAL'],0],0.3048],
  }});
  map.addLayer({ id:'airspace-uncontrolled-3d', type:'fill-extrusion', source:'airspace-uncontrolled', layout:{visibility:'none'}, paint:{
    'fill-extrusion-color':'#6f1e51','fill-extrusion-opacity':.12,
    'fill-extrusion-base':['*',['to-number',['get','LOWER_VAL'],0],0.3048],
    'fill-extrusion-height':['*',['to-number',['get','UPPER_VAL'],0],0.3048],
  }});

  // Reference layers from the existing BPP data files.
  map.addLayer({id:'ref-schools-layer',type:'circle',source:'ref-schools',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#24b82e','circle-opacity':.84,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-mcdonalds-layer',type:'circle',source:'ref-mcdonalds',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#ffc72c','circle-opacity':.9,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-dunkin-layer',type:'circle',source:'ref-dunkin',layout:{visibility:'none'},paint:{'circle-radius':4,'circle-color':'#da1884','circle-opacity':.88,'circle-stroke-width':1,'circle-stroke-color':'#111'}});
  map.addLayer({id:'ref-launch_locations-layer',type:'circle',source:'ref-launch_locations',layout:{visibility:'none'},paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':4,'circle-stroke-color':'#0059ff'}});
  map.addLayer({id:'ref-poi-layer',type:'circle',source:'ref-poi',layout:{visibility:'none'},paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':4,'circle-stroke-color':'#e21f26'}});
  map.addLayer({id:'addresses-layer',type:'circle',source:'addresses',layout:{visibility:'none'},minzoom:11,paint:{'circle-radius':3,'circle-color':'#0084ff','circle-opacity':.7,'circle-stroke-width':.5,'circle-stroke-color':'#fff'}});

  // Drawings.
  map.addLayer({id:'drawing-fill',type:'fill',source:'drawings',filter:['==',['geometry-type'],'Polygon'],paint:{'fill-color':['case',['boolean',['get','selected'],false],'#f2b84b','#9254d6'],'fill-opacity':['case',['boolean',['get','preview'],false],.12,.18]}});
  map.addLayer({id:'drawing-line',type:'line',source:'drawings',filter:['==',['geometry-type'],'Polygon'],paint:{'line-color':['case',['boolean',['get','selected'],false],'#b86e00','#7626c5'],'line-width':['case',['boolean',['get','selected'],false],3,2]}});
  map.addLayer({id:'drawing-point',type:'circle',source:'drawings',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['case',['boolean',['get','selected'],false],7,6],'circle-color':'#9254d6','circle-stroke-width':2,'circle-stroke-color':'#fff'}});

  // Parameter sweep is deliberately quieter than the primary trajectories.
  map.addLayer({id:'sweep-lines',type:'line',source:'sweep',paint:{'line-color':['match',['get','stage'],'ascent',COLORS.ascent,'float',COLORS.float,'descent',COLORS.descent,'#777'],'line-width':2,'line-opacity':.38,'line-dasharray':[2,2]}});

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

  map.addLayer({id:'live-track-line',type:'line',source:'live-track',paint:{'line-color':'#111820','line-width':3,'line-opacity':.85,'line-dasharray':[1.2,1.2]}});

  registerFeaturePopups();
}

function registerFeaturePopups() {
  const simpleLayers = [
    ['ref-mcdonalds-layer','McDonald\'s'],['ref-dunkin-layer','Dunkin\''],['ref-launch_locations-layer','Launch Location'],['ref-poi-layer','Point of Interest'],['addresses-layer','Address']
  ];
  simpleLayers.forEach(([layer, title]) => {
    map.on('click', layer, (e) => {
      const f = e.features?.[0]; if (!f) return;
      const props = f.properties || {};
      const useful = Object.entries(props).filter(([k,v]) => v != null && String(v).trim() && !['fid'].includes(k)).slice(0,8);
      const body = useful.map(([k,v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('');
      new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`<strong>${title}</strong>${body}`).addTo(map);
    });
  });
  map.on('click','ref-schools-layer',(e)=>{
    const f=e.features?.[0]; if(!f)return;
    const props=f.properties||{}; const coord=e.lngLat;
    const wrap=document.createElement('div');
    wrap.innerHTML=`<strong>${esc(props.NAME || props.name || 'Public School')}</strong><div style="font-size:10px;margin-top:4px">${esc(props.STREET || props.address || '')} ${esc(props.CITY || '')}</div>`;
    const btn=document.createElement('button');btn.textContent='Create predict point here';btn.style.marginTop='7px';btn.onclick=()=>{addPointDrawing(coord.lng,coord.lat,props.NAME||'School launch');popup.remove();};wrap.appendChild(btn);
    const popup=new maplibregl.Popup().setLngLat(coord).setDOMContent(wrap).addTo(map);
  });
  map.on('click','prediction-lines',(e)=>{
    const id=e.features?.[0]?.properties?.site_id;if(id&&state.predictions.has(id)){state.activePredictionId=id;renderSummary();refreshPredictionSources();}
  });
  map.on('click','prediction-landing-points-layer',(e)=>{
    const f=e.features?.[0];if(!f)return;
    const id=f.properties?.site_id;if(id&&state.predictions.has(id)){state.activePredictionId=id;renderSummary();refreshPredictionSources();}
    const coords=f.geometry?.coordinates||[e.lngLat.lng,e.lngLat.lat];
    const landingTime=f.properties?.landing_time||'';
    new maplibregl.Popup({offset:12}).setLngLat(coords.slice(0,2)).setHTML(`<strong>${esc(f.properties?.site_name||'Predicted landing')}</strong><br>${Number(coords[1]).toFixed(5)}, ${Number(coords[0]).toFixed(5)}${landingTime?`<br>${esc(localTime(landingTime))}`:''}`).addTo(map);
  });
  ['prediction-lines','prediction-landing-points-layer'].forEach(layer=>{
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
  syncAirspaceVisibility();
}

function checkboxForLayer(key) { return qs(`input[data-layer="${key}"]`); }
function layerChecked(key) { return !!checkboxForLayer(key)?.checked; }

function syncAirspaceVisibility() {
  const is3d = state.dimension === '3d';
  for (const key of ['controlled','uncontrolled']) {
    const visible = layerChecked(key);
    for (const suffix of ['fill','line']) {
      const id=`airspace-${key}-${suffix}`; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible&&!is3d?'visible':'none');
    }
    const id3=`airspace-${key}-3d`; if(map.getLayer(id3)) map.setLayoutProperty(id3,'visibility',visible&&is3d?'visible':'none');
  }
  for (const suffix of ['fill','line']) { const id=`airspace-tfr-${suffix}`; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',layerChecked('tfr')?'visible':'none'); }
}

async function loadAirspace(key) {
  if (state.airspaceLoaded.has(key)) return;
  try {
    const r = await api(`/api/airspace/${key}`);
    map.getSource(`airspace-${key}`).setData(r.data);
    state.airspaceLoaded.add(key);
    if (r.warning) toast(`${key} airspace: ${r.warning}`, true, 5200);
  } catch (e) { toast(`Could not load ${key} airspace: ${e.message}`, true, 5200); }
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
  const id=REFERENCE_LAYER_IDS[key]; if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible?'visible':'none');
  if (visible) loadReference(key);
}

function deriveSiteLabel(feature, idx) {
  const p=feature.properties||{}; const address=String(p.address||'').trim();
  if(address){const parts=address.split(',').map(x=>x.trim()).filter(Boolean); if(parts.length>=3)return parts[1]; if(parts.length)return parts[0];}
  return p.city || p.name || `Launch ${idx+1}`;
}

async function loadLaunchLocations() {
  const r = await api('/api/launch-locations');
  const features = r.data?.features || [];
  const seen = new Map();
  state.launchLocations = features.map((f,idx)=>{
    let label=deriveSiteLabel(f,idx); const n=(seen.get(label)||0)+1;seen.set(label,n);if(n>1)label=`${label} ${n}`;
    return {...f,_id:`preset-${slug(label)}-${idx}`,_label:label};
  });
  buildPredictSiteList();
  map.getSource('ref-launch_locations')?.setData({type:'FeatureCollection',features});
  state.referenceLoaded.add('launch_locations');
  if(r.warning) toast(`Launch locations: ${r.warning}. Run git lfs pull from the repository root.`,true,6000);
}

function buildPredictSiteList() {
  const root=$('predictSiteList');root.innerHTML='';
  state.launchLocations.forEach((site,idx)=>{
    const label=document.createElement('label');label.className='predict-site';
    const span=document.createElement('span');span.textContent=site._label;span.title=site.properties?.address||site.properties?.name||site._label;
    const input=document.createElement('input');input.type='checkbox';input.dataset.predictSite=site._id;input.checked=idx<5;
    input.addEventListener('change',()=>{refreshPredictionSources();renderSummary();refreshMarkers();});
    label.append(span,input);root.appendChild(label);
  });
  if(!state.launchLocations.length)root.innerHTML='<p class="loading-text">No launch locations available.</p>';
  refreshSweepSites();
}

function selectedPresetSites() {
  const checked=new Set(qsa('input[data-predict-site]:checked').map(x=>x.dataset.predictSite));
  return state.launchLocations.filter(s=>checked.has(s._id));
}
function isSiteVisible(id){const input=qs(`input[data-predict-site="${CSS.escape(id)}"]`);if(input)return input.checked;if(id.startsWith('custom-'))return $('customPredictEnabled').checked;return true;}

function setPredictionType(type) {
  state.predictType = type;
  qsa('.burst-control').forEach(el=>el.classList.toggle('hidden',type!=='burst'));
  qsa('.float-control').forEach(el=>el.classList.toggle('hidden',type!=='float'));
  $('predictType').value=type;
  updateAltitudeLabels();
}
function updateAltitudeLabels(){ $('burstFeet').textContent=`${fmt(feet($('burstAltitude').value))} ft`; $('floatFeet').textContent=`${fmt(feet($('floatAltitude').value))} ft`; }

function setWorkspaceMode(mode) {
  state.workspaceMode=mode;
  qsa('.predict-only').forEach(el=>el.classList.toggle('hidden',mode!=='predict'));
  qsa('.live-only').forEach(el=>el.classList.toggle('hidden',mode!=='live'));
  $('liveStatus').classList.toggle('hidden',mode!=='live');
  $('runPredicts').querySelector('.run-label').textContent=mode==='live'?'Run Live Predict':'Run Predicts';
  if(mode==='live')refreshLive(true);
  scheduleLive();
}

function buildLaunchDateTime() {
  const date=$('launchDate').value,time=$('launchTime').value||'10:00';
  if(!date)throw new Error('Choose a launch date');
  const zone=$('launchTimezone').value;
  const d=new Date(`${date}T${time}:00${zone==='utc'?'Z':''}`);
  if(Number.isNaN(d.getTime()))throw new Error('Invalid launch date/time');
  return d;
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
  if(state.workspaceMode==='live'){await runLivePrediction(false);return;}
  const targets=[...selectedPresetSites(),...customPointTargets()];
  if(!targets.length){toast('Select at least one preset launch site or draw a custom point.',true);return;}
  state.predictions.clear();state.activePredictionId=null;clearPredictionMarkers();refreshPredictionSources();renderSummary();
  let completed=0,failed=0;
  setRunButton('running',`0/${targets.length}`);
  for(const target of targets){
    try{
      const result=await api('/api/predict',{method:'POST',body:JSON.stringify(predictionBody(target))});
      const entry=decoratePrediction(target._id,target._label,result);
      state.predictions.set(target._id,entry);if(!state.activePredictionId)state.activePredictionId=target._id;
      completed++;refreshPredictionSources();refreshMarkers();renderSummary();
    }catch(e){failed++;console.error(target._label,e);toast(`${target._label}: ${e.message}`,true,5200);}
    $('runState').textContent=`${completed+failed}/${targets.length}`;
  }
  setRunButton('success',failed?`${completed} ok, ${failed} failed`:`${completed} updated`);
  if(completed){fitPredictions();toast(`${completed} prediction${completed===1?'':'s'} updated.`);}
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
  if(!entries.length){panel.classList.add('hidden');return;}panel.classList.remove('hidden');
  if(!state.activePredictionId||!entries.some(x=>x.site_id===state.activePredictionId))state.activePredictionId=entries[0].site_id;
  $('summaryTitle').textContent=entries.length===1?entries[0].site_name:`${entries.length} launch sites`;
  list.innerHTML='';
  entries.forEach(pred=>{const s=pred.summary;const btn=document.createElement('button');btn.className=`summary-row ${pred.site_id===state.activePredictionId?'active':''}`;btn.type='button';const liveStart=pred.live?.used_altitude_m!=null?`Start ${fmt(feet(pred.live.used_altitude_m))} ft · `:'';btn.innerHTML=`<div><strong>${esc(pred.site_name)}</strong><small>${esc(liveStart)}${esc(localTime(s?.landing_time))} · ${fmt(miles(s?.ground_distance_m),1)} mi track</small></div><div class="landing-mini">⌖ ${s?.landing?.latitude?.toFixed(3)??'—'}, ${s?.landing?.longitude?.toFixed(3)??'—'}</div>`;btn.onclick=()=>{state.activePredictionId=pred.site_id;renderSummary();refreshPredictionSources();focusPrediction(pred.site_id);};list.appendChild(btn);});
  const pred=state.predictions.get(state.activePredictionId);const s=pred?.summary;const active=$('activeSummary');
  if(!s){active.classList.add('hidden');return;}active.classList.remove('hidden');
  $('landingCoords').textContent=`${s.landing.latitude.toFixed(5)}°, ${s.landing.longitude.toFixed(5)}°`;$('landingTime').textContent=`Landing ${localTime(s.landing_time)}`;$('flightDuration').textContent=duration(s.flight_duration_s);$('maxAltitude').textContent=`${fmt(feet(s.max_altitude_m))} ft`;$('groundDistance').textContent=`${fmt(miles(s.ground_distance_m),1)} mi`;$('modelDataset').textContent=s.dataset?String(s.dataset).slice(0,16):'Latest';
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
function refreshDrawings(){map.getSource('drawings')?.setData(drawingFeatureCollection());refreshSweepSites();}
function nextDrawingName(kind){const n=state.drawings.filter(x=>x.properties?.kind===kind).length+1;return kind==='point'?`Custom Launch ${n}`:`Geofence ${n}`;}
function addPointDrawing(lon,lat,name=null){const id=crypto.randomUUID?crypto.randomUUID():`p-${Date.now()}-${Math.random()}`;state.drawings.push({type:'Feature',geometry:{type:'Point',coordinates:[Number(lon),Number(lat)]},properties:{kind:'point',drawing_id:id,name:name||nextDrawingName('point')}});state.selectedDrawingId=id;refreshDrawings();showSelectedDrawing();toast('Custom launch point added. It will run when Custom Launch Location is checked.');}
function rectangleFeature(a,b,preview=false){const west=Math.min(a.lng,b.lng),east=Math.max(a.lng,b.lng),south=Math.min(a.lat,b.lat),north=Math.max(a.lat,b.lat);return{type:'Feature',geometry:{type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]},properties:{kind:'rectangle',drawing_id:preview?'preview':(crypto.randomUUID?crypto.randomUUID():`r-${Date.now()}-${Math.random()}`),name:preview?'Rectangle preview':nextDrawingName('rectangle'),preview}};}
function setDrawMode(mode){state.drawMode=mode;state.rectangleStart=null;state.rectanglePreview=null;qsa('[data-draw-mode]').forEach(b=>b.classList.toggle('active',b.dataset.drawMode===mode));refreshDrawings();if(mode==='point')toast('Draw point: click the map to add a custom launch location.');if(mode==='rectangle')toast('Draw rectangle: click two opposite corners of the geofence.');if(mode==='select')toast('Select drawing: click a point or rectangle.');}
function handleMapDrawClick(e){if(!state.drawMode)return false;if(state.drawMode==='point'){addPointDrawing(e.lngLat.lng,e.lngLat.lat);return true;}if(state.drawMode==='rectangle'){if(!state.rectangleStart){state.rectangleStart=e.lngLat;toast('Now click the opposite corner.');}else{const f=rectangleFeature(state.rectangleStart,e.lngLat,false);state.drawings.push(f);state.selectedDrawingId=f.properties.drawing_id;state.rectangleStart=null;state.rectanglePreview=null;refreshDrawings();showSelectedDrawing();toast('Geofence rectangle created.');}return true;}if(state.drawMode==='select'){const hits=map.queryRenderedFeatures(e.point,{layers:['drawing-point','drawing-fill','drawing-line']});const id=hits[0]?.properties?.drawing_id;if(id){state.selectedDrawingId=id;refreshDrawings();showSelectedDrawing();}else{state.selectedDrawingId=null;refreshDrawings();$('drawingInfo').classList.add('hidden');$('deleteDrawing').disabled=true;}return true;}return false;}
function handleDrawMouseMove(e){if(state.drawMode==='rectangle'&&state.rectangleStart){state.rectanglePreview=rectangleFeature(state.rectangleStart,e.lngLat,true);refreshDrawings();}}
function selectedDrawing(){return state.drawings.find(d=>d.properties?.drawing_id===state.selectedDrawingId);}
function drawingCoordinateText(d){if(!d)return'';if(d.geometry.type==='Point'){const [lon,lat]=d.geometry.coordinates;return `Point:\n(${lon.toFixed(6)}, ${lat.toFixed(6)})`;}const ring=d.geometry.coordinates?.[0]||[];return 'Geofence corners:\n'+ring.slice(0,-1).map(c=>`(${Number(c[0]).toFixed(6)}, ${Number(c[1]).toFixed(6)})`).join('\n');}
function showSelectedDrawing(){const d=selectedDrawing();if(!d){$('drawingInfo').classList.add('hidden');$('deleteDrawing').disabled=true;return;}$('drawingInfo').classList.remove('hidden');$('drawingInfoTitle').textContent=d.properties?.name||'Selected drawing';$('drawingCoordinates').textContent=drawingCoordinateText(d);$('deleteDrawing').disabled=false;}
function deleteSelectedDrawing(){const id=state.selectedDrawingId;if(!id)return;state.drawings=state.drawings.filter(d=>d.properties?.drawing_id!==id);state.predictions.delete(`custom-${id}`);state.selectedDrawingId=null;refreshDrawings();refreshPredictionSources();refreshMarkers();renderSummary();showSelectedDrawing();}
function deleteAllDrawings(){const customIds=state.drawings.filter(d=>d.properties?.kind==='point').map(d=>`custom-${d.properties.drawing_id}`);state.drawings=[];customIds.forEach(id=>state.predictions.delete(id));state.selectedDrawingId=null;state.rectangleStart=null;state.rectanglePreview=null;refreshDrawings();refreshPredictionSources();refreshMarkers();renderSummary();showSelectedDrawing();toast('All drawings cleared.');}
function downloadDrawings(){if(!state.drawings.length){toast('No drawings to download.',true);return;}downloadBlob(JSON.stringify({type:'FeatureCollection',features:state.drawings},null,2),'application/geo+json','BPP_map_drawings.geojson');}
function downloadGeofence(){const rectangles=state.drawings.filter(d=>d.properties?.kind==='rectangle');if(!rectangles.length){toast('Draw a rectangle first.',true);return;}downloadBlob(JSON.stringify({type:'FeatureCollection',features:rectangles},null,2),'application/geo+json','BPP_geofence.geojson');}
async function copyDrawing(){const d=selectedDrawing();if(!d)return;await navigator.clipboard.writeText(drawingCoordinateText(d));toast('Drawing coordinates copied.');}

// National Address Database --------------------------------------------------
async function queryAddresses(){
  if(map.getZoom()<11){toast('Zoom in to at least level 11 before querying the National Address Database.',true);return;}
  if(!checkboxForLayer('addresses').checked){checkboxForLayer('addresses').checked=true;setReferenceVisibility('addresses',true);}
  const b=map.getBounds();const params=new URLSearchParams({west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()});
  try{const r=await api(`/api/national-addresses?${params}`);map.getSource('addresses').setData(r.data||{type:'FeatureCollection',features:[]});state.referenceLoaded.add('addresses');toast(`Address query loaded ${(r.data?.features||[]).length} points.`);}catch(e){toast(e.message,true,5200);}
}

// Live APRS ------------------------------------------------------------------
function scheduleLive(){clearInterval(state.liveTimer);clearInterval(state.livePredictTimer);if(state.workspaceMode!=='live')return;if($('autoRefresh').checked)state.liveTimer=setInterval(()=>refreshLive(false),30000);if($('autoRepredict').checked)state.livePredictTimer=setInterval(()=>runLivePrediction(true),120000);}

async function refreshLive(center=false){
  if(!state.config?.aprs_configured){$('liveAge').textContent='API key needed';return;}
  let callsigns;
  try{callsigns=parseLiveCallsigns();}catch(e){toast(e.message,true,5200);$('liveAge').textContent='Check callsigns';return;}
  $('liveCallsign').textContent=callsigns.length===1?callsigns[0]:`${callsigns.length} callsigns`;
  try{
    const params=new URLSearchParams({callsigns:callsigns.join(',')});
    const r=await api(`/api/live?${params}`);
    renderLiveMarkers(r,new Set(callsigns));
    renderLiveStations(r,callsigns,center);
  }catch(e){toast(e.message,true,5200);$('liveAge').textContent='Unavailable';}
}

function renderLiveMarkers(r,selected){
  for(const m of state.liveMarkers.values())m.remove();state.liveMarkers.clear();
  for(const [cs,p] of Object.entries(r.stations||{})){
    const el=document.createElement('div');el.className=`live-marker ${selected.has(cs)?'':'secondary'}`;
    const altitude=p.altitude_m==null?'No altitude':`${fmt(feet(p.altitude_m))} ft`;
    const popup=new maplibregl.Popup({offset:15}).setHTML(`<strong>${esc(cs)}</strong><br>${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}<br>${altitude}<br><a href="https://aprs.fi/${encodeURIComponent(cs)}" target="_blank" rel="noopener">Open on aprs.fi</a>`);
    state.liveMarkers.set(cs,new maplibregl.Marker({element:el}).setLngLat([p.longitude,p.latitude]).setPopup(popup).addTo(map));
  }
}

function renderLiveStations(r,callsigns,center){
  const list=$('liveStationList');list.innerHTML='';
  const trackFeatures=[];
  let primary=null;
  for(const cs of callsigns){
    const p=r.stations?.[cs];const phase=r.phase?.[cs]||'unknown';const history=r.history?.[cs]||[];
    if(p&&!primary)primary={p,phase,history};
    const row=document.createElement('button');row.type='button';row.className=`live-station-row ${p?'':'missing'}`;
    const altitude=p?.altitude_m==null?'No altitude':`${fmt(feet(p.altitude_m))} ft`;
    const detail=p?`${packetAgeText(p)} · ${String(phase).replace(/^./,x=>x.toUpperCase())}`:'No recent APRS packet';
    row.innerHTML=`<strong>${esc(cs)}</strong><span>${esc(altitude)}</span><small>${esc(detail)}</small>`;
    if(p)row.onclick=()=>{renderLiveStation(p,phase,history,true,false);};
    list.appendChild(row);
    const coords=history.filter(x=>Number.isFinite(x.longitude)&&Number.isFinite(x.latitude)).map(x=>[x.longitude,x.latitude]);
    if(coords.length>1)trackFeatures.push({type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{callsign:cs}});
  }
  map.getSource('live-track').setData({type:'FeatureCollection',features:trackFeatures});
  if(primary)renderLiveStation(primary.p,primary.phase,primary.history,center,false);
  else{$('liveAge').textContent='No recent packet';$('liveAltitude').textContent='—';$('liveSpeed').textContent='—';$('livePhaseValue').textContent='—';$('liveCoords').textContent='—';}
}

function renderLiveStation(p,phase,history,center,updateTrack=true){
  $('liveAge').textContent=packetAgeText(p);
  $('liveAltitude').textContent=p.altitude_m==null?'—':`${fmt(feet(p.altitude_m))} ft`;
  $('liveSpeed').textContent=p.speed_kmh==null?'—':`${fmt(p.speed_kmh*.621371)} mph`;
  $('livePhaseValue').textContent=String(phase).replace(/^./,x=>x.toUpperCase());
  $('liveCoords').textContent=`${p.callsign} · ${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;
  const coords=(history||[]).filter(x=>Number.isFinite(x.longitude)&&Number.isFinite(x.latitude)).map(x=>[x.longitude,x.latitude]);state.liveHistory=coords;
  if(updateTrack)map.getSource('live-track').setData({type:'FeatureCollection',features:coords.length>1?[{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{callsign:p.callsign}}]:[]});
  if(center)map.easeTo({center:[p.longitude,p.latitude],zoom:9,duration:600});
}

async function runLivePrediction(silent=false){
  if(!state.config?.aprs_configured){if(!silent)toast('Add APRSFI_API_KEY to predicts/modern/.env to use live tracking.',true,5500);return;}
  let callsigns;try{callsigns=parseLiveCallsigns();}catch(e){if(!silent)toast(e.message,true,5200);return;}
  if(!silent)setRunButton('running',`0/${callsigns.length}`);
  const body={callsigns,mode:state.predictType,phase:$('livePhase').value,ascent_rate_ms:Number($('ascentRate').value),descent_rate_ms:Number($('descentRate').value),burst_altitude_m:Number($('burstAltitude').value),float_altitude_m:Number($('floatAltitude').value),float_ascent_rate_ms:Number($('floatRate').value),float_duration_min:Number($('floatDuration').value)};
  try{
    const batch=await api('/api/live/predict-batch',{method:'POST',body:JSON.stringify(body)});
    state.predictions.clear();state.activePredictionId=null;
    for(const cs of callsigns){const result=batch.results?.[cs];if(!result)continue;const id=`live-${cs}`;state.predictions.set(id,decoratePrediction(id,`${cs} live`,result));if(!state.activePredictionId)state.activePredictionId=id;}
    refreshPredictionSources();refreshMarkers();renderSummary();
    const completed=state.predictions.size;const failures=Object.keys(batch.errors||{});
    if(completed)fitPredictions();
    if(!silent){
      setRunButton(completed?'success':'idle',failures.length?`${completed} ok, ${failures.length} failed`:`${completed} updated`);
      if(completed)toast(`${completed} live prediction${completed===1?'':'s'} started from APRS latitude, longitude, and altitude.`);
      if(failures.length)toast(failures.map(cs=>`${cs}: ${batch.errors[cs]}`).join(' | '),true,7000);
    }
    if(!completed&&silent)console.warn('No live predictions succeeded',batch.errors);
  }catch(e){if(!silent){setRunButton('idle','');toast(e.message,true,5500);}else console.warn(e);}
}

// Parameter sweep ------------------------------------------------------------
function refreshSweepSites(){const select=$('sweepSite');if(!select)return;const current=select.value;select.innerHTML='';for(const s of state.launchLocations){const o=document.createElement('option');o.value=s._id;o.textContent=s._label;select.appendChild(o);}for(const d of state.drawings.filter(x=>x.properties?.kind==='point')){const o=document.createElement('option');o.value=`custom-${d.properties.drawing_id}`;o.textContent=d.properties.name||'Custom Launch';select.appendChild(o);}if([...select.options].some(o=>o.value===current))select.value=current;}
function findSweepTarget(id){if(id.startsWith('custom-')){const did=id.slice(7),d=state.drawings.find(x=>x.properties?.drawing_id===did);return d?{...d,_id:id,_label:d.properties.name}:null;}return state.launchLocations.find(x=>x._id===id)||null;}
async function runSweep(){const target=findSweepTarget($('sweepSite').value);if(!target){toast('Choose a launch site for the sweep.',true);return;}const lower=Number($('sweepLower').value),upper=Number($('sweepUpper').value),step=Number($('sweepStep').value);if(!Number.isFinite(lower)||!Number.isFinite(upper)||!Number.isFinite(step)||step<=0||lower>upper){toast('Invalid sweep bounds.',true);return;}const values=[];for(let v=lower;v<=upper+step*1e-6;v+=step){values.push(Number(v.toFixed(6)));if(values.length>20){toast('Sweep is limited to 20 predictions at a time.',true);return;}}state.sweepFeatures=[];$('sweepProgress').textContent=`Running 0/${values.length}…`;
  let done=0;for(const value of values){const body=predictionBody(target);const param=$('sweepParameter').value;if(param==='altitude'){if(state.predictType==='burst')body.burst_altitude_m=value;else body.float_altitude_m=value;}else body[param]=value;try{const r=await api('/api/predict',{method:'POST',body:JSON.stringify(body)});for(const f of r.features||[])state.sweepFeatures.push({...f,properties:{...(f.properties||{}),sweep_value:value,sweep_parameter:param}});}catch(e){console.warn('sweep',value,e);}done++;$('sweepProgress').textContent=`Running ${done}/${values.length}…`;refreshPredictionSources();}
  $('sweepProgress').textContent=`Finished ${values.length} sweep predictions. Dashed lines are sweep results.`;toast('Parameter sweep complete.');
}
function clearSweep(){state.sweepFeatures=[];refreshPredictionSources();$('sweepProgress').textContent='Sweep results cleared.';}

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
  $('workspaceMode').addEventListener('change',e=>setWorkspaceMode(e.target.value));
  $('predictType').addEventListener('change',e=>setPredictionType(e.target.value));
  ['burstAltitude','floatAltitude'].forEach(id=>$(id).addEventListener('input',updateAltitudeLabels));
  $('runPredicts').addEventListener('click',runPredicts);$('refreshLive').addEventListener('click',()=>refreshLive(true));$('callsign').addEventListener('change',()=>refreshLive(true));$('callsign').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();refreshLive(true);}});$('autoRefresh').addEventListener('change',scheduleLive);$('autoRepredict').addEventListener('change',scheduleLive);
  qsa('input[name="basemap"]').forEach(x=>x.addEventListener('change',()=>{if(x.value!=='dark')state.lightBasemap=x.value;setBasemap(x.value);}));qsa('input[name="dimension"]').forEach(x=>x.addEventListener('change',()=>setDimension(x.value)));
  qsa('input[data-layer]').forEach(x=>x.addEventListener('change',async()=>{const key=x.dataset.layer;if(['controlled','uncontrolled','tfr'].includes(key)){if(x.checked)await loadAirspace(key);syncAirspaceVisibility();}else setReferenceVisibility(key,x.checked);}));
  $('customPredictEnabled').addEventListener('change',()=>{refreshPredictionSources();refreshMarkers();renderSummary();});
  $('collapseLayers').addEventListener('click',()=>{$('layerPanel').classList.add('collapsed');$('reopenLayers').classList.remove('hidden');});$('reopenLayers').addEventListener('click',()=>{$('layerPanel').classList.remove('collapsed');$('reopenLayers').classList.add('hidden');});
  $('drawingToggle').addEventListener('click',()=>{$('drawingMenu').classList.toggle('hidden');$('drawingToggle').classList.toggle('active',!$('drawingMenu').classList.contains('hidden'));});qsa('[data-draw-mode]').forEach(b=>b.addEventListener('click',()=>setDrawMode(b.dataset.drawMode)));$('deleteDrawing').addEventListener('click',deleteSelectedDrawing);$('deleteAllDrawings').addEventListener('click',deleteAllDrawings);$('downloadDrawings').addEventListener('click',downloadDrawings);$('closeDrawingInfo').addEventListener('click',()=>{$('drawingInfo').classList.add('hidden');});$('copyDrawingCoordinates').addEventListener('click',copyDrawing);
  $('zoomPredicts').addEventListener('click',fitPredictions);$('downloadKml').addEventListener('click',exportKml);$('downloadGeofence').addEventListener('click',downloadGeofence);$('queryAddresses').addEventListener('click',queryAddresses);$('aboutMap').addEventListener('click',()=>$('aboutDialog').showModal());
  $('openSweep').addEventListener('click',()=>{refreshSweepSites();$('sweepDialog').showModal();});$('runSweep').addEventListener('click',runSweep);$('clearSweep').addEventListener('click',clearSweep);
  $('closeSummary').addEventListener('click',()=>$('predictionSummary').classList.add('hidden'));$('centerLanding').addEventListener('click',centerLanding);$('copyLanding').addEventListener('click',copyLanding);
}

function setDefaultDate(){const now=new Date();const tomorrow=new Date(now.getTime()+24*3600*1000);$('launchDate').value=[tomorrow.getFullYear(),String(tomorrow.getMonth()+1).padStart(2,'0'),String(tomorrow.getDate()).padStart(2,'0')].join('-');}

async function init() {
  applyTheme(preferredTheme(),false);
  if($('buildBadge'))$('buildBadge').textContent=`v${BUILD_VERSION}`;
  setDefaultDate();wireControls();setPredictionType('burst');setWorkspaceMode('predict');
  try{state.config=await api('/api/config');if(Array.isArray(state.config.default_callsigns)&&state.config.default_callsigns.length)$('callsign').value=state.config.default_callsigns.join(', ');if(!state.config.aprs_configured)$('liveAge').textContent='API key needed';}catch(e){console.warn(e);}
  map=new maplibregl.Map({container:'map',style:baseStyle(),center:[-77.4,39.4],zoom:8,minZoom:2,maxZoom:18,attributionControl:false});
  map.addControl(new maplibregl.AttributionControl({compact:true,customAttribution:'MapLibre'}),'bottom-right');map.addControl(new maplibregl.NavigationControl({visualizePitch:true}),'bottom-right');map.addControl(new maplibregl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true}),'bottom-right');map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-left');map.addControl(new maplibregl.ScaleControl({unit:'metric'}),'bottom-left');
  map.on('load',async()=>{addOperationalLayers();if(state.theme==='dark'){state.lightBasemap='topo';setBasemap('dark');const r=qs('input[name="basemap"][value="dark"]');if(r)r.checked=true;}await Promise.all([loadAirspace('controlled'),loadAirspace('tfr')]);syncAirspaceVisibility();await loadLaunchLocations();});
  map.on('click',e=>handleMapDrawClick(e));map.on('mousemove',handleDrawMouseMove);
}

init();
