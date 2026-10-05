import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ghostFromRun,ghostFromTimes,timeAt,distAt,paceAt} from '../../v2/js/pacer.js';

const M=1/111195;
const pts=[];for(let d=0;d<=3000;d+=10)pts.push({d,lat:51+d*M,lon:0,ele:d<1000?0:d<2000?(d-1000)*0.04:40});
const close=(a,b,e)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);
// A past run: 5:00/km, but 6:00/km between 1 and 2 km, a fix every ~3 m
const timeOf=d=>d<1000?d*0.3:d<2000?300+(d-1000)*0.36:660+(d-2000)*0.3;
const fixes=[];for(let d=0;d<=3000;d+=3.3){const t=timeOf(d);fixes.push([1e12+t*1000,t*1000,51+d*M,0,5,d,d,null])}
fixes.push([0,960e3,51+3000*M,0,5,3000,3000,null]);

test('ghost: reaches every point exactly when you did',()=>{
  const G=ghostFromRun(pts,fixes,960);
  assert.equal(G.finish,960);
  for(const d of [0,500,1000,1500,2400,3000])close(timeAt(G,d),timeOf(d),0.5);
  for(const t of [100,450,700,900])close(distAt(G,t),[...Array(3001).keys()].find(d=>timeOf(d)>=t),2);
});

test('ghost: its pace shows where you slowed',()=>{
  const G=ghostFromRun(pts,fixes,960);
  close(paceAt(G,500),300,3);close(paceAt(G,1500),360,3);close(paceAt(G,2700),300,3);
  assert.ok(G.lin&&G.ghost);
});

test('ghost: rebuilt from saved times; a run stopped short is extended at its late pace',()=>{
  const G=ghostFromRun(pts,fixes,960),R=ghostFromTimes(pts,[...G.time]);
  close(timeAt(R,1750),timeAt(G,1750),1e-9);
  const short=ghostFromRun(pts,fixes.filter(f=>f[6]<=2900),960);
  close(short.finish,960,3);
});

test('ghost: GPS wobble going backwards along the route is ignored',()=>{
  const wob=fixes.map((f,i)=>i%7===3?[...f.slice(0,6),f[6]-6,null]:f);
  const G=ghostFromRun(pts,wob,960);
  for(let i=1;i<G.time.length;i++)assert.ok(G.time[i]>=G.time[i-1]);
  close(timeAt(G,1500),timeOf(1500),1);
});
