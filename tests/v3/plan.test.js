import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekPlan,pickRoute,paceFor} from '../../v3/js/plan.js';

const DAY=864e5,mon=Date.UTC(2026,9,5); // a Monday
const routes=[{id:1,name:'Hills loop',D:8000,climb:72},{id:2,name:'Park 5K',D:5000,climb:18},{id:3,name:'Towpath',D:16000,climb:18},{id:4,name:'Ribble 10K',D:10070,climb:101}];
const kinds=p=>p.days.map(d=>d.kind[0]).join('');

test('plan: a week with no goal: intervals Tue, tempo Thu, long Sun, easy runs, the rest rest',()=>{
  // weeks alternate: a tempo on Thursday, or (no tempo) a Saturday race against your best on the 5K course
  const [p,q]=[mon,mon+7*DAY].map(m=>weekPlan({monday:m,runsPerWeek:4,weekKm:30,form:268,routes})).sort((a,b)=>a.days[5].kind==='race'?1:-1);
  assert.equal(p.phase,'keep');assert.equal(kinds(p),'rirtrel');
  assert.deepEqual(p.days.map(d=>d.kind),['rest','int','rest','tempo','rest','easy','long']);
  assert.deepEqual(q.days.map(d=>d.kind),['rest','int','rest','easy','rest','race','long']);
  assert.ok(q.days[5].vsBest&&q.days[5].route.id===2,'race your best on the park 5K');
  const L=p.days[6];assert.equal(L.route.id,4,'a third of the week: about 10 km');assert.equal(weekPlan({monday:mon,runsPerWeek:4,weekKm:45,form:268,routes}).days[6].route.id,3,'a bigger week: the long route');assert.ok(L.pace>paceFor(268,16000)*1.2);
  const I=p.days[1];assert.equal(I.how,'int');assert.equal(I.route.id,2,'speed work on the flattest route');assert.ok(I.int.reps>=4&&I.int.pace<268);
  assert.ok(Math.abs(p.km-30*1.04)<9,`about the usual week: ${p.km}`);
});

test('plan: building to a goal: rehearsals of the goal course at goal pace; race week; taper',()=>{
  const goal={route:4,name:'Ribble 10K',date:mon+20*DAY+9*3600e3,time:2670,D:10070};
  const b=weekPlan({monday:mon,runsPerWeek:4,weekKm:30,form:268,routes,goal});
  assert.equal(b.phase,'build');assert.match(b.title,/3 weeks to Ribble/);
  const t=weekPlan({monday:mon+7*DAY,runsPerWeek:4,weekKm:30,form:268,routes,goal});
  assert.equal(t.phase,'taper');
  const reh=t.days.find(d=>d.rehearse);assert.ok(reh,'a rehearsal the week before');assert.equal(reh.route.id,4);assert.equal(reh.how,'part');assert.equal(reh.len,6000);
  assert.ok(t.km<b.km,'less running in the taper');
  const r=weekPlan({monday:mon+14*DAY,runsPerWeek:4,weekKm:30,form:268,routes,goal});
  assert.equal(r.phase,'race');const rd=r.days[6];
  assert.equal(rd.kind,'race');assert.ok(rd.goalRace);assert.equal(r.days[5].kind,'rest','rest the day before');
  assert.equal(r.days[1].title,'Sharpener');assert.equal(r.days[1].int.len,400);
  const b2=weekPlan({monday:mon-7*DAY,runsPerWeek:5,weekKm:30,form:268,routes,goal});
  assert.equal(b2.days.filter(d=>d.kind!=='rest').length,5);
});

test('plan: routes: the first part of a longer one, or the closest; no form, no paces',()=>{
  assert.deepEqual(pickRoute(routes,4000).how,'full');assert.equal(pickRoute(routes,4000).route.id,2);
  const p=pickRoute([{id:9,name:'Long',D:21000,climb:0}],6000);assert.equal(p.how,'part');assert.equal(p.len,6000);
  const s=pickRoute([{id:9,name:'Short',D:3000,climb:0}],12000);assert.ok(s.short);
  const n=weekPlan({monday:mon,runsPerWeek:3,weekKm:0,form:null,routes});
  assert.deepEqual(n.days.filter(d=>d.kind!=='rest').map(d=>d.i),[1,3,6]);assert.ok(n.days.every(d=>d.pace==null));
});
