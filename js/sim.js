// Simulated run for desk testing: open with ?sim=1. Replays the selected route with GPS noise
// and deliberate surges, on a sped-up clock.
//   &speed=10   clock multiplier (default 10)
//   &pace=4:30  constant pace; default follows the plan's segment targets
//   &detour=3   at this km, run a 300 m detour up to 70 m off the route
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

export const sim={moving:false,resumeAt:null}; // set by the app: start/pause, and route distance to resume from

// Stand-in for gps.watch. getRun() → {route,plan} or null. Emits one fix per simulated second.
export function simWatch(getRun,onPos,onErr){
  let seed=1,nx=0,ny=0,d=0,mt=0,lastT=now(),pts=null;
  const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
  return setInterval(()=>{
    const t=now(),dt=(t-lastT)/1000,r=getRun();lastT=t;
    if(!r)return onErr({message:'Sim: select a route on the Setup screen first'});
    if(r.route.pts!==pts){pts=r.route.pts;d=sim.resumeAt||0;sim.resumeAt=null;mt=0}
    const total=pts.at(-1).d;
    if(sim.moving&&d<total){
      const ph=mt%240,mult=ph<30?0.85:ph>=120&&ph<150?1.15:1;
      const base=PACE||r.plan.segs[segAt(r.plan.segs,d)].target;
      d=Math.min(total,d+dt*1000/(base*mult));mt+=dt;
    }
    // Interpolate position at d, heading for the detour offset
    let i=0,lo=0,hi=pts.length-2;while(lo<=hi){const m=(lo+hi)>>1;if(pts[m].d<=d){i=m;lo=m+1}else hi=m-1}
    const a=pts[i],b=pts[i+1]||a,f=b.d>a.d?(d-a.d)/(b.d-a.d):0,k=Math.cos(a.lat*Math.PI/180);
    let lat=a.lat+(b.lat-a.lat)*f,lon=a.lon+(b.lon-a.lon)*f;
    const ex=(b.lon-a.lon)*k,ny0=b.lat-a.lat,L=Math.hypot(ex,ny0)||1;
    const off=DETOUR&&d>=DETOUR&&d<DETOUR+300?70*Math.sin(Math.PI*(d-DETOUR)/300):0;
    nx=0.8*nx+0.8*gauss();ny=0.8*ny+0.8*gauss();                      // correlated GPS noise, ~1.3 m
    lat+=((ex/L)*off+ny)/111195;lon+=((-ny0/L)*off+nx)/(111195*k);    // detour to the left of travel
    onPos({coords:{latitude:lat,longitude:lon,accuracy:5},timestamp:t});
  },1000/SPEED);
}
