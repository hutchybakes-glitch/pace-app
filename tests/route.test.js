import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hav} from '../js/gps.js';
import {parseGPX,resample,fillElevation,smooth,segment,analyse,DEF} from '../js/route.js';

const M=1/111195; // degrees latitude per metre
// Samples every 10 m due north with elevation f(d)
const line=(len,f)=>{const s=[];for(let d=0;d<=len;d+=10)s.push({d,lat:51+d*M,lon:0,ele:f(d)});return s};
// Deterministic noise in [-a,a]
const rng=(seed=1)=>a=>{seed=(seed*16807)%2147483647;return (seed/2147483647*2-1)*a};

test('parseGPX: trkpt with either attribute order, ele, CDATA name and entities',()=>{
  const g=parseGPX(`<?xml version="1.0"?><gpx><metadata><name><![CDATA[Hill &amp; Dale]]></name></metadata>
    <trk><trkseg><trkpt lat="51.5" lon="-0.1"><ele>12.5</ele></trkpt>
    <trkpt lon='-0.2' lat='51.6'><time>x</time></trkpt><trkpt lat="51.7" lon="-0.3"/></trkseg></trk>
    <rte><rtept lat="1" lon="1"/></rte></gpx>`);
  assert.equal(g.name,'Hill & Dale');
  assert.deepEqual(g.pts,[{lat:51.5,lon:-0.1,ele:12.5},{lat:51.6,lon:-0.2,ele:null},{lat:51.7,lon:-0.3,ele:null}]);
});

test('parseGPX: falls back to rtept',()=>{
  const g=parseGPX('<gpx><rte><name>R</name><rtept lat="1" lon="2"><ele>3</ele></rtept><rtept lat="1.1" lon="2"/></rte></gpx>');
  assert.equal(g.name,'R');assert.equal(g.pts.length,2);assert.equal(g.pts[0].ele,3);
});

test('resample: 10 m spacing along the route, finish included, ele interpolated',()=>{
  const pts=[{lat:51,lon:0,ele:0},{lat:51+500*M,lon:0,ele:50},{lat:51+500*M,lon:505*M/Math.cos(51*Math.PI/180),ele:50}];
  const s=resample(pts);
  const total=hav(pts[0],pts[1])+hav(pts[1],pts[2]);
  assert.ok(Math.abs(s.at(-1).d-total)<1e-6);
  for(let i=1;i<s.length-1;i++)assert.ok(Math.abs(hav(s[i-1],s[i])-10)<0.05);
  assert.ok(Math.abs(s[25].ele-25)<0.1); // 250 m along the first leg
  assert.equal(resample([{lat:0,lon:0,ele:null},{lat:M*100,lon:0,ele:1}])[3].ele,null);
  assert.throws(()=>resample([{lat:0,lon:0,ele:0},{lat:M*5,lon:0,ele:0}]));
});

test('fillElevation: batches of 100 and linear interpolation between looked-up points',async()=>{
  const s=line(12000,()=>null);  // 1201 samples → 241 lookups → 3 requests
  let calls=0;
  const fake=async url=>{calls++;const lat=new URL(url).searchParams.get('latitude').split(',').map(Number);
    assert.ok(lat.length<=100);
    return {ok:true,json:async()=>({elevation:lat.map(l=>(l-51)/M*0.05)})}}; // 5 % grade
  const out=await fillElevation(s,fake);
  assert.equal(calls,3);
  out.forEach(p=>assert.ok(Math.abs(p.ele-p.d*0.05)<0.1));
  await assert.rejects(fillElevation(s,async()=>({ok:false,status:429})),/429/);
});

test('smooth: removes alternating noise, keeps a steady grade',()=>{
  const es=smooth(line(1000,d=>d*0.03+(d/10%2?2:-2)));
  for(let i=5;i<es.length-5;i++)assert.ok(Math.abs(es[i]-i*10*0.03)<0.4);
});

test('segment: flat route is one flat segment',()=>{
  const {segs}=analyse(line(5000,()=>20));
  assert.equal(segs.length,1);assert.equal(segs[0].cls,'flat');assert.equal(segs[0].len,5000);
});

test('segment: short bump is absorbed, long climb kept',()=>{
  // 1 km flat, 100 m at 8 %, 1 km flat, 600 m at 5 %, 1 km flat
  const f=d=>d<1000?0:d<1100?(d-1000)*.08:d<2100?8:d<2700?8+(d-2100)*.05:38;
  const {segs}=analyse(line(3700,f));
  assert.deepEqual(segs.map(x=>x.cls),['flat','up','flat']);
  assert.ok(Math.abs(segs[1].len-600)<=70);
});

test('segment: hilly noisy 10 km gives 5–15 segments, none shorter than the minimum',()=>{
  const n=rng(7);
  const s=line(10000,d=>40*Math.sin(2*Math.PI*d/3000)+12*Math.sin(2*Math.PI*d/800)+n(1.5));
  const {segs,dist}=analyse(s);
  assert.ok(segs.length>=5&&segs.length<=15,`got ${segs.length}`);
  segs.forEach(x=>assert.ok(x.len>=DEF.minLen));
  assert.equal(segs[0].d0,0);assert.equal(segs.at(-1).d1,dist);
  for(let i=1;i<segs.length;i++){assert.equal(segs[i].i0,segs[i-1].i1);assert.notEqual(segs[i].cls,segs[i-1].cls)}
});

test('segment: route shorter than the minimum is a single segment',()=>{
  assert.equal(analyse(line(200,d=>d*0.1)).segs.length,1);
});
