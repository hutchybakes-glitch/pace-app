import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectSteps,cadenceAt,strideOf,kmMotion,motionInsight,simCadence} from '../../v2/js/motion.js';

// A phone on a runner: gravity plus a bounce at the step rate, sampled at 60 Hz for `secs` seconds
let seed=3;const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
function signal(spm,secs,{amp=6,noise=0}={}){
  const out=[];
  for(let i=0;i<secs*60;i++){
    const t=i*1000/60,b=amp*Math.sin(2*Math.PI*spm/60*t/1000);
    out.push([t,noise*gauss(),9.81+b+noise*gauss(),noise*gauss()]);
  }
  return out;
}
const spmOf=steps=>{const s=steps.filter(t=>t>=2000);return (s.length-1)/((s.at(-1)-s[0])/60000)}; // after the 2 s warm-up

test('motion: a clean 170 spm signal reads 170 ± 2',()=>{
  const spm=spmOf(detectSteps(signal(170,60)));
  assert.ok(Math.abs(spm-170)<=2,`${spm}`);
});

test('motion: the same with noise reads 170 ± 5',()=>{
  const spm=spmOf(detectSteps(signal(170,60,{noise:1.2})));
  assert.ok(Math.abs(spm-170)<=5,`${spm}`);
});

test('motion: a still phone gives no steps (with or without sensor noise)',()=>{
  assert.equal(detectSteps(signal(170,30,{amp:0})).length,0);
  assert.equal(detectSteps(signal(170,30,{amp:0,noise:0.1})).length,0);
});

test('motion: never more than 240 spm, even with a very fast bounce',()=>{
  const steps=detectSteps(signal(320,30));
  for(let i=1;i<steps.length;i++)assert.ok(steps[i]-steps[i-1]>=250);
});

test('motion: cadence counts the last 15 s; nothing until a full window',()=>{
  const steps=[];for(let t=0;t<40;t+=60/172)steps.push(t);
  assert.equal(cadenceAt(steps,10),null);
  assert.ok(Math.abs(cadenceAt(steps,30)-172)<=4);
});

test('motion: stride needs 20 steps and 30 m, and a believable length',()=>{
  assert.equal(strideOf(19,25),null);assert.equal(strideOf(80,20),null);
  assert.ok(Math.abs(strideOf(86,100)-1.163)<0.01);
  assert.equal(strideOf(20,60),null); // 3 m a step
  assert.equal(strideOf(200,60),null); // 0.3 m a step
});

test('motion: per km cadence and stride from step counts at each km',()=>{
  const km=kmMotion([300,605],[860,1730],900,2580,2500);
  assert.equal(km.length,3);
  assert.ok(Math.abs(km[0].cad-172)<0.5&&Math.abs(km[0].stride-1000/860)<1e-9);
  assert.ok(Math.abs(km[2].stride-500/850)<1e-9);
  // a km where the timer or sensor stalled (21 spm) shows nothing rather than nonsense
  assert.equal(kmMotion([1200],[420],1300,500,1000)[0].cad,null);
});

test('motion: insight tells a stride fade from a cadence drop',()=>{
  const base=[{km:1,pace:300,cad:172,stride:1.16},{km:2,pace:300,cad:172,stride:1.16}];
  const fade=motionInsight([...base,{km:3,pace:330,cad:171,stride:1.06}]);
  assert.equal(fade[0].kind,'stride');assert.match(fade[0].text,/stride shortened/);
  const drop=motionInsight([...base,{km:3,pace:330,cad:160,stride:1.14}]);
  assert.equal(drop[0].kind,'cadence');
  assert.equal(motionInsight(base)[0].kind,'steady');
  // consecutive km with the same story are told once
  const run=motionInsight([...base,{km:3,pace:330,cad:171,stride:1.06},{km:4,pace:335,cad:171,stride:1.04}]);
  assert.equal(run.length,1);assert.match(run[0].text,/^Km 3–4/);
  // a slower km that the plan expected (a climb) isn't flagged
  const hilly=motionInsight([{km:1,pace:300,cad:172,stride:1.16,ref:300},{km:2,pace:330,cad:170,stride:1.06,ref:330}]);
  assert.equal(hilly[0].kind,'steady');
  assert.equal(simCadence(1000/300).toFixed(0),'172');
});

import {cadenceBaseline,cadencePlan,planAt,cadenceSigns,cadGrade,cadenceTip,TYPICAL_BASE} from '../../v2/js/motion.js';
import {buildPacer,PROFILES} from '../../v2/js/pacer.js';
const M2=1/111195;
const hillRoute=()=>{const pts=[];for(let d=0;d<=4000;d+=10)pts.push({d,lat:51+d*M2,lon:0,ele:d<1000?0:d<1600?(d-1000)*0.07:d<2200?42-(d-1600)*0.07:0});return pts};

test('cadence guide: typical runner 170 at 5:00/km on the flat, climbs quicker and shorter, descents hold cadence and lengthen',()=>{
  const P=buildPacer(hillRoute(),20*60,PROFILES[0]),C=cadencePlan(P);
  const flat=planAt(C,500),up=planAt(C,1300),down=planAt(C,1900);
  assert.ok(Math.abs(flat.cad-(TYPICAL_BASE+6*1000/P.pace[50]))<1);
  assert.ok(up.cad>flat.cad*1.01&&up.stride<flat.stride*0.9,`up ${up.cad} ${up.stride}`);
  assert.ok(down.cad>=flat.cad*0.99&&down.stride>flat.stride*1.03,`down ${down.cad} ${down.stride}`);
  assert.equal(cadGrade(-3),0);assert.ok(cadGrade(-8)>0.02);assert.equal(cadGrade(20),0.05);
});

test('cadence guide: signs at each climb, descent and flat',()=>{
  const P=buildPacer(hillRoute(),20*60,PROFILES[0]),S=cadenceSigns(P,cadencePlan(P));
  assert.deepEqual(S.map(s=>s.kind),['flat','up','down','flat']);
  assert.ok(S[1].steep&&S[1].d>900&&S[1].d<1100);
  assert.match(cadenceTip(S[1]),/shorten your stride/);assert.match(cadenceTip(S[0],true),/^Settle in/);assert.match(cadenceTip(S[2]),/light steps/);
});

test('cadence guide: your own baseline from flat running in past runs',()=>{
  const pts=hillRoute(),fixes=[];for(let d=0;d<900;d+=10)fixes.push([0,0,0,0,5,d,d,300,176,1.14]);
  const b=cadenceBaseline([{route:{pts},fixes}]);
  assert.ok(b.personal&&Math.abs(b.base-(176-6*1000/300))<0.01);
  assert.equal(cadenceBaseline([]).personal,false);
});
