import assert from 'node:assert/strict';
import { deriveCityLabel, formatSweepParameter } from '../static/ui_helpers.mjs';

assert.equal(deriveCityLabel({properties:{name:'School Name',city:'Clear Spring',address:'1 Road, Clear Spring, MD 21722'}},0),'Clear Spring');
assert.equal(deriveCityLabel({properties:{name:'School Name',address:'1 Road, Cumberland, MD 21502'}},0),'Cumberland');
assert.equal(formatSweepParameter('ascent_rate_ms',5.5),'Ascent rate: 5.5 m/s');
assert.equal(formatSweepParameter('descent_rate_ms',9),'Descent rate: 9 m/s');
assert.equal(formatSweepParameter('altitude',28000),'Burst/Float altitude: 28,000 m');
console.log('ui helper tests passed');
