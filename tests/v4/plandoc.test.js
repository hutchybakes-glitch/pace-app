import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {programme,paces,mondayOf,addDays,dayNum,HARD} from '../../v4/js/training.js';
import {zones} from '../../v4/js/pace.js';
import {toDoc,validateDoc,applyEdits,replay,window as planWindow,TYPES,PLAN_SCHEMA,EDITS_SCHEMA} from '../../v4/js/plandoc.js';
import {starter} from './starter.mjs';

const at=(y,m,d,h=9)=>new Date(y,m-1,d,h).getTime();
// The Ribble Valley plan: built Fri 9 Oct, race Tue 29 Dec, first test Sun 11 Oct, four runs a week
const cfg={start:at(2026,10,9,10),raceDate:at(2026,12,29),dist:'10k',days:4,km:26,longKm:14,firstTest:at(2026,10,11),course:true,courseD:10000,courseName:'Ribble Valley 10K'};
const v=45.6,P=programme(cfg,{vdot:v}),Z=zones(v,{raceDist:10000}),pc=paces(v),ctx=now=>({Z,pc,racePace:Z.race.target,now});
const days=Q=>Q.weeks.flatMap(w=>w.days).filter(d=>!d.pre);
const km=w=>w.days.filter(d=>!d.pre).reduce((a,d)=>a+(d.km||0),0);
const now=at(2026,10,25,8); // Sunday 25 Oct
const next=(Q,f)=>days(Q).find(d=>dayNum(d.date)>=dayNum(now)&&f(d));

test('plan doc: the programme as versioned JSON that passes its own schema; the 10K starter plan is current',()=>{
  const doc=toDoc(P,{name:'Ribble Valley 10K',race:{name:'Ribble Valley 10K',distance_m:10000,date:cfg.raceDate},vdot:v,from:'test'});
  assert.deepEqual(validateDoc(doc),[]);
  assert.equal(doc.schema,'pacer.plan');assert.equal(doc.version,1);assert.equal(doc.plan.race.date,'2026-12-29');
  const s=doc.weeks[0].days.find(d=>d.day==='Sun').sessions[0];assert.equal(s.type,'test');assert.equal(s.zone,'race');
  const sub=doc.weeks.flatMap(w=>w.days).map(d=>d.sessions[0]).find(x=>x.type==='sub');assert.equal(sub.zone,'subthreshold');assert.ok(sub.reps.count>=2&&sub.distance_m===null);
  // the committed starter plan is exactly what the generator makes, and valid
  const file=JSON.parse(readFileSync(new URL('../../v4/plans/10k-starter.json',import.meta.url)));
  assert.deepEqual(file,JSON.parse(JSON.stringify(starter())),'run node tests/v4/make_starter.mjs');
  assert.deepEqual(validateDoc(file),[]);assert.equal(file.weeks.length,10);assert.ok(file.weeks.every(w=>w.start===null));
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../v4/plans/plan.schema.json',import.meta.url))),PLAN_SCHEMA);
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../v4/plans/edits.schema.json',import.meta.url))),EDITS_SCHEMA,'the laptop reads this file');
  // the validator catches what it should
  const broken=structuredClone(doc);broken.weeks[0].days[0].sessions[0].zone='warp';broken.weeks[1].days[0].sessions[0].id=doc.weeks[0].days[0].sessions[0].id;delete broken.plan.revision;
  const e=validateDoc(broken);assert.ok(e.some(x=>/warp/.test(x))&&e.some(x=>/duplicate/.test(x))&&e.some(x=>/revision: missing/.test(x)),e.join('\n'));
});

test('plan edits: swap a hard session to easy, cut a week by up to 10 %, shift a zone, move a session',()=>{
  const h=next(P,d=>d.kind==='sub');
  const a=applyEdits(P,[{op:'swap_session',session_id:h.key,new_type:'easy'}],ctx(now));
  assert.ok(a.results[0].ok,a.results[0].why);const sw=days(a.P).find(d=>d.key===h.key);assert.equal(sw.kind,'easy');assert.equal(sw.hard,false);assert.ok(sw.changed);
  assert.equal(days(P).find(d=>d.key===h.key).kind,'sub','the original is untouched');
  // a 15 % cut is capped at 10 %
  const wi=a.P.weeks.findIndex(w=>w.days.some(d=>d.key===h.key)),b=applyEdits(P,[{op:'reduce_volume_pct',week:wi+1,pct:15}],ctx(now));
  assert.ok(b.results[0].ok,b.results[0].why);assert.match(b.results[0].summary,/capped at 10 %/);
  const r=km(b.P.weeks[wi])/km(P.weeks[wi]);assert.ok(r>=0.895&&r<0.99,`week cut to ${r}`);
  // sub-threshold one zone harder is threshold, at the calculator's threshold pace
  const c=applyEdits(P,[{op:'shift_pace_zone',session_id:h.key,direction:'harder'}],ctx(now)),cs=days(c.P).find(d=>d.key===h.key);
  assert.ok(c.results[0].ok);assert.equal(cs.zone,'threshold');assert.equal(cs.pace,Z.threshold.target);
  assert.equal(applyEdits(c.P,[{op:'shift_pace_zone',session_id:h.key,direction:'harder'}],ctx(now)).results[0].ok,false,'no further than the type allows');
  // easy can only go to recovery
  const ez=next(P,d=>d.kind==='long');assert.equal(applyEdits(P,[{op:'shift_pace_zone',session_id:ez.key,direction:'easier'}],ctx(now)).results[0].ok,true);
  // move a session to a rest day in the same week, if that keeps hard days apart
  const w=P.weeks[wi],sub=w.days.find(d=>d.kind==='sub'&&dayNum(d.date)>=dayNum(now)),rests=w.days.filter(d=>d.kind==='rest'&&!d.pre&&dayNum(d.date)>=dayNum(now));
  const ok=rests.map(rd=>applyEdits(P,[{op:'move_session',session_id:sub.key,to_date:new Date(rd.date).toLocaleDateString('sv')}],ctx(now)).results[0]);
  assert.ok(ok.some(x=>x.ok),JSON.stringify(ok));
  const moved=ok.find(x=>x.ok);assert.match(moved.summary,/moves from/);
});

test('plan edits: the rules: no back-to-back hard days, nothing past, tests fixed, +10 % at most, four at a time',()=>{
  const all=days(P).filter(d=>dayNum(d.date)>=dayNum(now));
  // swapping the day after a hard session to hills would put two hard days together
  const i=all.findIndex((d,j)=>d.hard&&all[j+1]&&!all[j+1].hard&&!TYPES[all[j+1].kind].locked);
  const r=applyEdits(P,[{op:'swap_session',session_id:all[i+1].key,new_type:'hills'}],ctx(now)).results[0];
  assert.equal(r.ok,false);assert.match(r.why,/back to back/);
  const past=days(P).find(d=>dayNum(d.date)<dayNum(now)&&d.kind==='sub');
  assert.match(applyEdits(P,[{op:'swap_session',session_id:past.key,new_type:'rest'}],ctx(now)).results[0].why,/already gone/);
  const t=next(P,d=>d.kind==='test');assert.match(applyEdits(P,[{op:'swap_session',session_id:t.key,new_type:'easy'}],ctx(now)).results[0].why,/tests and race day/);
  // a rest day turned into a long run adds far more than 10 %
  const rest=next(P,d=>d.kind==='rest'&&!all.some(x=>x.hard&&Math.abs(dayNum(x.date)-dayNum(d.date))===1));
  const big=applyEdits(P,[{op:'swap_session',session_id:rest.key,new_type:'long'}],ctx(now)).results[0];assert.equal(big.ok,false);assert.match(big.why,/limit is 10 %/);
  // resting is always allowed, even past 10 %
  const lr=next(P,d=>d.kind==='long');assert.ok(applyEdits(P,[{op:'swap_session',session_id:lr.key,new_type:'rest'}],ctx(now)).results[0].ok);
  // junk is turned away, and at most four changes at once
  const j=applyEdits(P,[{op:'delete_week'},{op:'swap_session',session_id:'99-9',new_type:'easy'},{op:'shift_pace_zone',session_id:lr.key,direction:'sideways'},null],ctx(now)).results;
  assert.ok(j.every(x=>!x.ok));
  const five=Array.from({length:5},()=>({op:'shift_pace_zone',session_id:lr.key,direction:'easier'}));
  assert.match(applyEdits(P,five,ctx(now)).results[4].why,/At most 4/);
  // the plan with a change still has no back-to-back hard days and still validates
  const e=applyEdits(P,[{op:'swap_session',session_id:next(P,d=>d.kind==='hills').key,new_type:'easy'}],ctx(now)).P;
  assert.deepEqual(validateDoc(toDoc(e,{revision:2})),[]);
});

test('plan edits: accepted changes replay onto a rebuilt plan; the coach sees the next ten days',()=>{
  const h=next(P,d=>d.kind==='sub'),changes=[{rev:2,at:now,source:'model',edits:[{op:'swap_session',session_id:h.key,new_type:'easy'}]}];
  const later=at(2026,11,2,8),P2=programme(cfg,{vdot:46.2}),R=replay(P2,changes,{Z:zones(46.2),pc:paces(46.2),racePace:Z.race.target});
  assert.equal(days(R).find(d=>d.key===h.key).kind,'easy','still easy after a retest, even once the day has passed');
  // every kind of change replays (a week's cut included)
  const wk=R.weeks.findIndex(w=>w.days.some(d=>d.key===h.key)),R2=replay(P2,[...changes,{rev:3,edits:[{op:'reduce_volume_pct',week:wk+1,pct:10}]}],{Z:zones(46.2),pc:paces(46.2),racePace:Z.race.target});
  assert.ok(km(R2.weeks[wk])<km(R.weeks[wk])-0.4,`week ${wk+1} cut on replay: ${km(R.weeks[wk])} -> ${km(R2.weeks[wk])}`);
  const W=planWindow(P,now,10);assert.equal(W.length,10);assert.equal(W[0].date,'2026-10-25');
  assert.ok(W.every(x=>x.id&&x.type&&'zone' in x&&typeof x.hard==='boolean'));
  assert.ok(later>now);
});
