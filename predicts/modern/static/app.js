const $ = (id) => document.getElementById(id);
const APP_BASE = window.location.pathname === '/' ? '' : window.location.pathname.replace(/\/$/, '');
const appUrl = (path) => `${APP_BASE}${path}`;
const state = {
  view: 'predict', mode: 'burst', liveMode: 'burst', prediction: null,
  launchLocations: [], landingMarker: null, launchMarker: null, liveMarker: null,
  liveTimer: null, livePredictTimer: null, lastLivePredictAt: 0, liveMarkers: {},
  airspaceLoaded: new Set(), aprsConfigured: false,
};

function toast(message, error=false) {
  const el = $('toast'); el.textContent = message; el.classList.remove('hidden','error');
  if (error) el.classList.add('error');
  clearTimeout(toast._t); toast._t = setTimeout(()=>el.classList.add('hidden'), 4300);
}
function fmtNumber(v, d=0){ return Number(v).toLocaleString(undefined,{maximumFractionDigits:d}); }
function feet(m){ return m * 3.28084; }
function miles(m){ return m / 1609.344; }
function duration(s){ if(s==null)return '—'; const h=Math.floor(s/3600),m=Math.round((s%3600)/60); return h?`${h}h ${m}m`:`${m}m`; }
function localTime(iso){ if(!iso)return '—'; return new Date(iso).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
function mapStyle(){return {version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-0.32,'raster-contrast':0.08,'raster-brightness-max':0.82}}]};}

const map = new maplibregl.Map({container:'map',style:mapStyle(),center:[-77.7,39.45],zoom:7,pitch:0,bearing:0,maxPitch:70});
map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({unit:'imperial'}),'bottom-left');

map.on('load', async () => {
  addPredictionLayers(); addLiveLayers(); await loadAirspace();
});

function addPredictionLayers(){
  if(map.getSource('prediction')) return;
  map.addSource('prediction',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addSource('prediction-3d',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addSource('prediction-waypoints',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'prediction-3d-curtain',type:'fill-extrusion',source:'prediction-3d',layout:{visibility:'none'},paint:{'fill-extrusion-color':['match',['get','stage'],'ascent','#ef2d7a','float','#20c997','descent','#ff8a24','#ffffff'],'fill-extrusion-height':['get','altitude_m'],'fill-extrusion-base':0,'fill-extrusion-opacity':.42}});
  map.addLayer({id:'prediction-casing',type:'line',source:'prediction',filter:['==',['geometry-type'],'LineString'],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'rgba(8,12,16,.95)','line-width':['interpolate',['linear'],['zoom'],5,7,10,10],'line-opacity':.9}});
  map.addLayer({id:'prediction-line',type:'line',source:'prediction',filter:['==',['geometry-type'],'LineString'],layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':['match',['get','stage'],'ascent','#ef2d7a','float','#20c997','descent','#ff8a24','#ffffff'],'line-width':['interpolate',['linear'],['zoom'],5,4,10,6],'line-opacity':1}});
  map.addLayer({id:'prediction-waypoints-hit',type:'circle',source:'prediction-waypoints',paint:{'circle-radius':9,'circle-opacity':0,'circle-stroke-opacity':0}});
  const hoverPopup = new maplibregl.Popup({closeButton:false,closeOnClick:false,offset:10});
  map.on('mouseenter','prediction-waypoints-hit',e=>{map.getCanvas().style.cursor='crosshair';const p=e.features?.[0]?.properties||{};hoverPopup.setLngLat(e.features[0].geometry.coordinates).setHTML(`<strong>${String(p.stage||'Path').replace(/^./,c=>c.toUpperCase())}</strong><br>${fmtNumber(feet(Number(p.altitude_m||0)))} ft<br>${p.time?localTime(p.time):''}`).addTo(map);});
  map.on('mouseleave','prediction-waypoints-hit',()=>{map.getCanvas().style.cursor='';hoverPopup.remove();});
}
function addLiveLayers(){
  if(map.getSource('live-track'))return;
  map.addSource('live-track',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'live-track-casing',type:'line',source:'live-track',paint:{'line-color':'#0b1117','line-width':7,'line-opacity':.8},layout:{'line-join':'round','line-cap':'round'}});
  map.addLayer({id:'live-track-line',type:'line',source:'live-track',paint:{'line-color':'#ffd200','line-width':3.5,'line-opacity':.95},layout:{'line-join':'round','line-cap':'round'}});
}

async function api(url, opts={}){
  const r=await fetch(appUrl(url),{headers:{'Content-Type':'application/json'},...opts});
  let data=null; try{data=await r.json();}catch{}
  if(!r.ok) throw new Error(data?.detail || `${r.status} ${r.statusText}`); return data;
}
async function init(){
  setDefaultTime(); updateAltitudeLabels();
  try{ const h=await api('/api/health'); $('apiStatus').classList.add('ok'); state.aprsConfigured=Boolean(h.aprs_configured); if(!state.aprsConfigured){$('liveAge').textContent='Add APRSFI_API_KEY to .env';$('runLivePredict').disabled=true;$('autoRefresh').checked=false;$('autoRepredict').checked=false;} }
  catch(e){ $('apiStatus').classList.add('bad'); toast(`Local API: ${e.message}`,true); }
  await loadLaunchLocations();
  setupEvents();
}
function setDefaultTime(){ const now=new Date(Date.now()+60*60*1000); $('launchDate').value=now.toISOString().slice(0,10); $('launchTime').value=now.toTimeString().slice(0,5); }
function updateAltitudeLabels(){ $('burstFeet').textContent=`${fmtNumber(feet($('burstAltitude').value))} ft`; $('floatFeet').textContent=`${fmtNumber(feet($('floatAltitude').value))} ft`; }
async function loadLaunchLocations(){
  try{
    const r=await api('/api/launch-locations'); const features=r.data?.features||[]; state.launchLocations=features;
    const select=$('launchSite'); select.innerHTML='';
    for(const [i,f] of features.entries()){
      const p=f.properties||{}; const opt=document.createElement('option'); opt.value=String(i); opt.textContent=p.name || p.address || `Launch ${i+1}`; select.appendChild(opt);
    }
    const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom coordinates';select.appendChild(custom);
    if(features.length){ applyLaunchFeature(features[0]); }
    if(r.warning){console.info(r.warning);toast('Using fallback launch coordinate — run git lfs pull for the full BPP launch-site list');}
  }catch(e){toast(`Launch sites: ${e.message}`,true);}
}
function applyLaunchFeature(f){ const c=f.geometry?.coordinates;if(!c)return; $('longitude').value=Number(c[0]).toFixed(6);$('latitude').value=Number(c[1]).toFixed(6); map.easeTo({center:[c[0],c[1]],zoom:7}); }

function setupEvents(){
  document.querySelectorAll('.nav-tab').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  document.querySelectorAll('[data-live-mode]').forEach(b=>b.addEventListener('click',()=>setLiveMode(b.dataset.liveMode)));
  $('launchSite').addEventListener('change',e=>{ if(e.target.value!=='custom')applyLaunchFeature(state.launchLocations[Number(e.target.value)]); });
  $('latitude').addEventListener('change',()=>{$('launchSite').value='custom';}); $('longitude').addEventListener('change',()=>{$('launchSite').value='custom';});
  $('burstAltitude').addEventListener('input',updateAltitudeLabels); $('floatAltitude').addEventListener('input',updateAltitudeLabels);
  $('predictForm').addEventListener('submit',runPrediction); $('runLivePredict').addEventListener('click',()=>runLivePrediction(false));
  $('callsign').addEventListener('change',()=>refreshLive(true)); $('autoRefresh').addEventListener('change',scheduleLive);
  $('autoRepredict').addEventListener('change',scheduleLive);
  $('fitPrediction').addEventListener('click',fitPrediction); $('centerLanding').addEventListener('click',centerLanding); $('copyLanding').addEventListener('click',copyLanding); $('exportKml').addEventListener('click',exportKml);
  $('summaryClose').addEventListener('click',()=>$('summaryCard').classList.add('hidden'));
  $('airspaceToggle').addEventListener('click',()=>$('airspacePanel').classList.toggle('hidden')); $('closeAirspace').addEventListener('click',()=>$('airspacePanel').classList.add('hidden'));
  document.querySelectorAll('[data-airspace]').forEach(x=>x.addEventListener('change',()=>setAirspaceVisibility(x.dataset.airspace,x.checked)));
  $('map2d').addEventListener('click',()=>set3d(false));$('map3d').addEventListener('click',()=>set3d(true));
  $('helpToggle').addEventListener('click',()=>$('helpDialog').showModal());$('helpClose').addEventListener('click',()=>$('helpDialog').close());
}
function switchView(view){ state.view=view; document.querySelectorAll('.nav-tab').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); document.querySelectorAll('.view-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===view)); if(view==='live'){if(state.aprsConfigured){refreshLive(true);scheduleLive();}else{toast('Live tracking needs APRSFI_API_KEY in predicts/modern/.env');}}else{clearInterval(state.liveTimer);clearInterval(state.livePredictTimer);} }
function setMode(mode){state.mode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('burstFields').classList.toggle('hidden',mode!=='burst');$('floatFields').classList.toggle('hidden',mode!=='float');}
function setLiveMode(mode){state.liveMode=mode;document.querySelectorAll('[data-live-mode]').forEach(b=>b.classList.toggle('active',b.dataset.liveMode===mode));$('liveFloatFields').classList.toggle('hidden',mode!=='float');}
function set3d(on){ $('map2d').classList.toggle('active',!on);$('map3d').classList.toggle('active',on);if(map.getLayer('prediction-3d-curtain'))map.setLayoutProperty('prediction-3d-curtain','visibility',on?'visible':'none');map.easeTo({pitch:on?58:0,bearing:on?-12:0,duration:650}); }

function launchDateTime(){ const s=`${$('launchDate').value}T${$('launchTime').value}`; return new Date(s).toISOString(); }
function predictBody(){return {mode:state.mode,launch:{name:$('launchSite').selectedOptions[0]?.textContent||'Custom launch',latitude:Number($('latitude').value),longitude:Number($('longitude').value)},launch_datetime:launchDateTime(),ascent_rate_ms:Number($('ascentRate').value),descent_rate_ms:Number($('descentRate').value),burst_altitude_m:Number($('burstAltitude').value),float_altitude_m:Number($('floatAltitude').value),float_ascent_rate_ms:Number($('floatRate').value),float_duration_min:Number($('floatDuration').value)};}
async function runPrediction(e){e.preventDefault();const btn=$('runPredict');btn.disabled=true;btn.querySelector('span').textContent='Calculating…';try{const result=await api('/api/predict',{method:'POST',body:JSON.stringify(predictBody())});displayPrediction(result);toast('Prediction complete');}catch(err){toast(err.message,true);}finally{btn.disabled=false;btn.querySelector('span').textContent='Run prediction';}}
function build3dCurtains(features){
  const out=[]; const halfWidthM=70;
  for(const f of features||[]){ if(f.geometry?.type!=='LineString')continue; const c=f.geometry.coordinates||[];
    for(let i=0;i<c.length-1;i++){ const a=c[i],b=c[i+1];const lat=(a[1]+b[1])/2;const dx=(b[0]-a[0])*111320*Math.cos(lat*Math.PI/180);const dy=(b[1]-a[1])*111320;const len=Math.hypot(dx,dy);if(len<1)continue;const nx=-dy/len*halfWidthM,ny=dx/len*halfWidthM;const dlon=nx/(111320*Math.cos(lat*Math.PI/180)||1),dlat=ny/111320;out.push({type:'Feature',geometry:{type:'Polygon',coordinates:[[[a[0]+dlon,a[1]+dlat],[b[0]+dlon,b[1]+dlat],[b[0]-dlon,b[1]-dlat],[a[0]-dlon,a[1]-dlat],[a[0]+dlon,a[1]+dlat]]]},properties:{stage:f.properties?.stage||'path',altitude_m:Math.max(Number(a[2]||0),Number(b[2]||0))}});}
  } return {type:'FeatureCollection',features:out};
}
function buildWaypoints(features){ const out=[]; for(const f of features||[]){if(f.geometry?.type!=='LineString')continue;const coords=f.geometry.coordinates||[],times=f.properties?.timestamps||[];const step=Math.max(1,Math.ceil(coords.length/35));for(let i=0;i<coords.length;i+=step){out.push({type:'Feature',geometry:{type:'Point',coordinates:[coords[i][0],coords[i][1]]},properties:{stage:f.properties?.stage||'path',altitude_m:Number(coords[i][2]||0),time:times[i]||null}});}if(coords.length&&((coords.length-1)%step)!==0){const i=coords.length-1;out.push({type:'Feature',geometry:{type:'Point',coordinates:[coords[i][0],coords[i][1]]},properties:{stage:f.properties?.stage||'path',altitude_m:Number(coords[i][2]||0),time:times[i]||null}});}}return {type:'FeatureCollection',features:out};}
function displayPrediction(result){ state.prediction=result; const features=result.features||[]; if(map.getSource('prediction'))map.getSource('prediction').setData({type:'FeatureCollection',features});if(map.getSource('prediction-3d'))map.getSource('prediction-3d').setData(build3dCurtains(features));if(map.getSource('prediction-waypoints'))map.getSource('prediction-waypoints').setData(buildWaypoints(features)); drawMarkers(result.summary); renderSummary(result.summary); fitPrediction(); }
function drawMarkers(summary){ if(state.launchMarker)state.launchMarker.remove();if(state.landingMarker)state.landingMarker.remove(); const launchEl=document.createElement('div');launchEl.className='launch-marker'; state.launchMarker=new maplibregl.Marker({element:launchEl}).setLngLat([summary.launch.longitude,summary.launch.latitude]).addTo(map); const landEl=document.createElement('div');landEl.className='landing-marker';state.landingMarker=new maplibregl.Marker({element:landEl,anchor:'center'}).setLngLat([summary.landing.longitude,summary.landing.latitude]).setPopup(new maplibregl.Popup({offset:18}).setHTML(`<strong>Predicted landing</strong><br>${summary.landing.latitude.toFixed(5)}, ${summary.landing.longitude.toFixed(5)}<br>${localTime(summary.landing_time)}`)).addTo(map); }
function renderSummary(s){$('summaryCard').classList.remove('hidden');$('landingCoords').textContent=`${s.landing.latitude.toFixed(5)}°, ${s.landing.longitude.toFixed(5)}°`;$('landingTime').textContent=`Landing ${localTime(s.landing_time)}`;$('flightDuration').textContent=duration(s.flight_duration_s);$('maxAltitude').textContent=`${fmtNumber(feet(s.max_altitude_m))} ft`;$('groundDistance').textContent=`${fmtNumber(miles(s.ground_distance_m),1)} mi`;$('modelDataset').textContent=s.dataset?String(s.dataset).slice(0,10):'Latest';const note=$('approximationNote');note.textContent=s.approximation||'';note.classList.toggle('hidden',!s.approximation);const list=$('stageList');list.innerHTML='';(s.stages||[]).forEach(st=>{const row=document.createElement('div');row.className='stage-item';const label=st.stage[0].toUpperCase()+st.stage.slice(1);const endAlt=fmtNumber(feet(st.end?.altitude_m||0));row.innerHTML=`<i class="stage-dot ${st.stage}"></i><strong>${label} · ${endAlt} ft</strong><span>${duration(st.duration_s)}</span>`;list.appendChild(row);});}
function fitPrediction(){if(!state.prediction?.features?.length)return;const b=new maplibregl.LngLatBounds();state.prediction.features.forEach(f=>(f.geometry?.coordinates||[]).forEach(c=>b.extend([c[0],c[1]])));if(!b.isEmpty())map.fitBounds(b,{padding:{top:80,bottom:80,left:60,right:420},maxZoom:10,duration:800});}
function centerLanding(){const l=state.prediction?.summary?.landing;if(l)map.easeTo({center:[l.longitude,l.latitude],zoom:11,pitch:0,duration:650});}
async function copyLanding(){const l=state.prediction?.summary?.landing;if(!l)return;await navigator.clipboard.writeText(`${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`);toast('Landing coordinates copied');}
function exportKml(){ if(!state.prediction?.features?.length){toast('Run a prediction first',true);return;} let k='<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>BPP Prediction</name>';const colors={ascent:'ff7a2def',float:'ff97c920',descent:'ff248aff'};for(const f of state.prediction.features){if(f.geometry?.type!=='LineString')continue;const st=f.properties?.stage||'path';k+=`<Style id="${st}"><LineStyle><color>${colors[st]||'ffffffff'}</color><width>4</width></LineStyle></Style><Placemark><name>${st}</name><styleUrl>#${st}</styleUrl><LineString><altitudeMode>absolute</altitudeMode><coordinates>`;k+=f.geometry.coordinates.map(c=>`${c[0]},${c[1]},${c[2]||0}`).join(' ');k+='</coordinates></LineString></Placemark>';}k+='</Document></kml>';const blob=new Blob([k],{type:'application/vnd.google-earth.kml+xml'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`bpp-predict-${Date.now()}.kml`;a.click();URL.revokeObjectURL(a.href);}

async function loadAirspace(){let warnings=0;await Promise.all(['controlled','special','tfr'].map(async key=>{try{const r=await api(`/api/airspace/${key}`);const source=`airspace-${key}`;map.addSource(source,{type:'geojson',data:r.data});const cfg={controlled:{fill:'#3b82d8',outline:'#63a9f1',opacity:.10},special:{fill:'#d94e69',outline:'#eb7088',opacity:.09},tfr:{fill:'#ff4d35',outline:'#ff6a55',opacity:.16}}[key];map.addLayer({id:`${source}-fill`,type:'fill',source,paint:{'fill-color':cfg.fill,'fill-opacity':cfg.opacity}});map.addLayer({id:`${source}-line`,type:'line',source,paint:{'line-color':cfg.outline,'line-opacity':.52,'line-width':['interpolate',['linear'],['zoom'],5,.8,10,1.4]}});state.airspaceLoaded.add(key);if(r.warning){warnings++;console.info(r.warning);}}catch(e){warnings++;console.warn(`Airspace ${key}:`,e);}}));if(warnings)toast('Some airspace layers are unavailable. Run git lfs pull from the repository root.');}
function setAirspaceVisibility(key,visible){for(const suffix of ['fill','line']){const id=`airspace-${key}-${suffix}`;if(map.getLayer(id))map.setLayoutProperty(id,'visibility',visible?'visible':'none');}}

function scheduleLive(){clearInterval(state.liveTimer);clearInterval(state.livePredictTimer);if(state.view!=='live')return;if($('autoRefresh').checked)state.liveTimer=setInterval(()=>refreshLive(false),30000);if($('autoRepredict').checked)state.livePredictTimer=setInterval(()=>runLivePrediction(true),120000);}
async function refreshLive(center=false){if(!state.aprsConfigured)return;const cs=$('callsign').value;$('liveCallsign').textContent=cs;try{const r=await api('/api/live');const p=r.stations?.[cs];if(!p){$('liveAge').textContent='No recent APRS position';renderAllLiveMarkers(r,cs);return;}renderAllLiveMarkers(r,cs);renderSelectedLive({station:p,phase:r.phase?.[cs]||'unknown',history:r.history?.[cs]||[]},center);}catch(e){$('liveAge').textContent='Unavailable';toast(e.message,true);}}
function renderAllLiveMarkers(r,selected){for(const marker of Object.values(state.liveMarkers))marker.remove();state.liveMarkers={};for(const [cs,p] of Object.entries(r.stations||{})){const el=document.createElement('div');el.className=`live-marker ${cs===selected?'selected':'secondary'}`;el.title=cs;state.liveMarkers[cs]=new maplibregl.Marker({element:el}).setLngLat([p.longitude,p.latitude]).setPopup(new maplibregl.Popup({offset:16}).setHTML(`<strong>${cs}</strong><br>${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}<br>${p.altitude_m==null?'':fmtNumber(feet(p.altitude_m))+' ft'}<br><a href="https://aprs.fi/${cs}" target="_blank" rel="noopener">Open on aprs.fi</a>`)).addTo(map);}}
function renderSelectedLive(r,center){const p=r.station;const age=p.time?Math.max(0,Math.round(Date.now()/1000-p.time)):null;$('liveAge').textContent=age==null?'Latest position':age<60?`${age}s ago`:`${Math.round(age/60)} min ago`;$('liveAltitude').textContent=p.altitude_m==null?'—':`${fmtNumber(feet(p.altitude_m))} ft`;$('liveSpeed').textContent=p.speed_kmh==null?'—':`${fmtNumber(p.speed_kmh*.621371)} mph`;$('livePhase').textContent=(r.phase||'unknown').replace(/^./,x=>x.toUpperCase());$('liveCoords').textContent=`${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;const coords=(r.history||[]).filter(x=>Number.isFinite(x.longitude)&&Number.isFinite(x.latitude)).map(x=>[x.longitude,x.latitude]);if(map.getSource('live-track'))map.getSource('live-track').setData({type:'FeatureCollection',features:coords.length>1?[{type:'Feature',geometry:{type:'LineString',coordinates:coords},properties:{callsign:p.callsign}}]:[]});if(center)map.easeTo({center:[p.longitude,p.latitude],zoom:9,duration:600});}
async function runLivePrediction(silent=false){if(!state.aprsConfigured){if(!silent)toast('Configure APRSFI_API_KEY in .env first',true);return;}const btn=$('runLivePredict');if(!silent){btn.disabled=true;btn.querySelector('span').textContent='Calculating…';}const body={callsign:$('callsign').value,mode:state.liveMode,phase:$('livePhaseSelect').value,ascent_rate_ms:Number($('liveAscent').value),descent_rate_ms:Number($('liveDescent').value),burst_altitude_m:Number($('liveBurst').value),float_altitude_m:Number($('liveFloatAltitude').value),float_ascent_rate_ms:Number($('liveFloatRate').value),float_duration_min:Number($('liveFloatDuration').value)};try{const result=await api('/api/live/predict',{method:'POST',body:JSON.stringify(body)});displayPrediction(result);state.lastLivePredictAt=Date.now();if(!silent)toast(`Live prediction updated for ${body.callsign}`);}catch(e){if(!silent)toast(e.message,true);else console.warn(e);}finally{if(!silent){btn.disabled=false;btn.querySelector('span').textContent='Predict from live position';}}}

init();
