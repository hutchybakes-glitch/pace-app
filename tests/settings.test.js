import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,FIELDS,parseField,showField,routeOpts,coef} from '../js/settings.js';
import {DEF} from '../js/route.js';
import {COEF} from '../js/pacing.js';
import {speedPace} from '../js/gps.js';

test('defaults match the route and pacing modules',()=>{
  assert.deepEqual(routeOpts(DEFAULTS),{up:DEF.up,down:DEF.down,minLen:DEF.minLen,smooth:DEF.smooth});
  assert.deepEqual(coef(DEFAULTS),COEF);
});

test('fields: shown as friendly positives/percents, stored as the model expects',()=>{
  assert.equal(parseField('down','2.5'),-2.5);assert.equal(showField('down',-2.5),'2.5');
  assert.equal(parseField('cUp','3.3'),0.033);assert.equal(showField('cUp',0.033),'3.3');
  assert.equal(parseField('taper','12'),-12);assert.equal(parseField('S','7,5'),7.5);
  for(const k in FIELDS)assert.equal(parseField(k,showField(k,DEFAULTS[k])),DEFAULTS[k],k); // round trip
});

test('fields: out of range or junk is rejected',()=>{
  for(const [k,v] of [['S','0'],['S','61'],['up',''],['minLen','abc'],['cDown','6'],['taper','1']])assert.equal(parseField(k,v),null,`${k}=${v}`);
});

test('speedPace: mean GPS speed over at least 10 s',()=>{
  const pts=[0,5000,10000].map(t=>({t,v:1000/300}));
  assert.ok(Math.abs(speedPace(pts)-300)<1e-9);
  assert.equal(speedPace(pts.slice(0,2)),null);
  assert.equal(speedPace(pts.map(p=>({...p,v:0}))),null);
});
