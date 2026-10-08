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

// ---- Going wrong on the course: cutting a bit off, overshooting, wandering off ----
import {createCourse} from '../../v2/js/course.js';
import {timeAt as tAt} from '../../v2/js/pacer.js';

// Run a path given as a list of route distances to visit (straight between them, along the route's
// line), or off-route points {off:[dx,dy]} in metres relative to the route point at `d`
function runPath(pts,legs){
  const m=createMatcher(pts),R=111195,k=Math.cos(pts[0].lat*Math.PI/180)*R,out=[];
  const pos=d=>{const i=Math.max(0,Math.min(pts.length-2,Math.floor(d/10))),a=pts[i],b=pts[i+1],f=Math.max(0,Math.min(1,(d-a.d)/((b.d-a.d)||1)));return [(a.lon+(b.lon-a.lon)*f-pts[0].lon)*k,(a.lat+(b.lat-a.lat)*f-pts[0].lat)*R]};
  let g=0,prev=null;
  const at=(x,y)=>{if(prev)g+=Math.hypot(x-prev[0],y-prev[1]);prev=[x,y];
    const r=m.update(pts[0].lat+(y+2*gauss())/R,pts[0].lon+(x+2*gauss())/k,g);out.push({g,...r,event:r.event});};
  for(const L of legs){
    const [x0,y0]=prev||pos(L.from),[x1,y1]=L.to!=null?pos(L.to):[pos(L.d)[0]+L.off[0],pos(L.d)[1]+L.off[1]];
    const len=Math.hypot(x1-x0,y1-y0),n=Math.max(1,Math.round(len/3.3));
    if(L.via!=null){ // along the route from one distance to another
      const dir=L.to>=L.from?1:-1;for(let d=L.from;dir>0?d<=L.to:d>=L.to;d+=3.3*dir)at(...pos(d));
    }else for(let s=1;s<=n;s++)at(x0+(x1-x0)*s/n,y0+(y1-y0)*s/n);
  }
  return {m,out,g};
}
const turn=2500; // the out-and-back's turnaround (route distance)

test('repeat: turning back 300 m early on an out-and-back is a shortcut of about 600 m',()=>{
  const pts=load('outback-hill.gpx');
  // run out to 2200 m, then back along the same road to the finish
  const {out}=runPath(pts,[{from:0,to:turn-300,via:1},{from:turn+300,to:2*turn,via:1}]);
  const ev=out.map(o=>o.event).filter(Boolean);
  assert.equal(ev.length,1,JSON.stringify(ev));assert.equal(ev[0].kind,'skip');
  assert.ok(Math.abs(ev[0].len-600)<60,`skipped ${ev[0].len}`);
  assert.ok(out.at(-1).d>2*turn-30,'carries on to the finish');
});

test('repeat: overshooting the turnaround by 150 m and coming back is 300 m extra',()=>{
  const pts=load('outback-hill.gpx');
  const {out}=runPath(pts,[{from:0,to:turn,via:1},{d:turn,off:[0.6*150,0.8*150]},{to:turn+2},{from:turn+2,to:2*turn,via:1}]);
  const ev=out.map(o=>o.event).filter(Boolean);
  assert.equal(ev.length,1,JSON.stringify(ev));assert.equal(ev[0].kind,'extra');
  assert.ok(Math.abs(ev[0].len-300)<45,`extra ${ev[0].len}`);
  // and while off it, the course position stayed put and the way back was known
  const offs=out.filter(o=>o.off);assert.ok(offs.length>10);
  assert.ok(offs.every(o=>Math.abs(o.d-turn)<30));assert.ok(offs.at(-1).rejoin.dist<60);
  assert.ok(Math.max(...offs.map(o=>o.offDist))>100);
});

test('repeat: three laps, cutting a corner of lap 2: the skip, not a lap jump',()=>{
  const pts=load('three-laps.gpx');
  // lap 2 (1200–2400): from 1600 cut diagonally to 1800 (corner at 1800-1200=600 → 400 m along, 200 across)
  const {out}=runPath(pts,[{from:0,to:1550,via:1},{d:1750,off:[0,0]},{from:1750,to:3600,via:1}]);
  const ev=out.map(o=>o.event).filter(Boolean);
  assert.equal(ev.filter(e=>e.kind==='skip').length,1,JSON.stringify(ev));
  assert.ok(out.at(-1).d>3550);
});

test('course: the pacer skips what you skipped; your distance is what you ran',()=>{
  const pts=load('outback-hill.gpx'),P=buildPacer(pts,30*60,PROFILES[0]),c=createCourse(P);
  c.add({kind:'skip',from:2300,to:2700,len:400});
  assert.equal(c.skipped,400);
  assert.ok(Math.abs(c.ran(3000)-2600)<1);
  assert.ok(Math.abs(c.pacerT(3000)-(tAt(P,3000)-(tAt(P,2700)-tAt(P,2300))))<0.01);
  // pacer's position: jumps over the skipped part
  const t=c.pacerT(2300)+1;assert.ok(c.pacerD(t)>2700&&c.pacerD(t)<2710,`${c.pacerD(t)}`);
  assert.ok(Math.abs(c.routeAt(2600)-3000)<1);
  c.add({kind:'extra',at:3200,len:150});
  assert.ok(Math.abs(c.ran(3500)-3250)<1);
  assert.ok(Math.abs(c.routeAt(3250)-3500)<1);
  const again=createCourse(P,JSON.parse(JSON.stringify(c)));assert.equal(again.skipped,400);assert.equal(again.extra,150);
});
