import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildPacer,PROFILES,timeAt,adjustPacer} from '../../v2/js/pacer.js';
import {rpePlan,rpeAt,checkpoints,advise,parseRpe,parseYesNo,climbsOf} from '../../v2/js/rpe.js';

const M=1/111195;
const route=hill=>{const pts=[];for(let d=0;d<=10000;d+=10)pts.push({d,lat:51+d*M,lon:0,ele:hill&&d>=4000&&d<=4800?(d-4000)*0.06:hill&&d>4800?48:0});return pts};
const even=PROFILES[0];

test('rpe: all-out 10 km builds steadily, ≤ 6 for the first 2.5 km, 10 at the line',()=>{
  const P=buildPacer(route(false),50*60,even),R=rpePlan(P,'allout');
  for(let d=0;d<=2500;d+=100)assert.ok(rpeAt(R,d)<=6.05,`${d}: ${rpeAt(R,d)}`);
  assert.ok(rpeAt(R,5000)>rpeAt(R,2500)&&rpeAt(R,7500)>rpeAt(R,5000));
  assert.ok(rpeAt(R,10000)>=9.6);
});

test('rpe: a climb lifts it, recovery follows over the top',()=>{
  const flat=rpePlan(buildPacer(route(false),50*60,PROFILES.find(p=>p.id==='metronome')),'allout');
  const hilly=rpePlan(buildPacer(route(true),50*60,PROFILES.find(p=>p.id==='metronome')),'allout');
  assert.ok(rpeAt(hilly,4600)>rpeAt(flat,4600)+0.5,`climb ${rpeAt(hilly,4600)} vs ${rpeAt(flat,4600)}`);
  assert.ok(rpeAt(hilly,4950)<rpeAt(flat,4950),`recovery ${rpeAt(hilly,4950)} vs ${rpeAt(flat,4950)}`);
});

test('rpe: intensities stay within their bands',()=>{
  const P=buildPacer(route(true),60*60,even);
  const easy=rpePlan(P,'easy'),hard=rpePlan(P,'hard');
  assert.ok(Math.max(...easy.rpe)<=4&&Math.min(...easy.rpe)>=2);
  assert.ok(Math.max(...hard.rpe)<=8.5&&rpeAt(hard,10000)>=7.5);
});

test('rpe: check-ins about every quarter, moved off the climb, none near the finish',()=>{
  const P=buildPacer(route(true),50*60,even),c=checkpoints(P);
  assert.ok(c.length>=3&&c.length<=4,c.join());
  for(const d of c)assert.ok(!(d>=3900&&d<=4800)&&d<9200,c.join());
  assert.equal(climbsOf(P).length,1);
});

test('rpe: advice',()=>{
  const P=buildPacer(route(false),50*60,even),R=rpePlan(P,'allout'),at=5000,tg=rpeAt(R,at);
  const hi=advise({R,P,said:Math.round(tg)+2,at});assert.equal(hi.status,'high');assert.ok(hi.k>1&&hi.change>0);
  const lo=advise({R,P,said:Math.round(tg)-2,at});assert.equal(lo.status,'low');assert.ok(lo.k<1&&lo.change<0);
  assert.equal(advise({R,P,said:3,at:1500}).status,'low-early');
  assert.equal(advise({R,P,said:Math.round(tg),at}).status,'on');
  assert.equal(advise({R:rpePlan(P,'easy'),P,said:1.5,at}).status,'low-easy');
});

test('rpe: adjusting the plan keeps the time where you are',()=>{
  const P=buildPacer(route(false),50*60,even),A=adjustPacer(P,5000,1.02);
  assert.ok(Math.abs(timeAt(A,5000)-timeAt(P,5000))<0.01);
  assert.ok(Math.abs(A.finish-(1500+1500*1.02))<1);
});

test('rpe: understands spoken answers',()=>{
  assert.equal(parseRpe('Six'),6);assert.equal(parseRpe('about 7'),7);assert.equal(parseRpe('seven and a half'),7.5);
  assert.equal(parseRpe('for'),4);assert.equal(parseRpe('hello'),null);assert.equal(parseRpe('12'),null);
  assert.equal(parseYesNo('yes please'),true);assert.equal(parseYesNo('no keep it'),false);assert.equal(parseYesNo('what'),null);
});
