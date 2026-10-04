import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSmoother} from '../../v2/js/gps.js';

test('smoother: steady change shows within seconds, single spikes barely register',()=>{
  const s=createSmoother(6);let t=0,v;
  for(;t<=30000;t+=1000)v=s.update(3.33,t);             // 5:00/km
  assert.ok(Math.abs(v-3.33)<1e-9);
  v=s.update(6,t+=1000);                                  // one wild reading (2:47/km)
  assert.ok(v<3.33*1.06,`spike moved it to ${v}`);
  v=s.update(3.33,t+=1000);
  for(let i=0;i<10;i++)v=s.update(3.7,t+=1000);           // a real surge to 4:30/km
  assert.ok(v>3.6,`after 10 s ${v}`);
  for(let i=0;i<30;i++)v=s.update(3.7,t+=1000);
  assert.ok(Math.abs(v-3.7)<0.01);
});

test('smoother: three wild readings in a row are believed',()=>{
  const s=createSmoother(6);let t=0,v;
  for(;t<=10000;t+=1000)v=s.update(3,t);
  for(let i=0;i<10;i++)v=s.update(4.5,t+=1000);           // a genuine sprint: caught up within ~10 s
  assert.ok(v>4.0,`${v}`);
});
