// Routes that cover the same road more than once: an out-and-back up a hill, and three laps
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGPX,resample} from '../../v2/js/route.js';
import {createMatcher} from '../../v2/js/match.js';
import {buildPacer,paceAt,PROFILES} from '../../v2/js/pacer.js';

const load=f=>resample(parseGPX(fs.readFileSync(new URL('../fixtures/'+f,import.meta.url),'utf8')).pts);
let seed=5;const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());

// Run the route at 3.3 m/s with a fix a second, GPS noise ~6 m, GPS distance off by up to 3 %
function run(pts){
  const m=createMatcher(pts),total=pts.at(-1).d,out=[];let nx=0,ny=0;
  for(let d=0;d<=total;d+=3.3){
    const i=Math.min(pts.length-2,Math.floor(d/10)),a=pts[i],b=pts[i+1],f=(d-a.d)/((b.d-a.d)||1);
    nx=0.7*nx+2.5*gauss();ny=0.7*ny+2.5*gauss();
    const lat=a.lat+(b.lat-a.lat)*f+ny/111195,lon=a.lon+(b.lon-a.lon)*f+nx/(111195*Math.cos(a.lat*Math.PI/180));
    out.push([d,m.update(lat,lon,d*1.03).d]);
  }
  return out;
}

test('repeat: out-and-back up a hill: the matched distance follows you up and back down',()=>{
  const pts=load('outback-hill.gpx'),res=run(pts),worst=Math.max(...res.map(([d,m])=>Math.abs(d-m)));
  assert.ok(worst<25,`worst ${worst.toFixed(1)} m`);
  // so the target is the climbing pace going up, the descending pace coming down the same road
  const P=buildPacer(pts,30*60,PROFILES[0]),up=res.find(([d])=>d>=1500),down=res.find(([d])=>d>=3500);
  assert.ok(paceAt(P,up[1])>paceAt(P,down[1])+20,`up ${paceAt(P,up[1])} down ${paceAt(P,down[1])}`);
});

test('repeat: three laps: never jumps a lap ahead or back, including at the start/finish line',()=>{
  const pts=load('three-laps.gpx'),res=run(pts),worst=Math.max(...res.map(([d,m])=>Math.abs(d-m)));
  assert.ok(worst<25,`worst ${worst.toFixed(1)} m`);
  assert.ok(res[0][1]<30,'starts on lap 1, not at the finish');
});
