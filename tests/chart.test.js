import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kmPaces,domain} from '../js/chart.js';

test('kmPaces: completed kms from split gaps, current km live after 50 m',()=>{
  assert.deepEqual(kmPaces([],60000,20),[]);                       // under 50 m: no bar yet
  assert.deepEqual(kmPaces([],60000,200),[300]);                   // 200 m in 60 s = 5:00
  assert.deepEqual(kmPaces([300000,590000],590000,2010),[300,290]); // 10 m into km 3: not shown
  assert.deepEqual(kmPaces([300000,590000],650000,2200),[300,290,300]);
});

test('domain: covers every band and clamps wild actuals; faster sits at the top',()=>{
  const d=domain([300,330,270],[285,900],5);
  assert.ok(d.fast<=265&&d.slow>=335);
  assert.ok(d.slow<=335+120+25,'a 15:00 km is clamped');
  assert.ok(d.fast<d.slow);
  assert.equal(d.fast%15,0);assert.equal(d.slow%15,0);
  assert.ok([15,30,60].includes(d.step));
});
