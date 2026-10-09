import {test} from 'node:test';
import assert from 'node:assert/strict';
import {vdotOf,raceTime,paces,skeleton,volumes,programme,adapt,load,mondayOf,dayNum} from '../../v3/js/training.js';
import {climbs,bestHill,venueFor,hilliness} from '../../v3/js/venues.js';

const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);
const DAY=864e5,at=(y,m,d,h=9)=>new Date(y,m-1,d,h).getTime();
const start=at(2026,10,9,10),race=at(2026,12,29),first=at(2026,10,11); // Fri 9 Oct; race Tue 29 Dec; first test Sun 11 Oct
// Routes every 10 m: a rolling 10 km course with a 400 m climb at 5 % from 6 km, a hilly 8 km loop with a
// 300 m climb at 7 %, a flat 5 km park and a flat 16 km towpath
const mk=(id,name,D,ele)=>({id,name,pts:Array.from({length:D/10+1},(_,i)=>({d:i*10,lat:54+i*10/111195,lon:-2,ele:ele(i*10)}))});
const hump=(d,a,L,g)=>d<a?0:d<a+L?(d-a)*g/100:L*g/100;
const courseR=mk(1,'Valley 10K',10000,d=>60+hump(d,6000,400,5)-hump(d,7000,400,5)+3*Math.sin(d/700));
const hillsR=mk(2,'Hills loop',8000,d=>90+hump(d,2000,300,7)-hump(d,5000,300,7));
const parkR=mk(3,'Park 5K',5000,()=>70),towR=mk(4,'Towpath',16000,d=>60+0.5*Math.sin(d/3000));
const routes=[hillsR,parkR,towR,courseR];
const cfg={start,raceDate:race,dist:'10k',days:4,km:26,longKm:14,firstTest:first,course:true,courseD:10000,courseName:'Valley 10K'};

test('training: VDOT matches Daniels\' tables, and gives the paces',()=>{
  close(vdotOf(5000,20*60),49.8,0.3,'5K in 20:00');close(raceTime(50,10000),41*60+21,20,'VDOT 50 10K');
  const p=paces(50);close(p.thr,255,6,'threshold ~4:15/km');
  assert.ok(p.r10k<p.thr&&p.thr<p.subS&&p.subS<p.sub&&p.sub<p.subL&&p.subL<p.mar&&p.mar<p.easy,'sub-threshold just under threshold, short reps quickest');
  assert.ok(p.hill<p.r10k,'hill reps around 5K effort');
});

test('training: tests every four weeks from the first, lighter test weeks, a longer taper for a Tuesday race',()=>{
  const W=skeleton(cfg);assert.equal(W.length,13);
  assert.deepEqual(W.filter(x=>x.test).map(x=>new Date(x.test).getDate()),[11,8,6],'11 Oct, 8 Nov, 6 Dec');
  assert.ok(W.filter(x=>x.test).every(x=>x.cut));
  assert.equal(W.filter(x=>x.phase==='taper').length,2,'race on a Tuesday: the week before is taper too');
  const V=volumes(cfg,W);
  for(let i=1;i<W.length;i++)if(!W[i].cut&&W[i].phase!=='taper'&&!W[i-1].cut)assert.ok(V[i].K<=V[i-1].K*1.1+0.01,`week ${i+1} up at most 10 %`);
  assert.ok(V.at(-2).K<Math.max(...V.map(v=>v.K))*0.75,'taper');
});

test('training: the Norwegian week, customised for the course',()=>{
  const P=programme(cfg,{vdot:45.6}),all=P.weeks.flatMap(w=>w.days).filter(d=>!d.pre);
  const firstRun=all.find(d=>d.kind!=='rest');assert.equal(firstRun.kind,'test');assert.equal(new Date(firstRun.date).getDate(),11);
  assert.equal(firstRun.venue.type,'course-full','tests on the full course');
  assert.equal(all.filter(d=>d.kind==='test').length,3);
  const rd=all.find(d=>d.kind==='race');assert.equal(new Date(rd.date).getDate(),29);assert.equal(all[all.indexOf(rd)-1].kind,'rest');
  const kinds=new Set(all.map(d=>d.kind));
  for(const k of ['sub','hills','hillsprints','rehearsal','long','easy','strides','sharpener'])assert.ok(kinds.has(k),`has ${k}`);
  assert.ok(!kinds.has('vo2'),'no flat-out speedwork');
  for(let i=1;i<all.length;i++)assert.ok(!(all[i].hard&&all[i-1].hard),`hard days apart: ${all[i-1].title} then ${all[i].title}`);
  // the day before a test is rest; a test week has just one sub-threshold session
  for(const w of P.weeks.filter(x=>x.test&&x.w)){const ti=w.days.findIndex(d=>d.kind==='test');assert.equal(w.days[ti-1].kind,'rest');assert.equal(w.days.filter(d=>d.kind==='sub').length,1)}
  // sub-threshold on the flat on Tuesdays and over the course on Thursdays; hills on the hill; rehearsals on the course
  const subs=all.filter(d=>d.kind==='sub');assert.ok(subs.some(d=>d.venue.type==='flat')&&subs.some(d=>d.venue.type==='course'));
  assert.ok(all.filter(d=>d.kind==='hills').every(d=>d.venue.type==='hill'));
  assert.ok(all.filter(d=>d.kind==='rehearsal').every(d=>d.venue.type==='course-part'&&d.dist<10000));
  // every session says why, why now, and how to warm up and cool down
  for(const d of all.filter(d=>d.kind!=='rest')){assert.ok(d.why&&d.now,`${d.title} explained`);assert.ok(d.warm.length&&d.cool.length,`${d.title} warm-up`)}
  assert.ok(all.filter(d=>d.extras.length).length>=10,'strength and mobility twice a week');
  // five runs a week: a third sub-threshold session once past the base
  const five=programme({...cfg,days:5},{vdot:45.6}).weeks.find(w=>w.phase==='build'&&!w.test);
  assert.equal(five.days.filter(d=>d.kind==='sub').length,3);
  // no course: tests are 5 km time trials, no rehearsals
  const flat=programme({...cfg,course:false},{vdot:45.6}).weeks.flatMap(w=>w.days);
  assert.ok(flat.filter(d=>d.kind==='test').every(d=>d.venue.type!=='course-full'));assert.ok(!flat.some(d=>d.kind==='rehearsal'));
});

test('training: where to run: the course\'s climbs, the matching hill, the flattest route',()=>{
  const c=climbs(courseR);assert.ok(c.length&&Math.abs(c[0].from-6000)<=60&&Math.abs(c[0].grade-5)<1,JSON.stringify(c[0]));
  assert.ok(hilliness(hillsR)>hilliness(parkR));
  const h=bestHill(routes,200,5);assert.ok(Math.abs(h.grade-5)<0.8,`${h.grade} on ${h.route.name}`);
  const steep=bestHill(routes,100,null);assert.equal(steep.route.name,'Hills loop');
  const v=venueFor({type:'hill'},{reps:12,len:200},routes,courseR);assert.equal(v.how,'int');assert.match(v.note,/steepest climb/);
  const f=venueFor({type:'flat'},{reps:6,len:1300},routes,courseR);assert.ok(['Park 5K','Towpath'].includes(f.route.name));assert.equal(f.dir,'alternate');
  const t=venueFor({type:'course'},{reps:3,len:1500},routes,courseR);assert.equal(t.route,courseR);assert.ok(t.from>=4500&&t.from<=6500,`hilliest stretch from ${t.from}`);
  const lf=venueFor({type:'long-flat',len:15000},{dist:15000},routes,courseR);assert.equal(lf.route.name,'Towpath');assert.equal(lf.how,'part');
  assert.equal(venueFor({type:'course-full'},{},routes,courseR).how,'full');
});

test('training: how sessions felt: paces nudged, tired legs swap a hard day, pain rests',()=>{
  const now=at(2026,10,25,8); // Sunday, with Tuesday's sub-threshold next
  assert.ok(adapt([{t:now-5*DAY,kind:'sub',feel:{rpe:3,how:'plan'}},{t:now-2*DAY,kind:'hills',feel:{rpe:6,how:'easy'}}],{now}).dv>0.5);
  const tooHard=[{t:now-3*DAY,kind:'sub',feel:{rpe:9,how:'hard'}}];assert.ok(adapt(tooHard,{now}).dv<0);assert.equal(adapt(tooHard,{now,since:now-DAY}).dv,0);
  const tired=[{t:now-2*DAY,kind:'easy',feel:{rpe:6,legs:'sore',energy:'low'}},{t:now-DAY,kind:'easy',feel:{rpe:6,legs:'heavy'}}],a=adapt(tired,{now});
  assert.ok(a.fatigue>=3);assert.equal(a.easyAdj,1.03);
  const fresh=programme(cfg,{vdot:46,now}),worn=programme(cfg,{vdot:46,now,fatigue:a.fatigue});
  const next=fresh.weeks.flatMap(w=>w.days).find(d=>d.date>=now&&d.hard&&d.kind!=='test'),sw=worn.weeks.flatMap(w=>w.days).find(d=>d.key===next.key);
  assert.equal(sw.kind,'easy');assert.equal(sw.adapted,'tired');
  const hurt=programme(cfg,{vdot:46,now,pain:true}).weeks.flatMap(w=>w.days).filter(d=>dayNum(d.date)>=dayNum(now)).slice(0,2);
  assert.ok(hurt.every(d=>d.kind==='rest'&&d.adapted==='pain'));
});

test('training: load by week (effort × minutes) and the ramp',()=>{
  const now=start+30*DAY,runs=[];for(let k=0;k<5;k++)for(let j=0;j<3;j++)runs.push({t:mondayOf(now)-k*7*DAY+(j*2+1)*DAY,min:40,rpe:4});
  runs.push({t:now,min:60,rpe:8});
  const L=load(runs,now);assert.equal(L.weeks.length,8);assert.ok(L.ramp>1);
});
