(() => {
  const $ = id => document.getElementById(id);
  const qs = s => document.querySelector(s);
  const qsa = s => [...document.querySelectorAll(s)];
  let profile = 'standard';
  let map = null, mapReady = false;
  let launchMarker = null, actualLine = null, balloonMarker = null, uncertaintyCircle = null;
  let predictionLayers = [], batchLayers = [], airspaceLayers = [], geofenceLayer = null;
  let actualPoints = [], latestPrediction = null, selectedCallsign = 'UMD-DEMO';
  let ws = null, debounceTimer = null;
  let leafletLoadStarted = false;

  const stageColors = {ascent:'#e658ff', float:'#55d68b', descent:'#ff9d4d'};
  const fmt = n => Number(n).toLocaleString(undefined,{maximumFractionDigits:0});
  const timeFmt = d => new Date(d).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const setMsg = (id, text, type='') => { const el=$(id); el.textContent=text; el.className='message '+type; };

  function initMap(){
    if (mapReady) return;
    if (window.L) {
      mapReady = true;
      map = L.map('map', {zoomControl:true, preferCanvas:true}).setView([39.10,-77.05], 9);
      const tileUrl = window.__offlineTilesReady ? '/offline-tiles/{z}/{x}/{y}.png' : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      L.tileLayer(tileUrl, {maxZoom:19, attribution: window.__offlineTilesReady ? 'Local offline tiles' : '© OpenStreetMap'}).addTo(map);
      launchMarker = L.circleMarker([+$('lat').value,+$('lon').value], {radius:7,color:'#f5c842',weight:3,fillOpacity:.3}).addTo(map).bindTooltip('Launch / predict origin');
      map.on('contextmenu', e => {
        $('lat').value=e.latlng.lat.toFixed(5); $('lon').value=e.latlng.lng.toFixed(5);
        launchMarker.setLatLng(e.latlng); runPredict();
      });
      map.on('moveend', debounce(loadAirspace, 350));
      $('fallbackMap').style.display='none';
      loadAirspace(); loadGeofences();
    } else {
      $('fallbackMap').style.display='block';
      $('networkReady').textContent='OFFLINE'; $('networkReady').className='warn';
    }
  }

  function debounce(fn, wait){ let t; return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),wait)} }
  const autoPredict = debounce(()=>{ if($('autoPreview').checked) runPredict(); }, 450);

  function requestBody(providerOverride){
    const now = new Date();
    return {
      profile,
      provider: providerOverride || $('provider').value,
      launch_latitude:+$('lat').value,
      launch_longitude:+$('lon').value,
      launch_altitude_m:+$('launchAlt').value,
      launch_datetime:now.toISOString(),
      ascent_rate_mps:+$('ascent').value,
      burst_altitude_m:+$('burst').value,
      descent_rate_mps:+$('descent').value,
      float_altitude_m:+$('floatAlt').value,
      float_duration_min:+$('floatDuration').value,
      float_ascent_rate_mps:+$('floatRise').value,
      fallback_wind_speed_mps:+$('windSpeed').value,
      fallback_wind_bearing_deg:+$('windBearing').value
    };
  }

  async function api(path, options={}){
    const response = await fetch(path, {headers:{'Content-Type':'application/json'}, ...options});
    if(!response.ok){ let detail=''; try{detail=(await response.json()).detail}catch{}; throw new Error(detail || `${response.status} ${response.statusText}`); }
    return response.json();
  }

  async function runPredict(){
    const btn=$('predictBtn'); btn.disabled=true; btn.textContent='Predicting…'; setMsg('predictMessage','');
    try{
      const result=await api('/api/predict',{method:'POST',body:JSON.stringify(requestBody())});
      latestPrediction=result; renderPrediction(result); updatePredictionMetrics(result);
      const warning=result.warnings?.[0]; setMsg('predictMessage', warning || `Prediction generated with ${result.provider}.`, warning?'':'good');
    }catch(e){setMsg('predictMessage',e.message,'error')}
    finally{btn.disabled=false;btn.textContent='Run predict'}
  }


  async function runEnsemble(){
    const btn=$('ensembleBtn'); btn.disabled=true; setMsg('predictMessage','Running 7-member sensitivity ensemble…');
    try{
      const out=await api('/api/predict/ensemble',{method:'POST',body:JSON.stringify({base:requestBody(),members:7})});
      latestPrediction=out.central; renderPrediction(latestPrediction); updatePredictionMetrics(latestPrediction);
      const radius=out.spread?.p90_radius_m; setMsg('predictMessage', radius!=null?`Ensemble complete • P90 landing spread ${Math.round(radius)} m.`:'Ensemble complete; no common landing estimate.', 'good');
    }catch(e){setMsg('predictMessage',e.message,'error')} finally{btn.disabled=false}
  }

  async function runBatch(){
    const base=requestBody();
    const locations=[
      {name:'UMD College Park',latitude:39.00460,longitude:-76.87550,altitude_m:25},
      {name:'Valley Elementary (legacy site)',latitude:39.359031,longitude:-77.547824,altitude_m:170},
      {name:'Current custom point',latitude:+$('lat').value,longitude:+$('lon').value,altitude_m:+$('launchAlt').value}
    ];
    $('batchBtn').disabled=true; setMsg('predictMessage','Running three predictions concurrently…');
    try{
      const rows=await api('/api/predict/batch',{method:'POST',body:JSON.stringify({template:base,locations})});
      renderBatch(rows); setMsg('predictMessage',`Batch complete: ${rows.length} locations.`, 'good');
    }catch(e){setMsg('predictMessage',e.message,'error')}
    finally{$('batchBtn').disabled=false}
  }

  function clearPrediction(){
    if(mapReady){ predictionLayers.forEach(l=>map.removeLayer(l)); predictionLayers=[]; if(uncertaintyCircle){map.removeLayer(uncertaintyCircle);uncertaintyCircle=null;} }
  }

  function renderPrediction(result){
    clearPrediction();
    if(mapReady){
      const grouped={ascent:[],float:[],descent:[]};
      result.points.forEach(p=>grouped[p.stage]?.push([p.latitude,p.longitude]));
      Object.entries(grouped).forEach(([stage,pts])=>{ if(pts.length>1){ const l=L.polyline(pts,{color:stageColors[stage],weight:4,dashArray:'9 7',opacity:.9}).addTo(map); predictionLayers.push(l); }});
      if(result.landing){
        const ll=[result.landing.latitude,result.landing.longitude];
        const marker=L.circleMarker(ll,{radius:8,color:'#fff',weight:2,fillColor:'#ff9d4d',fillOpacity:.9}).addTo(map).bindTooltip(`Landing ±${Math.round(result.landing.uncertainty_m)} m`);
        uncertaintyCircle=L.circle(ll,{radius:result.landing.uncertainty_m,color:'#ff9d4d',weight:1,fillOpacity:.08}).addTo(map);
        predictionLayers.push(marker);
      }
      if(result.points.length){ map.fitBounds(L.latLngBounds(result.points.map(p=>[p.latitude,p.longitude])),{padding:[30,30],maxZoom:11}); }
    }
    renderFallback();
  }

  function renderBatch(rows){
    if(!mapReady) return;
    batchLayers.forEach(l=>map.removeLayer(l));batchLayers=[];
    const colors=['#56a8ff','#55d68b','#f5c842'];
    const bounds=[];
    rows.forEach((row,i)=>{
      const pts=row.prediction.points.map(p=>[p.latitude,p.longitude]); if(pts.length<2)return;
      const l=L.polyline(pts,{color:colors[i%colors.length],weight:3,opacity:.8}).addTo(map).bindTooltip(row.name);batchLayers.push(l);bounds.push(...pts);
    });
    if(bounds.length)map.fitBounds(bounds,{padding:[25,25]});
  }

  function updatePredictionMetrics(r){
    $('mProvider').textContent=r.provider;
    $('mDataset').textContent=r.dataset || (r.metadata?.cache_hit?'cached':'current run');
    if(r.landing){
      analyzeRecovery(r.landing.latitude,r.landing.longitude);
      $('mLanding').textContent=`${r.landing.latitude.toFixed(4)}, ${r.landing.longitude.toFixed(4)}`;
      $('mEta').textContent=`ETA ${timeFmt(r.landing.eta)}`;
      $('mConfidence').textContent=r.landing.confidence;
      $('mUncertainty').textContent=`± ${fmt(r.landing.uncertainty_m)} m • ${r.landing.uncertainty_method?.includes('ensemble')?'ensemble':'heuristic'}`;
    } else { $('mLanding').textContent='No descent'; $('mEta').textContent='float-only profile'; $('mConfidence').textContent='—'; $('mUncertainty').textContent='—'; }
  }

  async function analyzeRecovery(lat,lon){
    $('mRecovery').textContent='checking…'; $('mRecoveryDetail').textContent='terrain / road / parcel';
    try{
      const r=await api(`/api/recovery?lat=${lat}&lon=${lon}`);
      $('mRecovery').textContent=`${r.difficulty_score}/10`;
      const bits=[]; if(r.terrain?.max_local_slope_deg!=null)bits.push(`${r.terrain.max_local_slope_deg.toFixed(1)}° slope`); if(r.road?.distance_m!=null)bits.push(`${Math.round(r.road.distance_m)}m road`); if(r.parcel)bits.push('MD parcel found');
      $('mRecoveryDetail').textContent=bits.join(' • ')||'network data unavailable';
    }catch{$('mRecovery').textContent='—';$('mRecoveryDetail').textContent='recovery services unavailable'}
  }

  function updateTelemetry(s){
    selectedCallsign=s.callsign; const p=s.point;
    $('mState').textContent=s.state;
    $('mSource').textContent=`${p.source} • ${Math.round(s.telemetry_age_s)}s old${s.alerts?.length?' • ⚠ '+s.alerts[0]:''}`;
    $('mAlt').textContent=`${fmt(p.altitude_m)} m`;
    const vr=s.smoothed_vertical_rate_mps ?? p.vertical_rate_mps;
    $('mRate').textContent=vr==null?'rate unavailable':`${vr>=0?'+':''}${vr.toFixed(2)} m/s • ${s.calculated_ground_speed_mps?.toFixed(1) ?? '—'} m/s ground`;
    actualPoints.push([p.latitude,p.longitude]); if(actualPoints.length>5000)actualPoints.shift();
    if(mapReady && $('trackLayer').checked){
      if(actualLine) map.removeLayer(actualLine);
      actualLine=L.polyline(actualPoints,{color:'#fff',weight:3,opacity:.95}).addTo(map);
      if(!balloonMarker){balloonMarker=L.circleMarker([p.latitude,p.longitude],{radius:5,color:'#fff',fillColor:'#f5c842',fillOpacity:1,weight:2}).addTo(map).bindTooltip(s.callsign)}
      else balloonMarker.setLatLng([p.latitude,p.longitude]);
    }
    renderFallback();
  }

  function connectWS(){
    const proto=location.protocol==='https:'?'wss':'ws'; ws=new WebSocket(`${proto}://${location.host}/ws/live`);
    ws.onopen=()=>{ ws.send('hello'); };
    ws.onmessage=e=>{
      const ev=JSON.parse(e.data);
      if(ev.type==='telemetry') updateTelemetry(ev.payload);
      if(ev.type==='prediction' && ev.payload.callsign===selectedCallsign){latestPrediction=ev.payload.prediction;renderPrediction(latestPrediction);updatePredictionMetrics(latestPrediction)}
      if(ev.type==='warning') setMsg('liveMessage',ev.payload.message,'error');
    };
    ws.onclose=()=>setTimeout(connectWS,1500);
  }

  function downloadKML(){
    if(!latestPrediction?.points?.length){setMsg('predictMessage','Run a prediction first.','error');return}
    const coords=latestPrediction.points.map(p=>`${p.longitude},${p.latitude},${p.altitude_m}`).join(' ');
    const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>UMD Balloon Ops Prediction</name><Placemark><name>Prediction</name><LineString><extrude>1</extrude><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark></Document></kml>`;
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([kml],{type:'application/vnd.google-earth.kml+xml'}));a.download='umd_balloon_prediction.kml';a.click();URL.revokeObjectURL(a.href);
  }

  async function watchSpot(){
    const callsign=$('callsign').value.trim(), feed=$('spotFeed').value.trim(); if(!feed){setMsg('liveMessage','Enter a SPOT feed ID.','error');return}
    try{await api('/api/watch/spot',{method:'POST',body:JSON.stringify({callsign,feed_id:feed,feed_password:$('spotPassword').value||null,interval_s:150,enabled:true})});selectedCallsign=callsign;setMsg('liveMessage','SPOT watch started (150 s minimum poll interval).','good')}catch(e){setMsg('liveMessage',e.message,'error')}
  }
  async function watchAPRS(){
    const payload=$('callsign').value.trim(), login=$('aprsLogin').value.trim(), pass=$('aprsPass').value.trim(); if(!login||!pass){setMsg('liveMessage','Enter APRS login callsign and passcode.','error');return}
    try{await api('/api/watch/aprs',{method:'POST',body:JSON.stringify({payload_callsign:payload,login_callsign:login,passcode:pass,enabled:true})});selectedCallsign=payload;setMsg('liveMessage','APRS-IS watch started.','good')}catch(e){setMsg('liveMessage',e.message,'error')}
  }

  async function startDemo(){
    selectedCallsign=$('callsign').value.trim()||'UMD-DEMO'; actualPoints=[];
    try{ await api('/api/simulate/start',{method:'POST',body:JSON.stringify({callsign:selectedCallsign,start_latitude:+$('lat').value,start_longitude:+$('lon').value,start_altitude_m:+$('launchAlt').value,ascent_rate_mps:+$('ascent').value,max_altitude_m:+$('burst').value,descent_rate_mps:+$('descent').value,horizontal_speed_mps:+$('windSpeed').value,heading_deg:+$('windBearing').value,interval_s:1,time_scale:60})}); setMsg('liveMessage',`Demo ${selectedCallsign} started at 60× flight-time.`, 'good'); }
    catch(e){setMsg('liveMessage',e.message,'error')}
  }
  async function stopDemo(){try{await api(`/api/simulate/stop/${encodeURIComponent($('callsign').value.trim())}`,{method:'POST'});setMsg('liveMessage','Demo stopped.')}catch(e){setMsg('liveMessage',e.message,'error')}}
  async function watch(){const c=$('callsign').value.trim();try{await api('/api/watch',{method:'POST',body:JSON.stringify({callsign:c,source:'sondehub',enabled:true})});selectedCallsign=c;setMsg('liveMessage',`Watching ${c} via SondeHub.`, 'good')}catch(e){setMsg('liveMessage',e.message,'error')}}
  async function benchmarkStored(){
    const c=$('callsign').value.trim();
    try{const r=await api(`/api/benchmark/${encodeURIComponent(c)}?provider=offline&max_samples=10`);
      setMsg('liveMessage',`Benchmark: median ${r.median_error_m==null?'—':Math.round(r.median_error_m)+' m'} • best ${r.best_error_m==null?'—':Math.round(r.best_error_m)+' m'}${r.reference.landed_likely?'':' • final point not confirmed landed'}`,r.reference.landed_likely?'good':'');
    }catch(e){setMsg('liveMessage',e.message,'error')}
  }

  async function replay(){const c=$('callsign').value.trim(),s=+$('replaySpeed').value;try{await api(`/api/replay/${encodeURIComponent(c)}?speed=${s}`,{method:'POST'});selectedCallsign=c;actualPoints=[];setMsg('liveMessage',`Replaying ${c} at ${s}×.`, 'good')}catch(e){setMsg('liveMessage',e.message,'error')}}


  async function loadGeofences(){
    if(!mapReady)return;
    if(geofenceLayer){map.removeLayer(geofenceLayer);geofenceLayer=null}
    if(!$('geofences').checked)return;
    try{const geo=await api('/api/geofences'); geofenceLayer=L.geoJSON(geo,{style:{color:'#f5c842',weight:2,dashArray:'7 5',fillOpacity:.04}}).addTo(map)}catch{}
  }

  async function loadAirspace(){
    if(!mapReady)return; airspaceLayers.forEach(l=>map.removeLayer(l)); airspaceLayers=[];
    const b=map.getBounds(), bbox=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].join(',');
    try{
      if($('classAirspace').checked){const geo=await api(`/api/airspace?layer=class&bbox=${encodeURIComponent(bbox)}`); const l=L.geoJSON(geo,{style:f=>({color:'#56a8ff',weight:1.2,fillOpacity:.025})}).addTo(map);airspaceLayers.push(l)}
      if($('suaAirspace').checked){const geo=await api(`/api/airspace?layer=sua&bbox=${encodeURIComponent(bbox)}`); const l=L.geoJSON(geo,{style:f=>({color:'#ff6b6b',weight:1.2,dashArray:'5 4',fillOpacity:.025})}).addTo(map);airspaceLayers.push(l)}
      $('networkReady').textContent='ONLINE';$('networkReady').className='ok';
    }catch{$('networkReady').textContent='DEGRADED';$('networkReady').className='warn'}
  }

  function renderFallback(){
    if(mapReady)return;
    const svg=$('plot'); const all=[];
    actualPoints.forEach(p=>all.push({lat:p[0],lon:p[1],stage:'actual'}));
    latestPrediction?.points?.forEach(p=>all.push({lat:p.latitude,lon:p.longitude,stage:p.stage}));
    if(!all.length){ svg.innerHTML='<line class="schematic-grid" x1="0" y1="325" x2="1000" y2="325"/><line class="schematic-grid" x1="500" y1="0" x2="500" y2="650"/>'; return; }
    let minLat=Math.min(...all.map(p=>p.lat)),maxLat=Math.max(...all.map(p=>p.lat)),minLon=Math.min(...all.map(p=>p.lon)),maxLon=Math.max(...all.map(p=>p.lon));
    if(maxLat-minLat<.01){minLat-=.01;maxLat+=.01} if(maxLon-minLon<.01){minLon-=.01;maxLon+=.01}
    const xy=p=>[50+(p.lon-minLon)/(maxLon-minLon)*900,600-(p.lat-minLat)/(maxLat-minLat)*550];
    let html=''; for(let i=1;i<5;i++){html+=`<line class="schematic-grid" x1="${i*200}" y1="0" x2="${i*200}" y2="650"/><line class="schematic-grid" x1="0" y1="${i*130}" x2="1000" y2="${i*130}"/>`}
    if(actualPoints.length>1){html+=`<polyline class="schematic-path" stroke="#fff" points="${actualPoints.map(p=>xy({lat:p[0],lon:p[1]}).join(',')).join(' ')}"/>`}
    ['ascent','float','descent'].forEach(stage=>{const pts=(latestPrediction?.points||[]).filter(p=>p.stage===stage);if(pts.length>1)html+=`<polyline class="schematic-path" stroke="${stageColors[stage]}" stroke-dasharray="8 6" points="${pts.map(p=>xy(p).join(',')).join(' ')}"/>`});
    svg.innerHTML=html;
  }

  function setupUI(){
    qsa('.tab').forEach(b=>b.addEventListener('click',()=>{qsa('.tab').forEach(x=>x.classList.remove('active'));qsa('.tabpane').forEach(x=>x.classList.remove('active'));b.classList.add('active');$(`tab-${b.dataset.tab}`).classList.add('active')}));
    qsa('#profileButtons button').forEach(b=>b.addEventListener('click',()=>{profile=b.dataset.value;qsa('#profileButtons button').forEach(x=>x.classList.toggle('active',x===b));const isFloat=profile!=='standard';$('standardFields').classList.toggle('hidden',profile==='float');$('floatFields').classList.toggle('hidden',!isFloat);$('floatRiseWrap').classList.toggle('hidden',profile!=='experimental_float');autoPredict()}));
    qsa('#tab-predict input,#tab-predict select').forEach(el=>el.addEventListener('input',()=>{if(mapReady&&launchMarker&&['lat','lon'].includes(el.id))launchMarker.setLatLng([+$('lat').value,+$('lon').value]);autoPredict()}));
    $('predictBtn').onclick=runPredict;$('batchBtn').onclick=runBatch;$('ensembleBtn').onclick=runEnsemble;$('kmlBtn').onclick=downloadKML;$('demoBtn').onclick=startDemo;$('stopDemoBtn').onclick=stopDemo;$('watchBtn').onclick=watch;$('replayBtn').onclick=replay;$('benchmarkBtn').onclick=benchmarkStored;$('spotBtn').onclick=watchSpot;$('aprsBtn').onclick=watchAPRS;
    $('classAirspace').onchange=loadAirspace;$('suaAirspace').onchange=loadAirspace;$('geofences').onchange=loadGeofences;
    $('trackLayer').onchange=()=>{if(mapReady&&actualLine){if($('trackLayer').checked)actualLine.addTo(map);else map.removeLayer(actualLine)}};
    $('predictLayer').onchange=()=>{if(mapReady){predictionLayers.forEach(l=>$('predictLayer').checked?l.addTo(map):map.removeLayer(l)); if(uncertaintyCircle){$('predictLayer').checked?uncertaintyCircle.addTo(map):map.removeLayer(uncertaintyCircle)}}};
  }

  async function health(){
    try{const h=await api('/api/health');$('apiDot').classList.add('ok');$('apiStatus').textContent='API ONLINE';$('tawhiriReady').textContent='AUTO';$('tawhiriReady').className='ok'; window.__offlineTilesReady=!!h.offline_tiles; $('gfsReady').textContent=h.local_gfs?.ready?'READY':'OPTIONAL'; $('gfsReady').className=h.local_gfs?.ready?'ok':'warn'; if(h.offline_tiles){$('networkReady').textContent='LOCAL TILES';$('networkReady').className='ok'}}catch{$('apiStatus').textContent='API OFFLINE'}
  }

  function loadLeafletAsync(){
    if(window.L){initMap();return}
    if(leafletLoadStarted)return; leafletLoadStarted=true;
    const script=document.createElement('script');
    script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.async=true;
    script.onload=()=>initMap();
    script.onerror=()=>{$('networkReady').textContent='OFFLINE';$('networkReady').className='warn';renderFallback()};
    document.head.appendChild(script);
  }
  setInterval(()=>$('clock').textContent=new Date().toLocaleTimeString(),1000);
  setupUI();initMap();connectWS();health().finally(loadLeafletAsync);renderFallback();
  setTimeout(()=>runPredict(),300);
})();
