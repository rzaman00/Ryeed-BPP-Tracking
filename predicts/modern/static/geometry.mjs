const EARTH_RADIUS_M = 6371000;
const DEG = Math.PI / 180;

export function haversineMeters(a, b) {
  const lat1 = Number(a.lat) * DEG, lat2 = Number(b.lat) * DEG;
  const dLat = (Number(b.lat) - Number(a.lat)) * DEG;
  const dLon = (Number(b.lng) - Number(a.lng)) * DEG;
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function localXY(origin, point) {
  const lat0 = Number(origin.lat) * DEG;
  return {
    x: (Number(point.lng) - Number(origin.lng)) * DEG * EARTH_RADIUS_M * Math.cos(lat0),
    y: (Number(point.lat) - Number(origin.lat)) * DEG * EARTH_RADIUS_M,
  };
}
function fromLocalXY(origin, p) {
  const lat0 = Number(origin.lat) * DEG;
  return {
    lng: Number(origin.lng) + (p.x / (EARTH_RADIUS_M * Math.cos(lat0))) / DEG,
    lat: Number(origin.lat) + (p.y / EARTH_RADIUS_M) / DEG,
  };
}

export function orientedRectangle(a, b, c) {
  const bv = localXY(a, b), cv = localXY(a, c);
  const length = Math.hypot(bv.x, bv.y);
  if (!Number.isFinite(length) || length < 0.5) throw new Error('Rectangle baseline is too short');
  const ux = bv.x / length, uy = bv.y / length;
  const nx = -uy, ny = ux;
  const signedWidth = cv.x * nx + cv.y * ny;
  const width = Math.abs(signedWidth);
  if (!Number.isFinite(width) || width < 0.5) throw new Error('Rectangle width is too small');
  const wx = nx * signedWidth, wy = ny * signedWidth;
  const p0 = {x:0,y:0}, p1 = {x:bv.x,y:bv.y}, p2={x:bv.x+wx,y:bv.y+wy}, p3={x:wx,y:wy};
  const pts=[p0,p1,p2,p3,p0].map(p=>fromLocalXY(a,p));
  return {
    ring: pts.map(p=>[p.lng,p.lat]),
    baseline_length_m: length,
    width_m: width,
    signed_width_m: signedWidth,
    area_m2: length * width,
  };
}
