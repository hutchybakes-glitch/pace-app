import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPacer,timeAt,distAt,paceAt,avgBetween,effort,extremes,gradeColor,paceMarks,projectFinish,PROFILES,CLIMB,DESCENT} from '../../v2/js/pacer.js';
import {parseGPX,resample} from '../../v2/js/route.js';

const M=1/111195;
const line=(len,f)=>{const s=[];for(let d=0;d<=len;d+=10)s.push({d,lat:51+d*M,lon:0,ele:f(d)});return s};
const prof=id=>PROFILES.find(p=>p.id===id);
const close=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);
// 1 km flat, 1 km at 5 %, 1 km flat, 1 km at −5 %, 1 km flat
const hilly=line(5000,d=>d<1000?0:d<2000?(d-1000)*.05:d<3000?50:d<4000?50-(d-3000)*.05:0);

test('flat route: every profile but negative split runs one even pace; finishes on time',()=>{
  for(const p of PROFILES){
    const P=buildPacer(line(5000,()=>10),1500,p);
    close(P.time.at(-1),1500,1e-6);
    if(p.strategy==='even')P.pace.forEach(x=>close(x,300,1e-6));
  }
});

test('hilly route: finishes on time; slower up, quicker down; changes gradually',()=>{
  const P=buildPacer(hilly,1500,prof('even'));
  close(P.time.at(-1),1500,1e-6);
  const up=paceAt(P,1500),down=paceAt(P,3500),flat=paceAt(P,4800);
  assert.ok(up>flat&&flat>down,`${up} ${flat} ${down}`);
  for(let i=1;i<P.pace.length;i++)assert.ok(Math.abs(P.pace[i]-P.pace[i-1])<5,'no lurches over 10 m');
});

test('profiles shape the same route differently',()=>{
  const climbSlow=id=>{const P=buildPacer(hilly,1500,prof(id));return paceAt(P,1500)/paceAt(P,4800)};
  assert.ok(climbSlow('climber')<climbSlow('even'));
  assert.ok(climbSlow('descender')>climbSlow('even'));
  const M=buildPacer(hilly,1500,prof('metronome'));M.pace.forEach(x=>close(x,300,1e-6));
  const N=buildPacer(line(5000,()=>0),1500,prof('negative'));
  assert.ok(paceAt(N,200)>paceAt(N,4800));close(avgBetween(N,0,5000),300,1e-6);
});

test('timeAt / distAt are inverses; avgBetween matches',()=>{
  const P=buildPacer(hilly,1500,prof('descender'));
  for(const d of [0,7,999,1500,2345.6,4999,5000])close(distAt(P,timeAt(P,d)),d,1e-6);
  for(const t of [0,1,600.5,1499])close(timeAt(P,distAt(P,t)),t,1e-6);
  close(avgBetween(P,1000,2000)*1,timeAt(P,2000)-timeAt(P,1000),1e-6);
});

test('effort: descents help to the taper then fade; extremes and colours',()=>{
  close(effort(5,CLIMB.average,DESCENT.average),1.165);close(effort(-5,0,DESCENT.average),0.91);
  assert.ok(effort(-30,0,DESCENT.average)<=1);
  const e=extremes(buildPacer(hilly,1500,prof('even')));
  assert.ok(e.slow.d>1000&&e.slow.d<2100&&e.fast.d>3000&&e.fast.d<4100);
  assert.equal(gradeColor(0.2),'rgb(148,163,184)');assert.equal(gradeColor(10),'rgb(153,27,27)');assert.equal(gradeColor(-12),'rgb(20,83,45)');
  const r=x=>+gradeColor(x).match(/\d+/g)[1];assert.ok(r(0.5)>r(2)&&r(2)>r(5)&&r(5)>r(9),'steeper climbs are darker');
});

test('real route: Ribble Valley pacer is smooth and on time',()=>{
  const g=parseGPX(fs.readFileSync(new URL('../fixtures/ribble-valley-10k-2023.gpx',import.meta.url),'utf8'));
  const P=buildPacer(resample(g.pts),3000,prof('even'));
  close(P.time.at(-1),3000,1e-6);
  const e=extremes(P);assert.ok(e.slow.pace<400&&e.fast.pace>230,`${e.fast.pace} ${e.slow.pace}`);
});

test('paceMarks: at the start, at changes of pace, and at least every 400 m',()=>{
  const flat=paceMarks(buildPacer(line(3000,()=>0),900,prof('even')));
  assert.deepEqual(flat.map(m=>m.d),[100,500,900,1300,1700,2100,2500,2900]);
  flat.forEach(m=>close(m.pace,300,1e-6));
  const M=paceMarks(buildPacer(hilly,1500,prof('even')));
  for(let i=1;i<M.length;i++)assert.ok(M[i].d-M[i-1].d>=100&&M[i].d-M[i-1].d<=400);
  assert.ok(M.some(m=>m.d>850&&m.d<1100&&m.pace>310),'a mark announces the climb');
  assert.ok(M.some(m=>m.d>2850&&m.d<3100&&m.pace<290),'and the descent');
});

test('projectFinish: on plan → target; 2 % slow → 2 % slower; follows a recent change',()=>{
  const P=buildPacer(hilly,1500,prof('even'));
  close(projectFinish(P,2500,timeAt(P,2500)),1500,1e-6);
  close(projectFinish(P,2500,timeAt(P,2500)*1.02),1530,1e-6);
  assert.equal(projectFinish(P,150,40),null);
  // on plan overall, but the last km was 10 % slower than the plan → projection drifts slower
  const t=timeAt(P,3000),back=t-(timeAt(P,3000)-timeAt(P,2000))*1.1;
  assert.ok(projectFinish(P,3000,t,back)>1500);
});
