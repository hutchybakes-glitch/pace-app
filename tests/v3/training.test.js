import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vdotOf,raceTime,paces,skeleton,volumes,programme,adapt,load,mondayOf,dayNum} from '../../v3/js/training.js';

const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);
const DAY=864e5,start=new Date(2026,9,5,8).getTime(),race=new Date(2026,11,13,9).getTime(); // Mon 5 Oct → Sun 13 Dec

test('training: VDOT matches Daniels\' tables, and gives the training paces',()=>{
  close(vdotOf(5000,20*60),49.8,0.3,'5K in 20:00');close(vdotOf(42195,3*3600+10*60+49),50,0.3,'marathon 3:10:49');
  close(raceTime(50,10000),41*60+21,20,'VDOT 50 10K');close(raceTime(vdotOf(10000,50*60),10000),3000,1,'round trip');
  const p=paces(50);
  close(p.thr,255,6,'threshold ~4:15/km');close(p.int,235,6,'interval ~3:55/km');assert.ok(p.easy>300&&p.easy<340,`easy ${p.easy}`);
  assert.ok(p.rep<p.int&&p.int<p.r5k&&p.r5k<p.r10k&&p.r10k<p.thr&&p.thr<p.half&&p.half<p.mar&&p.thr<p.sub&&p.sub<p.mar&&p.mar<p.easy,'paces in order');
  assert.ok(paces(50,{easyAdj:1.03}).easy>p.easy);
});

test('training: phases, lighter weeks with retests, the taper',()=>{
  const W=skeleton({start,raceDate:race,dist:'half',test:true});
  assert.equal(W.length,10);assert.deepEqual([...new Set(W.map(x=>x.phase))],['base','build','peak','taper']);
  assert.equal(W.filter(x=>x.phase==='taper').length,2,'two weeks of taper for a half');
  assert.ok(W[0].test,'a test to start');assert.ok(W[3].cut&&W[3].test,'every fourth week lighter, with a retest');assert.ok(!W[7].cut,'not the week before the taper');
  const V=volumes({dist:'half',style:'balanced',days:5,km:30,longKm:12},W);
  for(let i=1;i<W.length;i++)if(!W[i].cut&&W[i].phase!=='taper'&&!W[i-1].cut)assert.ok(V[i].K<=V[i-1].K*1.1+0.01,`week ${i+1} up at most 10 %`);
  assert.ok(V[3].K<V[2].K,'lighter week');assert.ok(V.at(-1).K<V.at(-3).K*0.7,'taper');
  assert.ok(Math.max(...V.map(v=>v.long))<=22,'long run within the half cap');
});

test('training: a programme: test first, key sessions, long runs, race day with rest before',()=>{
  const cfg={start,raceDate:race,dist:'10k',style:'balanced',days:4,longDay:6,km:26,longKm:12,test:true};
  const P=programme(cfg,{vdot:46});
  const all=P.weeks.flatMap(w=>w.days),first=all.find(d=>d.kind!=='rest');
  assert.equal(first.kind,'test','the plan starts with a fitness test');
  const rd=all.find(d=>d.kind==='race');assert.equal(new Date(rd.date).getDate(),13);assert.equal(all[all.indexOf(rd)-1].kind,'rest');
  assert.ok(all.filter(d=>d.kind==='test').length>=3,'retests');
  const kinds=new Set(all.map(d=>d.kind));for(const k of ['hills','tempo','vo2','cruise','racepace','long','easy','strides'])assert.ok(kinds.has(k),`has ${k}`);
  // never two hard days in a row
  for(let i=1;i<all.length;i++)assert.ok(!(all[i].hard&&all[i-1].hard),`hard days apart: ${all[i-1].kind} then ${all[i].kind}`);
  // mostly easy: at least ~60 % of the distance at easy effort (warm-ups count as easy)
  const km=all.reduce((a,d)=>a+(d.km||0),0),hardKm=all.filter(d=>d.hard).reduce((a,d)=>a+(d.km||0)-2,0);
  assert.ok(hardKm/km<0.4,`hard share ${(hardKm/km).toFixed(2)}`);
  // styles: threshold has sub-threshold sessions and no VO2max work; quality has short easy days
  const T=programme({...cfg,style:'threshold',days:5},{vdot:46}).weeks.flatMap(w=>w.days);
  assert.ok(T.some(d=>d.kind==='sub')&&!T.some(d=>d.kind==='vo2'));
  const Q=programme({...cfg,style:'quality'},{vdot:46}).weeks.flatMap(w=>w.days);
  assert.ok(Q.filter(d=>d.kind==='easy').every(d=>d.km<=6));
  // a marathon plan's peak long runs finish at marathon pace
  const M=programme({...cfg,dist:'mar',raceDate:start+20*7*DAY,km:45,longKm:20},{vdot:46}).weeks.flatMap(w=>w.days);
  assert.ok(M.some(d=>d.kind==='long'&&/race pace/.test(d.what)));
});

test('training: how sessions felt: paces nudged, tired legs swap a hard day, pain rests',()=>{
  const now=start+13*DAY; // a Sunday, with Tuesday's session next
  const tooEasy=[{t:now-5*DAY,kind:'tempo',feel:{rpe:4,how:'plan'}},{t:now-2*DAY,kind:'vo2',feel:{rpe:7,how:'easy'}}];
  assert.ok(adapt(tooEasy,{now}).dv>0.5,'quicker');
  const tooHard=[{t:now-3*DAY,kind:'cruise',feel:{rpe:9,how:'hard'}}];assert.ok(adapt(tooHard,{now}).dv<0);
  assert.equal(adapt(tooHard,{now,since:now-DAY}).dv,0,'only since the last test');
  const tired=[{t:now-2*DAY,kind:'easy',feel:{rpe:6,legs:'sore',energy:'low'}},{t:now-DAY,kind:'easy',feel:{rpe:6,legs:'heavy'}}];
  const a=adapt(tired,{now});assert.ok(a.fatigue>=3);assert.equal(a.easyAdj,1.03,'easy runs felt hard: easier easy pace');
  const cfg={start,raceDate:race,dist:'10k',style:'balanced',days:4,longDay:6,km:26,longKm:12,test:false};
  const fresh=programme(cfg,{vdot:46,now}),worn=programme(cfg,{vdot:46,now,fatigue:a.fatigue});
  const next=fresh.weeks.flatMap(w=>w.days).find(d=>d.date>=now&&d.hard&&d.kind!=='test'&&d.kind!=='race'),swapped=worn.weeks.flatMap(w=>w.days).find(d=>d.key===next.key);
  assert.equal(swapped.kind,'easy');assert.equal(swapped.adapted,'tired');
  const hurt=programme(cfg,{vdot:46,now,pain:true}).weeks.flatMap(w=>w.days).filter(d=>dayNum(d.date)>=dayNum(now)).slice(0,2);
  assert.ok(hurt.every(d=>d.kind==='rest'&&d.adapted==='pain'));
});

test('training: load by week (effort × minutes) and the ramp',()=>{
  const now=start+30*DAY,runs=[];for(let k=0;k<5;k++)for(let j=0;j<3;j++)runs.push({t:mondayOf(now)-k*7*DAY+(j*2+1)*DAY,min:40,rpe:4});
  runs.push({t:now,min:60,rpe:8});
  const L=load(runs,now);assert.equal(L.weeks.length,8);assert.ok(L.ramp>1,'this week heavier');
});
