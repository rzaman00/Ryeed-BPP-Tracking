import assert from 'node:assert/strict';
import { orientedRectangle, haversineMeters } from '../static/geometry.mjs';

function close(a,b,tol){assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);}

// East-west baseline, width north.
{
  const a={lng:-77,lat:39}, b={lng:-76.999,lat:39}, c={lng:-76.9995,lat:39.0005};
  const r=orientedRectangle(a,b,c);
  assert.equal(r.ring.length,5);
  assert.ok(r.baseline_length_m>80 && r.baseline_length_m<90);
  assert.ok(r.width_m>50 && r.width_m<60);
  close(r.ring[0][0],r.ring[4][0],1e-10); close(r.ring[0][1],r.ring[4][1],1e-10);
  assert.ok(r.area_m2>4000);
}
// North-south baseline, width west/east remains valid.
{
  const a={lng:-77,lat:39}, b={lng:-77,lat:39.001}, c={lng:-77.0006,lat:39.0004};
  const r=orientedRectangle(a,b,c);
  assert.ok(r.baseline_length_m>110 && r.baseline_length_m<112);
  assert.ok(r.width_m>50);
}
// Diagonal baseline verifies arbitrary orientation, not an axis-aligned box.
{
  const a={lng:-77,lat:39}, b={lng:-76.999,lat:39.001}, c={lng:-77.0002,lat:39.001};
  const r=orientedRectangle(a,b,c);
  assert.ok(r.baseline_length_m>130);
  const [p0,p1,p2,p3]=r.ring;
  assert.notEqual(p2[0],p1[0]);
  assert.notEqual(p3[1],p0[1]);
  assert.ok(r.width_m>0);
}
// Degenerate baseline/width are rejected instead of producing broken GeoJSON.
assert.throws(()=>orientedRectangle({lng:0,lat:0},{lng:0,lat:0},{lng:1,lat:1}),/baseline/i);
assert.throws(()=>orientedRectangle({lng:0,lat:0},{lng:.001,lat:0},{lng:.0005,lat:0}),/width/i);
assert.ok(haversineMeters({lng:-77,lat:39},{lng:-77,lat:40})>110000);
console.log('geometry tests passed');
