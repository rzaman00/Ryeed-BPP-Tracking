import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {burstAltitudeValues} from '../static/ui_helpers.mjs';

// Exercise the actual UI handlers and request builder with lightweight fields.
const source = fs.readFileSync(new URL('../static/app.js', import.meta.url), 'utf8');
const fields = new Map();
const field = id => {
  if (!fields.has(id)) fields.set(id, {value: '', textContent: '', disabled: false});
  return fields.get(id);
};
const state = {predictType: 'burst', burstAltitudeMode: 'manual', manualBurstAltitude: 28000};
const context = vm.createContext({
  $, state, burstAltitudeValues,
  fmt: n => String(n), feet: n => Number(n) / .3048,
  buildLaunchDateTime: () => new Date('2026-11-03T12:00:00Z'),
  calculateInflation: () => Promise.resolve(),
});
function $(id) { return field(id); }
for (const [from, to] of [
  ['function updateAltitudeLabels()', 'function setAppView('],
  ['function setBurstAltitudeMode(', 'async function ensureAutomaticBurst('],
  ['function predictionBody(', 'function customPointTargets('],
]) vm.runInContext(source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))), context);

field('burstAltitudeFeet').value = '100000';
vm.runInContext("syncBurstAltitude('ft')", context);
assert.equal(Number(field('burstAltitude').value), 30480);
assert.equal(state.manualBurstAltitude, 30480);
assert.equal(field('burstAltitudeFeet').value, '100000');
const target = {geometry: {coordinates: [-77, 39]}, _label: 'Test'};
context.target = target;
assert.equal(vm.runInContext('predictionBody(target).burst_altitude_m', context), 30480);

state.inflationResult = {burst_altitude_m: 29000};
vm.runInContext("setBurstAltitudeMode('auto')", context);
assert.equal(Number(field('burstAltitude').value), 29000);
assert.equal(field('burstAltitude').disabled, true);
assert.equal(field('burstAltitudeFeet').disabled, true);
assert.ok(Math.abs(Number(field('burstAltitudeFeet').value) - 95144.36) < .01);
vm.runInContext("setBurstAltitudeMode('manual')", context);
assert.equal(Number(field('burstAltitude').value), 30480);
assert.equal(Number(field('burstAltitudeFeet').value), 100000);
assert.equal(field('burstAltitudeFeet').disabled, false);

field('burstAltitude').value = '25000';
vm.runInContext("syncBurstAltitude('m')", context);
assert.ok(Math.abs(Number(field('burstAltitudeFeet').value) - 82020.9973753) < .01);
field('burstAltitudeFeet').value = '';
vm.runInContext("syncBurstAltitude('ft')", context);
assert.equal(field('burstAltitude').value, '');
assert.throws(() => vm.runInContext('readBurstAltitudeMeters()', context), /at least/);
field('burstAltitudeFeet').value = '1000';
vm.runInContext("syncBurstAltitude('ft')", context);
assert.throws(() => vm.runInContext('readBurstAltitudeMeters()', context), /at least/);

console.log('Burst-unit UI checks passed: feet → meter request, automatic updates, manual restore, and validation.');
