import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as P from '../../v4/js/pace.js';
import {vdotOf,raceTime as v3RaceTime,paces as v3Paces} from '../../v4/js/training.js';

const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);
const cases=JSON.parse(readFileSync(new URL('./pace_cases.json',import.meta.url)));

test('pace: race predictions match Daniels\' published VDOT tables (within 12 s)',()=>{
  // VDOT: [5K, 10K, half, marathon] from Daniels' Running Formula
  const T={40:['24:08','50:03','1:50:59','3:49:45'],50:['19:57','41:21','1:31:35','3:10:49'],60:['17:03','35:22','1:18:09','2:43:25']};
  for(const [v,ts] of Object.entries(T))['5k','10k','half','marathon'].forEach((k,i)=>close(P.raceTime(+v,P.DISTANCES[k]),P.parseDuration(ts[i]),12,`VDOT ${v} ${k}`));
  close(P.vdot(5000,20*60),49.8,0.3,'5K in 20:00');
  // a prediction round trip: 10K from a 5K, then back
  const t10=P.predict(5000,1200,10000);close(P.predict(10000,t10,5000),1200,0.5);
  assert.ok(P.riegel(5000,1200,10000)>t10-60&&P.riegel(5000,1200,10000)<t10+60,'Riegel close to VDOT at 10K');
});

test('pace: zones are ordered, threshold matches Daniels, and agree with the plan\'s training paces',()=>{
  const Z=P.zones(50),L=P.ZONES.map(z=>Z[z.id]);
  for(const z of L)assert.ok(z.fast<=z.target&&z.target<=z.slow,`${z.id} target inside its limits`);
  for(let i=1;i<L.length;i++)assert.ok(L[i].target<L[i-1].target,`${L[i].id} quicker than ${L[i-1].id}`);
  close(Z.threshold.target,255,4,'VDOT 50 threshold ~4:15/km');
  close(Z.race.target,P.raceTime(50,10000)/10,0.01,'race pace is the 10K prediction');
  // every pace the Norwegian plan uses sits inside its zone
  const p=v3Paces(50),inZ=(x,z)=>x>=Z[z].fast-0.01&&x<=Z[z].slow+0.01;
  for(const [k,z] of [['easy','easy'],['long','easy'],['recovery','recovery'],['subS','subthreshold'],['sub','subthreshold'],['subL','subthreshold'],['thr','threshold'],['hill','interval']])assert.ok(inZ(p[k],z),`${k} in ${z}`);
  assert.ok(inZ(v3Paces(50,{easyAdj:1.03}).easy,'easy'),'eased easy pace still easy');
  // the same model as training.js
  close(P.vdot(10000,2490),vdotOf(10000,2490),1e-9);close(P.raceTime(45,21097.5),v3RaceTime(45,21097.5),1e-6);
  // a goal time sets race pace
  close(P.zones(46,{raceDist:10000,raceTarget:2700}).race.target,270,1e-9);
  assert.equal(P.zoneOf(Z.easy.target,Z),'easy');assert.equal(P.zoneOf(Z.subthreshold.target,Z),'subthreshold');
});

test('pace: units, parsing and formatting',()=>{
  close(P.perKmToPerMile(300),482.8,0.1,'5:00/km is 8:03/mi');close(P.perMileToPerKm(480),298.3,0.1);
  close(P.kmToMiles(42.195),26.219,0.001);close(P.paceToKmh(300),12,1e-9);close(P.paceToMph(300),7.456,0.001);close(P.mphToPace(7.456),300,0.1);
  assert.equal(P.parseDuration('41:30'),2490);assert.equal(P.parseDuration('1:31:35'),5495);assert.equal(P.parseDuration('1:60:00'),null);assert.equal(P.parseDuration('abc'),null);
  assert.equal(P.formatDuration(5495),'1:31:35');assert.equal(P.formatDuration(59.6),'1:00');
  close(P.parsePace('7:30/mi'),279.6,0.1);assert.equal(P.parsePace('4:40/km'),280);assert.equal(P.parsePace('4:75'),null);
  assert.equal(P.formatPace(280,'mi'),'7:31/mi');assert.equal(P.formatPace(280),'4:40/km');
  assert.equal(P.parseDistance('half'),21097.5);close(P.parseDistance('6.2 mi'),9978,1);assert.equal(P.parseDistance('400m'),400);assert.equal(P.parseDistance('ten'),null);
});

test('pace: the in-run step is about 12 s/mile and stays inside the zone; easy runs only slow down',()=>{
  const Z=P.zones(50);
  const s=P.stepPace(Z.subthreshold.target,1,Z.subthreshold);assert.ok(s.changed);assert.ok(s.by>0&&s.by<=P.perMileToPerKm(12)+0.01);
  const f=P.stepPace(Z.subthreshold.fast+2,-1,Z.subthreshold);close(f.pace,Z.subthreshold.fast,1e-9);assert.equal(f.limit,'fast');
  const at=P.stepPace(Z.subthreshold.fast,-1,Z.subthreshold);assert.equal(at.changed,false);assert.equal(at.limit,'fast');
  const e=P.stepPace(Z.easy.target,-1,Z.easy,{onlySlower:true});assert.equal(e.changed,false);assert.equal(e.limit,'easy');
  const up=P.stepPace(Z.easy.target,1,Z.easy,{onlySlower:true});assert.ok(up.pace>Z.easy.target);
  // two steps at once
  close(P.stepPace(300,1,{fast:200,slow:400},{steps:2}).by,2*P.perMileToPerKm(12),1e-9);
});

test('pace: the shared cases (which coach/pace.py also checks) still hold',()=>{
  for(const c of cases.vdot)close(P.vdot(c.d,c.s),c.vdot,1e-9);
  for(const c of cases.raceTime)close(P.raceTime(c.v,c.d),c.s,1e-6);
  for(const c of cases.zones){const Z=P.zones(c.v,{raceDist:c.raceDist});for(const k of Object.keys(c.zones))for(const f of ['target','fast','slow'])close(Z[k][f],c.zones[k][f],1e-9,`${c.v} ${k} ${f}`)}
  for(const [x,y] of cases.parseDuration)assert.equal(P.parseDuration(x),y);
  for(const [x,y] of cases.parseDistance)assert.equal(P.parseDistance(x),y);
  for(const c of cases.stepPace){const o=P.stepPace(c.pace,c.dir,{fast:c.zoneFast,slow:c.zoneSlow},{onlySlower:c.onlySlower});close(o.pace,c.out.pace,1e-9);assert.equal(o.limit,c.out.limit)}
});
