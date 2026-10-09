import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPacer} from '../../v3/js/pacer.js';
import {analyse,segments,fitHills,learnedProfile,riegel,runnerType,pctAt,TYPICAL} from '../../v3/js/analysis.js';

const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);
// A 10 km route of rolling hills (±15 m over 2 km waves: grades up to about ±4.7 %), points every 10 m
const route=(D=10000,amp=15,wave=2000)=>Array.from({length:D/10+1},(_,i)=>({d:i*10,lat:54+i*10/111195,lon:-2,ele:100+amp*Math.sin(i*10/wave*2*Math.PI)}));
// A run of that route by a runner with hill model fit, finishing in T s; cadence from speed
function runOf(pts,T,fit,{started=Date.UTC(2026,5,1),cad=true,fade=0}={}){
  const P=buildPacer(pts,T,{climb:'average',descent:'average',strategy:'even',fit},{easeM:20,gradeM:40,smoothM:40});
  let t=0;const fixes=[];
  for(let i=0;i<pts.length;i++){
    if(i)t+=(P.time[i]-P.time[i-1])*(1+fade*pts[i].d/pts.at(-1).d);
    const pace=P.pace[i]*(1+fade*pts[i].d/pts.at(-1).d),v=1000/pace,c=cad?Math.round(150+7*v+(P.grade[i]>3?3:0)):null;
    fixes.push([started+t*1000,t*1000,pts[i].lat,pts[i].lon,5,pts[i].d,pts[i].d,pace,c,c?+(v/(c/60)).toFixed(2):null,pts[i].d]);
  }
  return {id:started,started,status:'done',mode:'race',complete:true,route:{id:1,name:'Hills',pts},fixes,elapsed:t*1000,rd:pts.at(-1).d};
}

test('analysis: segments carry the gradient and the pace of each 100 m',()=>{
  const pts=route(),r=runOf(pts,3000,{climb:0.033,gain:0.018,taper:-10}),{segs,dist}=segments(r);
  close(dist,10000,1);assert.ok(segs.length>=95);
  const up=segs.filter(s=>s.grade>3),flatish=segs.filter(s=>Math.abs(s.grade)<1);
  assert.ok(up.length&&flatish.length);
  assert.ok(Math.min(...up.map(s=>s.pace))>Math.max(...flatish.map(s=>s.pace)),'climbs are slower than the flat');
});

test('analysis: learns a strong climber from their runs (and a weak one)',()=>{
  const pts=route();
  const strong=[0,1,2].map(k=>runOf(pts,2700+k*30,{climb:0.020,gain:0.026,taper:-10},{started:Date.UTC(2026,5,1+k*7)}));
  const weak=[0,1,2].map(k=>runOf(pts,2700+k*30,{climb:0.050,gain:0.008,taper:-10},{started:Date.UTC(2026,5,1+k*7)}));
  const A=analyse(strong,Date.UTC(2026,6,1)),B=analyse(weak,Date.UTC(2026,6,1));
  assert.ok(A.ready&&B.ready);
  // the fit is pulled a little toward typical (prior), but clearly on the right side of it
  assert.ok(A.model.climb<TYPICAL.climb-0.006,`strong climb ${A.model.climb}`);
  assert.ok(B.model.climb>TYPICAL.climb+0.008,`weak climb ${B.model.climb}`);
  assert.ok(A.model.gain>B.model.gain+0.008,`descent ${A.model.gain} vs ${B.model.gain}`);
  assert.ok(A.scores.climb>70&&B.scores.climb<35,`scores ${A.scores.climb} ${B.scores.climb}`);
  assert.equal(A.type.id,'goat',JSON.stringify(A.scores));assert.equal(B.type.id,'road',JSON.stringify(B.scores));
  // and a pacer that runs like them
  const L=learnedProfile(A);assert.equal(L.id,'me');close(L.fit.climb,A.model.climb,1e-4);assert.equal(L.climb,'strong');
  assert.ok(pctAt(A.model,5)<pctAt(B.model,5));
});

test('analysis: the hill fit on its own recovers the slope from clean data',()=>{
  const pts=[];for(let g=-12;g<=12;g+=0.5)for(let k=0;k<20;k++)pts.push({grade:g,r:g>=0?1+0.04*g:g>=-10?1+0.02*g:Math.min(1,1+0.02*(-20-g))});
  const f=fitHills(pts);
  // 20 points per grade: hundreds of segments, so the prior barely moves it
  close(f.climb,0.04,0.0015,'climb');close(f.gain,0.02,0.0015,'gain');assert.equal(f.taper,-10);
});

test('analysis: flat-equivalent pace, trend and race predictions',()=>{
  const pts=route(),fit={climb:0.033,gain:0.018,taper:-10},day=864e5,t0=Date.UTC(2026,5,1);
  // getting quicker: 30 s off a 10 km every 2 weeks
  const runs=[0,1,2,3].map(k=>runOf(pts,3000-k*30,fit,{started:t0+k*14*day}));
  const A=analyse(runs,t0+50*day);
  assert.equal(A.per.length,4);
  assert.ok(A.per[3].fp<A.per[0].fp,'quicker');
  assert.ok(A.trend<-3,`trend ${A.trend} s/km a month`);
  const tenK=A.predict.find(p=>p.id==='10k'),five=A.predict.find(p=>p.id==='5k');
  // the best run was 2910 s over hilly 10 km: on the flat, a little quicker
  assert.ok(tenK.t<2910&&tenK.t>2750,`10k ${tenK.t}`);close(five.t,riegel(tenK.t,10000,5000),5);
  assert.ok(A.predict.find(p=>p.id==='mar'),'10 km runs predict a marathon (4.2×)');
});

test('analysis: pacing scores: even vs fading',()=>{
  const pts=route(),fit={climb:0.033,gain:0.018,taper:-10};
  const even=analyse([runOf(pts,3000,fit)]),fade=analyse([runOf(pts,3000,fit,{fade:0.12})]);
  assert.ok(even.fade!=null&&Math.abs(even.fade)<1.5,`even fade ${even.fade}`);
  assert.ok(fade.fade>5,`fade ${fade.fade}`);
  assert.ok(fade.scores.endurance<even.scores.endurance);
  assert.ok(even.scores.pacing>fade.scores.pacing);
});

test('analysis: cadence against speed, and on climbs',()=>{
  // three runs at different speeds, so cadence against speed can be told on the flat
  const pts=route(),A=analyse([2700,3000,3400].map((T,k)=>runOf(pts,T,{climb:0.033,gain:0.018,taper:-10},{started:Date.UTC(2026,5,1+k)})));
  assert.ok(A.cadence,'cadence fitted');close(A.cadence.b,7,1.5,'spm per m/s');
  assert.ok(A.cadence.up>1.5,`climbs +${A.cadence.up}`);
  const none=analyse([runOf(pts,3000,{climb:0.033,gain:0.018,taper:-10},{cad:false})]);
  assert.equal(none.cadence,null);assert.equal(none.scores.cadence,null);
});

test('analysis: no usable runs → not ready; runner types',()=>{
  assert.equal(analyse([]).ready,false);
  assert.equal(analyse([{status:'done',mode:'intervals',fixes:[]}]).ready,false);
  assert.equal(runnerType({climb:50,descent:50,pacing:82,endurance:60}).id,'metronome');
  assert.equal(runnerType({climb:50,descent:50,pacing:50,endurance:30}).id,'front');
  assert.equal(runnerType({climb:50,descent:50,pacing:50,endurance:50}).id,'allround');
});

test('analysis: a friend\'s run is raced, never learned from; runs are classed by effort; best efforts',async()=>{
  const {mine,bests,effortsOf,eq10}=await import('../../v3/js/analysis.js');
  const pts=route(),fit={climb:0.033,gain:0.018,taper:-10},day=864e5,t0=Date.UTC(2026,5,1);
  const race=runOf(pts,2700,fit,{started:t0}),easy=runOf(pts,3400,fit,{started:t0+2*day}),tempo=runOf(pts,2950,fit,{started:t0+4*day});
  const friend={...runOf(pts,2500,fit,{started:t0+5*day}),imported:{name:'parkrun',who:'Jess',challenge:true}};
  assert.ok(!mine(friend)&&mine(race));
  const A=analyse([race,easy,tempo,friend],t0+10*day);
  assert.equal(A.runs,3,'the friend\'s run is left out');
  assert.equal(A.kindOf.get(race.id),'race');assert.equal(A.kindOf.get(tempo.id),'tempo');assert.equal(A.kindOf.get(easy.id),'easy');
  close(A.form,A.per.find(x=>x.run===race).eq,0.01,'form is the best effort');
  // a purpose set before the run wins
  const B=analyse([race,{...tempo,purpose:'easy'}],t0+10*day);assert.equal(B.kindOf.get(tempo.id),'easy');
  // 10 km-equivalent: a 5 km pace is worth a slower 10 km pace
  assert.ok(eq10(240,5000)>240&&eq10(240,20000)<240);
  // best efforts: quickest stretch anywhere in the run; friends' runs don't count
  const e=effortsOf(race);close(e['10k'],2700,3);assert.ok(e['5k']<1360&&e['1k']<275);
  const b=bests([race,easy,friend]);assert.equal(b.find(x=>x.id==='10k').run,race);assert.ok(!b.find(x=>x.id==='half'));
});
