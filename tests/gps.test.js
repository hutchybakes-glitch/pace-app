import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav,createTrack,fitPace} from '../js/gps.js';

const fix=(lat,lon,accuracy=5)=>({latitude:lat,longitude:lon,accuracy});
const M=1/111195; // degrees latitude per metre (R=6371 km)

test('hav: 0.001° latitude ≈ 111 m',()=>{
  assert.ok(Math.abs(hav({lat:51,lon:0},{lat:51.001,lon:0})-111.2)<0.1);
});

test('track: accumulates distance, filters jitter, poor accuracy and glitches',()=>{
  const tr=createTrack();
  tr.add(fix(51,0),0,0);                    // first fix only anchors
  tr.add(fix(51+2*M,0),2000,2000);          // 2 m: jitter, ignored
  tr.add(fix(51+10*M,0,30),4000,4000);      // ±30 m: ignored
  tr.add(fix(51+10*M,0),5000,5000);         // 10 m accepted
  tr.add(fix(51+510*M,0),6000,6000);        // 500 m in 1 s: glitch, re-anchors only
  assert.ok(Math.abs(tr.dist-10)<0.01);
});

test('track: km splits and rolling pace',()=>{
  const tr=createTrack();
  tr.add(fix(51,0),0,0);
  for(let i=1;i<=250;i++)tr.add(fix(51+i*5*M,0),i*1500,i*1500); // 5 m per 1.5 s = 5:00/km
  assert.equal(tr.splits.length,1);
  assert.ok(Math.abs(tr.splits[0]-300000)<=1500);
  const r=tr.rolling(250*1500);
  assert.ok(Math.abs(r.sec/r.km-300)<1);
  assert.ok(r.sec<=30);
  tr.reset();
  assert.equal(tr.dist,0);assert.equal(tr.splits.length,0);
});

test('fitPace: steady pace recovered through noise; null when too little data or stopped',()=>{
  const n=(i)=>[1.5,-1,0.5,-1.5,1][i%5];
  const pts=[];for(let i=0;i<=20;i++)pts.push({t:i*1000,d:i*1000/300+n(i)}); // 5:00/km ± 1.5 m
  assert.ok(Math.abs(fitPace(pts)-300)<12);
  assert.equal(fitPace(pts.slice(0,2)),null);
  assert.equal(fitPace(pts.slice(0,8)),null);              // under 10 s
  assert.equal(fitPace(pts.map(p=>({t:p.t,d:5}))),null);   // standing still
});
