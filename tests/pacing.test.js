import {test} from 'node:test';
import assert from 'node:assert/strict';
import {effort,plan,perKm,fmt,parseTime} from '../js/pacing.js';

const seg=(d0,len,g)=>({d0,d1:d0+len,len,g});
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`${a} vs ${b}`);

test('effort: uphill linear, downhill benefit tapers back to 1',()=>{
  close(effort(0),1);close(effort(5),1.165);close(effort(-5),0.91);close(effort(-10),0.82);
  assert.ok(effort(-15)>effort(-10));close(effort(-20),1);close(effort(-30),1);
});

test('plan: flat route gives the target pace everywhere',()=>{
  const p=plan([seg(0,3000,0),seg(3000,2000,1.5),seg(5000,1000,-1)].map(x=>({...x,g:0})),270);
  p.segs.forEach(x=>close(x.target,270));
});

test('plan: totals sum to T and climbs are slower than descents',()=>{
  const segs=[seg(0,1500,0.5),seg(1500,800,5),seg(2300,1200,-4),seg(3500,700,8),seg(4200,1800,-2.5)];
  const p=plan(segs,300);
  close(p.T,300*6);
  close(p.segs.reduce((a,x)=>a+x.len*x.target/1000,0),p.T);
  const up=p.segs.filter(x=>x.g>2),dn=p.segs.filter(x=>x.g<-2);
  assert.ok(Math.min(...up.map(x=>x.target))>300&&Math.max(...dn.map(x=>x.target))<300);
});

test('perKm: time-weighted, partial last km, sums to T',()=>{
  const p=plan([seg(0,1500,6),seg(1500,1100,-6)],300);
  const k=perKm(p.segs);
  assert.equal(k.length,3);close(k[2].d1,2600);
  close(k[0].target,p.segs[0].target);
  close(k.reduce((a,x)=>a+(x.d1-x.d0)/1000*x.target,0),p.T);
});

test('parseTime / fmt',()=>{
  assert.equal(parseTime('4:30'),270);assert.equal(parseTime('4.30'),270);assert.equal(parseTime(' 45:00 '),2700);
  assert.equal(parseTime('1:35:00'),5700);assert.equal(parseTime('300'),300);
  for(const b of ['4:5','4:60','a','','1:2:3:4','4:'])assert.ok(Number.isNaN(parseTime(b)),b);
  assert.equal(fmt(270),'4:30');assert.equal(fmt(5700),'1:35:00');
});
