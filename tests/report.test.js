import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timeAtDist,segActuals,toCSV,toGPX,buildReport,fileName} from '../js/report.js';
import {parseGPX,analyse} from '../js/route.js';
import {plan} from '../js/pacing.js';
import {FIX,I} from '../js/record.js';

const M=1/111195;
// 3 km due north: flat 1 km, climb 1 km at 5 %, descent 1 km at -5 %
const pts=[];for(let d=0;d<=3000;d+=10)pts.push({d,lat:51+d*M,lon:0,ele:d<1000?0:d<2000?(d-1000)*.05:50-(d-2000)*.05});
const segs=plan(analyse(pts).segs,300).segs;

// Run each segment exactly at its target, one fix per second, stopping at `upTo` m
function runAlong(upTo=3000){
  const fixes=[];let t=0,d=0;
  const tgtAt=d=>segs.find(s=>d<s.d1||s===segs.at(-1)).target;
  while(d<upTo){
    const f=new Array(FIX.length).fill(null);
    Object.assign(f,{[I.ts]:1e12+t,[I.t]:t,[I.lat]:51+d*M,[I.lon]:0,[I.acc]:5,[I.d]:d,[I.rd]:d,[I.seg]:0,[I.cur]:tgtAt(d),[I.tgt]:tgtAt(d),[I.band]:'green'});
    fixes.push(f);t+=1000;d=Math.min(upTo,d+1000/tgtAt(d));
  }
  const rsplits=[];for(let k=1000;k<=d;k+=1000)rsplits.push(timeAtDist(fixes,k));
  return {id:1,started:Date.UTC(2026,9,3,9,5),status:'done',sim:false,elapsed:t,dist:d,rd:d,splits:rsplits,rsplits,
    route:{id:1,name:'Test <Hill> & Dale',src:'GPX',pts},segs,pace:300,S:5,amber:false,fixes};
}

test('timeAtDist: interpolates between fixes, null past the end',()=>{
  const f=(t,rd)=>{const x=new Array(FIX.length).fill(null);x[I.t]=t;x[I.rd]=rd;return x};
  const fixes=[f(0,0),f(10000,30),f(20000,60)];
  assert.equal(timeAtDist(fixes,0),0);assert.equal(timeAtDist(fixes,45),15000);assert.equal(timeAtDist(fixes,61),null);
});

test('segActuals: on-target run gives actual ≈ target; unfinished segment is partial',()=>{
  segActuals(runAlong()).forEach(s=>assert.ok(Math.abs(s.actual-s.target)<2,`${s.actual} vs ${s.target}`));
  const part=segActuals(runAlong(1500));
  assert.equal(part.at(-1).actual,null);           // never reached
  assert.equal(part[1].partial,true);assert.ok(Math.abs(part[1].actual-part[1].target)<2);
});

test('CSV: header plus one row per fix',()=>{
  const run=runAlong(),csv=toCSV(run).trim().split('\n');
  assert.equal(csv[0].split(',').length,11);assert.equal(csv.length,run.fixes.length+1);
  assert.match(csv[1],/^2001-09-09T01:46:40\.000Z,0\.0,51\.000000,0\.000000,5,0\.0,0\.0,0,/);
});

test('GPX: round-trips through our own parser with times and route elevation',()=>{
  const run=runAlong(),gpx=toGPX(run),g=parseGPX(gpx);
  assert.equal(g.pts.length,run.fixes.length);
  assert.match(g.name,/^Test &lt;Hill&gt; &amp; Dale|^Test <Hill> & Dale/);
  const mid=g.pts[Math.floor(g.pts.length/2)];assert.ok(mid.ele>20);
  assert.match(gpx,/<time>2001-09-09T01:46:40.000Z<\/time>/);
});

test('report: self-contained, data embedded safely, all sections present',()=>{
  const html=buildReport(runAlong());
  for(const s of ['<h2>Map</h2>','Pace vs target','<h2>Elevation</h2>','<h2>Per km</h2>','<h2>Segments</h2>','id="smap"','In band'])assert.ok(html.includes(s),s);
  assert.ok(html.includes('Test &lt;Hill&gt; &amp; Dale'));
  const json=html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)[1];
  assert.ok(!json.includes('<'));
  const d=JSON.parse(json);assert.equal(d.track.length,runAlong().fixes.length);assert.equal(d.route.length,pts.length);
});

test('report: free run has no target sections',()=>{
  const r=runAlong();Object.assign(r,{route:null,segs:null,pace:null,S:null,rd:0});
  r.fixes.forEach(f=>{f[I.rd]=null;f[I.tgt]=null;f[I.band]=null});
  const html=buildReport(r);
  assert.ok(html.includes('Free run'));assert.ok(!html.includes('<h2>Segments</h2>'));assert.ok(!html.includes('<h2>Elevation</h2>'));
});

test('fileName: dated and slugged',()=>{
  assert.match(fileName(runAlong(),'html'),/^pace-2026-10-03-\d{4}-test-hill-dale\.html$/);
});
