import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStartGate,compass} from '../js/start.js';

const M=1/111195,LAT=51,K=Math.cos(LAT*Math.PI/180);
const pts=[];for(let d=0;d<=2000;d+=10)pts.push({d,lat:LAT+d*M,lon:0}); // route heads due north
const at=(east,north)=>[LAT+north*M,east*M/K];
const near=(a,b,e)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('far → ready → go: clock back-dated to the moment the line was crossed',()=>{
  const g=createStartGate(pts);
  let r,t=0;
  // jog in from 150 m behind the line at 3.5 m/s, one fix a second; line crossed at t = 150/3.5 s
  for(let n=-150;;n+=3.5,t+=1000){r=g.update(...at(2,n),5,t);if(r.state==='go')break;
    if(n<=-26)assert.equal(r.state,'far');else if(n>=-24&&n<=0)assert.equal(r.state,'ready')}
  near(r.crossTs,150/3.5*1000,300);
  near(r.bearing,180,15);                     // start is behind (south of) the runner now
});

test('standing at the line with GPS jitter does not start the clock',()=>{
  const g=createStartGate(pts);
  const jit=[0,4,-3,6,-5,2,7,-2,5,-4];
  for(let i=0;i<60;i++){const r=g.update(...at(jit[(i+3)%10],jit[i%10]),6,i*1000);assert.notEqual(r.state,'go')}
  assert.notEqual(g.update(...at(0,13),6,61000).state,'go');  // a single 13 m spike
  assert.equal(g.update(...at(0,1),6,62000).state,'ready');
});

test('already past the line: "past" until behind it again, then go',()=>{
  const g=createStartGate(pts);
  assert.equal(g.update(...at(0,15),5,0).state,'past');
  assert.equal(g.update(...at(0,-2),5,1000).state,'ready');
  assert.equal(g.update(...at(0,12),5,2000).state,'crossing'); // one fix past: not yet
  const r=g.update(...at(0,16),5,3000);
  assert.equal(r.state,'go');near(r.crossTs,1000+2/14*1000,1);
});

test('poor accuracy is ignored; approaching from the side still works',()=>{
  const g=createStartGate(pts);
  assert.equal(g.update(...at(0,0),35,0).state,'weak');
  assert.equal(g.update(...at(20,0),8,1000).state,'ready');   // 20 m to the side of the start
  assert.equal(g.update(...at(5,-1),8,2000).state,'ready');
  g.update(...at(0,11),8,5000);
  assert.equal(g.update(...at(0,14),8,6000).state,'go');
});

test('wandering far away again resets the zone',()=>{
  const g=createStartGate(pts);
  g.update(...at(0,-5),5,0);
  assert.equal(g.update(...at(0,-80),5,30000).state,'far');
});

test('compass names',()=>{
  assert.equal(compass(0),'north');assert.equal(compass(44),'north-east');assert.equal(compass(181),'south');assert.equal(compass(359),'north');
});
