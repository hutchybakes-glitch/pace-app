// Simulated run for desk testing: open with ?sim=1. Replays the selected route with GPS noise
// and deliberate surges, on a sped-up clock.
//   &speed=10   clock multiplier (default 10)
//   &pace=4:30  constant pace; default follows the plan's segment targets
//   &detour=3   at this km, run a 300 m detour up to 70 m off the route
// With the start gate on, the runner jogs in from 150 m behind the start line.
// Surges repeat every 4 min of moving time: 30 s at 15 % faster, then at 2:00, 30 s at 15 % slower.
import {parseTime,segAt} from './pacing.js';

const q=new URLSearchParams(location.search);
export const SIM=q.has('sim');
export const SPEED=SIM?Math.max(1,+q.get('speed')||10):1;
const PACE=parseTime(q.get('pace')||''),DETOUR=+q.get('detour')*1000||null;

// App clock: real time, or sped up in sim mode
const T0=Date.now();
export const now=()=>SIM?T0+(Date.now()-T0)*SPEED:Date.now();
export const every=(ms,fn)=>setInterval(fn,ms/SPEED);

// Set by the app: moving (start/pause), restart (new run: back to the start), jump (put the runner at
// this route distance: negative = that far behind the start line, e.g. -150 to jog in to the start)
export const sim={moving:false,restart:false,jump:null};

// Stand-in for gps.watch. getRun() → {route,plan} or null. Emits one fix per simulated second.
export function simWatch(getRun,onPos,onErr){
  let seed=1,nx=0,ny=0,d=0,mt=0,lastT=now(),pts=null;
  const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
  return setInterval(()=>{
    const t=now(),dt=(t-lastT)/1000,r=getRun();lastT=t;
    if(!r)return onErr({message:'Sim: select a route on the Setup screen first'});
    if(r.route.pts!==pts||sim.restart){pts=r.route.pts;d=0;sim.restart=false;mt=0}
    if(sim.jump!=null){d=sim.jump;sim.jump=null}
    const total=pts.at(-1).d;
    let v=0;
    if(sim.moving&&d<total){
      const ph=mt%240,mult=d<0?1:ph<30?0.85:ph>=120&&ph<150?1.15:1; // no surges before the start
      const base=PACE||r.plan.segs[segAt(r.plan.segs,Math.max(0,d))].target;
      v=1000/(base*mult);d=Math.min(total,d+dt*v);if(d>=0)mt+=dt;
    }
    // Position at d (before the start: back along the first 20 m's direction), and direction of travel
    let i=0,lo=0,hi=pts.length-2;while(lo<=hi){const m=(lo+hi)>>1;if(pts[m].d<=Math.max(0,d)){i=m;lo=m+1}else hi=m-1}
    const a=d<0?pts[0]:pts[i],b=d<0?pts.find(p=>p.d>=20)||pts.at(-1):pts[i+1]||pts[i],k=Math.cos(a.lat*Math.PI/180);
    const ex=(b.lon-a.lon)*k,ny0=b.lat-a.lat,L=Math.hypot(ex,ny0)||1;
    let lat,lon;
    if(d<0){lat=a.lat+ny0/L*d/111195;lon=a.lon+ex/L*d/(111195*k)}
    else{const f=b.d>a.d?(d-a.d)/(b.d-a.d):0;lat=a.lat+(b.lat-a.lat)*f;lon=a.lon+(b.lon-a.lon)*f}
    const heading=(Math.atan2(ex,ny0)*180/Math.PI+360)%360;
    const off=DETOUR&&d>=DETOUR&&d<DETOUR+300?70*Math.sin(Math.PI*(d-DETOUR)/300):0;
    nx=0.8*nx+0.8*gauss();ny=0.8*ny+0.8*gauss();                      // correlated GPS noise, ~1.3 m
    lat+=((ex/L)*off+ny)/111195;lon+=((-ny0/L)*off+nx)/(111195*k);    // detour to the left of travel
    onPos({coords:{latitude:lat,longitude:lon,accuracy:5,speed:Math.max(0,v*(1+0.03*gauss())),heading:v?heading:null},timestamp:t}); // speed ±3 %
  },1000/SPEED);
}
