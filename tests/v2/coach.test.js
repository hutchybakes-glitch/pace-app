import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCoach,gapPhrase,sections} from '../../v2/js/coach.js';
import {buildPacer,timeAt,PROFILES} from '../../v2/js/pacer.js';

const M=1/111195;
const line=(len,f)=>{const s=[];for(let d=0;d<=len;d+=10)s.push({d,lat:51+d*M,lon:0,ele:f(d)});return s};
// 1 km flat, 600 m descent steepening from 2 % to 8 %, 1.4 km flat, 500 m climb at 5 %, 500 m flat
const ele=d=>d<1000?50:d<1600?50-((d-1000)**2)/600*0.08/1.6*1.6/1.6*0.625:d<3000?50-18:d<3500?32+(d-3000)*0.05:57;
const pts=line(4000,ele);
const prof=id=>PROFILES.find(p=>p.id===id);
const P=buildPacer(pts,1200,prof('even'));

// Run with a given gap (s, + = ahead) and your pace as functions of distance; every 10 m
function run(level,profId,{gap=()=>0,cur=()=>null,style='moderate'}={}){
  const c=createCoach({P,prof:prof(profId),level,style,band:5}),said=[],splits=[];
  for(let rd=0;rd<=4000;rd+=10){
    const t=timeAt(P,rd)-gap(rd);if(rd>0&&rd%1000===0)splits.push(t);
    for(const x of c.update({rd,t,gap:gap(rd),cur:cur(rd,t),splits:[...splits],proj:1200}))said.push({rd,...x});
  }
  return said;
}

test('sections: the course read as plain-English stretches',()=>{
  const S=sections(P);
  const kinds=S.map(x=>x.kind);
  assert.ok(kinds.includes('flat stretch'));
  assert.ok(kinds.some(k=>/descent/.test(k)));assert.ok(kinds.some(k=>/climb/.test(k)));
  const down=S.find(x=>/descent/.test(x.kind));
  assert.equal(down.trend,'steepening');assert.ok(down.steep.d>down.d0+down.len*0.5);
  for(let i=1;i<S.length;i++){assert.equal(S[i].d0,S[i-1].d1);assert.notEqual(S[i].rank,S[i-1].rank)}
});

test('terrain ahead: ~50 m before the descent, how it builds, and the pacer at the steepest point',()=>{
  const s=run('key','even');
  const a=s.find(x=>/^(Steep descent|Descent) in \d+ metres, gradually getting steeper\. Pacer picking up to \d:\d\d at the steepest point\.$/.test(x.text));
  assert.ok(a,JSON.stringify(s.map(x=>x.text)));assert.ok(a.rd>=1040&&a.rd<1100,`${a.rd}`);assert.equal(a.pri,3);
  assert.ok(s.some(x=>/^Climb in \d+ metres.*Pacer easing to/.test(x.text)));
  assert.ok(!s.some(x=>/turn|left|right/i.test(x.text)),'never directions');
});

test('long flat stretch announced on entry (full only)',()=>{
  assert.ok(run('full','even').some(x=>/^Long flat stretch, 1\.\d kilometres\. Pacer holding \d:\d\d\.$/.test(x.text)));
  assert.ok(!run('key','even').some(x=>/^Long flat stretch, /.test(x.text)));
  assert.ok(run('key','even').some(x=>/^In 50 metres, long flat stretch for 1\.\d kilometres\. Pacer easing to \d:\d\d\.$/.test(x.text)));
});

test('behind: a strong descender is pointed at the descent; a flat runner is told the pace to catch up',()=>{
  const behind={gap:rd=>rd<400?0:-4};
  const d=run('full','descender',behind).filter(x=>x.text.startsWith('Pacer 4 seconds ahead'));
  assert.ok(d.some(x=>/(Descent|Steep descent|Gentle downhill) in \d+ metres, your chance to close the gap\./.test(x.text)||/Use this .*descent to close the gap/.test(x.text)),JSON.stringify(d));
  const f=run('full','flat',behind).filter(x=>x.text.startsWith('Pacer 4 seconds ahead'));
  assert.ok(f.some(x=>/Run \d:\d\d for the next kilometre to catch up\.|Use this flat stretch to close the gap\.|Flat stretch in/.test(x.text)),JSON.stringify(f));
});

test('ahead and quicker with a big gap: told so, and told not to push',()=>{
  const s=run('full','even',{gap:rd=>rd<300?0:Math.min(15,(rd-300)/40),cur:()=>270});
  assert.ok(s.some(x=>/^Big gap forming, 1\d seconds ahead of the pacer and \d+ seconds a kilometre quicker\. No need to push harder\. If you feel good, keep it rolling\.$/.test(x.text)),JSON.stringify(s.filter(x=>/ahead/.test(x.text)).map(x=>x.text)));
});

test('level, splits, lead changes and the final 400 m',()=>{
  const s=run('full','even');
  assert.ok(s.some(x=>/^Right with the pacer\. \d:\d\d here\.$/.test(x.text)));
  assert.equal(s.filter(x=>/^Kilometre \d\. /.test(x.text)).length,4);
  assert.ok(s.some(x=>/^Final 400 metres\. Level with the pacer/.test(x.text)));
  const flip=run('key','even',{gap:rd=>rd<1500?4:-4});
  assert.ok(flip.some(x=>x.text==='The pacer has passed you'));
});

test('gapPhrase',()=>{
  assert.equal(gapPhrase(0.4),'Level with the pacer');assert.equal(gapPhrase(6.2),'6 seconds ahead');
  assert.equal(gapPhrase(-65),'1 minute 5 seconds behind');
});

test('styles: relaxed only states facts',()=>{
  const s=run('full','descender',{style:'relaxed',gap:rd=>rd<400?0:-6,cur:()=>310});
  const ups=s.filter(x=>/^Pacer \d+ seconds ahead\./.test(x.text));
  assert.ok(ups.length&&ups.every(x=>/^Pacer \d+ seconds ahead\. You're running \d:\d\d, pacer \d:\d\d\.$/.test(x.text)),JSON.stringify(ups.map(x=>x.text)));
  assert.ok(!s.some(x=>/chance|Pick it up|Ease|Don't|push|Too (slow|fast)/.test(x.text)));
});

test('styles: assertive corrects drift, gives the catch-up pace, reins you in',()=>{
  const slow=run('full','even',{style:'assertive',gap:rd=>rd<400?0:-4,cur:(rd,t)=>330});
  assert.ok(slow.some(x=>/^Too slow here\. Target \d:\d\d\.$/.test(x.text)));
  assert.ok(slow.some(x=>/^Pacer 4 seconds ahead\. Pick it up: \d:\d\d for the next 400 metres\.$/.test(x.text)));
  const fast=run('full','even',{style:'assertive',gap:rd=>rd<400?0:8,cur:()=>270});
  assert.ok(fast.some(x=>/^Too fast here\. Ease to \d:\d\d\.$/.test(x.text)));
  assert.ok(fast.some(x=>/^8 seconds ahead of the plan\. Ease back to \d:\d\d, don't bank time early\.$/.test(x.text)));
});

test('styles: moderate takes the pressure off when the pacer keeps getting away, and never repeats a tip',()=>{
  const s=run('full','descender',{gap:rd=>rd<300?0:-(rd-300)/40});
  assert.ok(s.some(x=>/^Pacer \d+ seconds ahead\. No pressure\. If you're tired, settle into a rhythm you can hold\./.test(x.text)),JSON.stringify(s.filter(x=>/^Pacer/.test(x.text)).map(x=>x.text)));
  const tips=s.map(x=>x.text.match(/(Use this [a-z ]+ to close the gap|[A-Z][a-z ]+ in \d+ metres, your chance)/)?.[0]).filter(Boolean);
  const uses=tips.filter(t=>t.startsWith('Use this'));
  assert.equal(new Set(uses).size,uses.length,'each "use this" tip once');
});
