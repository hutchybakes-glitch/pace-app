import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMatcher} from '../js/match.js';

const M=1/111195,LAT=51,K=Math.cos(LAT*Math.PI/180);
// Route from a list of [east,north] metre waypoints, sampled every 10 m
function route(way){
  const pts=[];let d=0;
  for(let w=1;w<way.length;w++){
    const [x0,y0]=way[w-1],[x1,y1]=way[w],L=Math.hypot(x1-x0,y1-y0);
    for(let s=w===1?0:10;s<=L;s+=10)pts.push({d:d+s,x:x0+(x1-x0)*s/L,y:y0+(y1-y0)*s/L});
    d+=L;
  }
  return pts.map(p=>({d:p.d,lat:LAT+p.y*M,lon:p.x*M/K}));
}
const at=(x,y)=>[LAT+y*M,x*M/K];
const near=(a,b,e=1)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);

test('straight route: matched distance follows position, sideways error ignored',()=>{
  const m=createMatcher(route([[0,0],[0,2000]]));
  let r;
  for(let y=0;y<=1000;y+=50)r=m.update(...at(15,y),y);
  near(r.d,1000);assert.equal(r.off,false);near(r.err,15);
});

test('out-and-back: outbound stays outbound, return leg counts up past the turn',()=>{
  const m=createMatcher(route([[0,0],[0,1000],[8,1000],[8,0]])); // 8 m apart, out and back
  const seq=[];
  for(let y=0;y<=1000;y+=20)seq.push([0,y]);
  for(let y=1000;y>=0;y-=20)seq.push([8,y]);
  let g=0,prev=null,out=[];
  for(const [x,y] of seq){if(prev)g+=Math.hypot(x-prev[0],y-prev[1]);prev=[x,y];out.push(m.update(...at(x,y),g).d)}
  near(out[20],400);                        // 400 m out, not 1608 m back
  near(out.at(-1),2008);                    // finish, not start
  for(let i=1;i<out.length;i++)assert.ok(out[i]>=out[i-1]-1,'never jumps back');
});

test('loop: first fix at the shared start/finish snaps to the start',()=>{
  const m=createMatcher(route([[0,0],[500,0],[500,500],[0,500],[0,0]]));
  near(m.update(...at(2,3),0).d,2,3);
});

test('off route: banner state and GPS fallback, then re-snap',()=>{
  const m=createMatcher(route([[0,0],[0,2000]]));
  m.update(...at(0,0),0);m.update(...at(0,300),300);
  let r=m.update(...at(60,350),360);       // 60 m away
  assert.equal(r.off,true);near(r.d,360);
  r=m.update(...at(80,500),520);
  assert.equal(r.off,true);near(r.d,520);
  r=m.update(...at(5,600),640);             // back on the route
  assert.equal(r.off,false);near(r.d,600);
});

test('not on the route yet: falls back to GPS distance, then matches the start',()=>{
  const m=createMatcher(route([[0,0],[0,1000]]));
  let r=m.update(...at(-200,0),0);
  assert.equal(r.off,true);assert.equal(r.matched,false);
  r=m.update(...at(-100,0),100);near(r.d,100);
  r=m.update(...at(-5,10),195);
  assert.equal(r.off,false);near(r.d,10);
});

test('GPS gap: a jump within the window still matches',()=>{
  const m=createMatcher(route([[0,0],[0,2000]]));
  m.update(...at(0,100),100);
  near(m.update(...at(0,350),350).d,350);
});

test('seed: carries on from a saved position instead of searching from the start',()=>{
  const m=createMatcher(route([[0,0],[0,1000],[8,1000],[8,0]]));
  m.seed(1500,1500);
  near(m.update(...at(8,480),1520).d,1528);   // return leg, not the outbound 480 m
});
