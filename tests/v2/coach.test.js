import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCoach,gapPhrase} from '../../v2/js/coach.js';
import {buildPacer,paceMarks,timeAt,PROFILES} from '../../v2/js/pacer.js';

const M=1/111195;
const line=(len,f)=>{const s=[];for(let d=0;d<=len;d+=10)s.push({d,lat:51+d*M,lon:0,ele:f(d)});return s};
// 1 km flat, 1 km at 5 %, 1 km flat
const P=buildPacer(line(3000,d=>d<1000?0:d<2000?(d-1000)*.05:50),900,PROFILES[0]);

// Run exactly on the pacer's plan (gap 0) every 10 m; extra(s) can override parts of the state
function runCoach(level,extra=()=>({})){
  const c=createCoach({P,marks:paceMarks(P),level}),said=[],splits=[];
  for(let rd=0;rd<=3000;rd+=10){
    const t=timeAt(P,rd);if(rd>0&&rd%1000===0)splits.push(t);
    const e={rd,t,gap:0,cur:null,splits:[...splits],proj:900,...extra(rd,t)};
    for(const x of c.update(e))said.push({rd,...x});
  }
  return said;
}

test('pace only: no directions or route warnings are spoken',()=>{
  const s=runCoach('full');
  assert.ok(s.length>0);
  assert.ok(!s.some(x=>/turn|route|left|right/i.test(x.text)),JSON.stringify(s.map(x=>x.text)));
  assert.ok(s.filter(x=>/Pacer (eases|picks)/.test(x.text)).every(x=>x.pri===3));
});

test('pace changes ahead: the climb and its end are announced about 100 m early',()=>{
  const s=runCoach('key').filter(x=>/Pacer (eases|picks)/.test(x.text));
  assert.ok(s.some(x=>/^Climb ahead\. Pacer eases to/.test(x.text)&&x.rd>800&&x.rd<1000),JSON.stringify(s));
  assert.ok(s.some(x=>/picks up to/.test(x.text)&&x.rd>1800&&x.rd<2100));
});

test('km splits with the pacer, every km',()=>{
  const k=runCoach('key').filter(x=>/^Kilometre/.test(x.text));
  assert.equal(k.length,3);assert.match(k[0].text,/^Kilometre 1\. \d:\d\d\. Pacer \d:\d\d\. Level with the pacer\.$/);
});

test('lead changes and gap steps (full only), with hysteresis',()=>{
  // gap: 0 → +6 s by 1 km → back to −7 s by 2 km
  const gap=rd=>rd<1000?rd/1000*6:6-(rd-1000)/1000*13;
  const full=runCoach('full',(rd)=>({gap:gap(rd)}));
  assert.ok(full.some(x=>x.text==="You've passed the pacer")===false,'starting level then edging ahead is not a "pass"');
  assert.ok(full.some(x=>x.text==='The pacer has passed you'));
  assert.ok(full.some(x=>x.text==='5 seconds ahead of the pacer'));
  const key=runCoach('key',(rd)=>({gap:gap(rd)}));
  assert.ok(!key.some(x=>/seconds (ahead of|behind) the pacer/.test(x.text)));
});

test('drift and milestones',()=>{
  const s=runCoach('full',(rd,t)=>({cur:rd>200&&rd<900?400:null}));
  assert.ok(s.some(x=>/^A little slow here\. Pacer pace/.test(x.text)));
  assert.ok(s.some(x=>/^Halfway\. .*On course for 15:00\.$/.test(x.text)));
  assert.ok(s.some(x=>/^Last kilometre\./.test(x.text)));
});

test('gapPhrase',()=>{
  assert.equal(gapPhrase(0.4),'Level with the pacer');assert.equal(gapPhrase(6.2),'6 seconds ahead');
  assert.equal(gapPhrase(-65),'1 minute 5 seconds behind');assert.equal(gapPhrase(-1),'1 second behind');
});
