// Simulated run for desk testing: open with ?sim=1. The runner follows the pacer's pace along the
// selected route with a gentle wobble, surges and fades (so the gap moves), and GPS noise, on a
// sped-up clock. With the start gate on, they jog in from 150 m behind the start line.
//   &speed=10   clock multiplier (default 10)
//   &pace=4:30  constant pace instead of following the pacer
//   &detour=3   at this km, a 300 m detour up to 70 m off the route
import {paceAt} from './pacer.js';

const q=new URLSearchParams(location.search);
export const SIM=q.has('sim');
export const SPEED=SIM?Math.max(1,+q.get('speed')||10):1;
const PACE=(()=>{const m=(q.get('pace')||'').match(/^(\d+):(\d\d)$/);return m?+m[1]*60+ +m[2]:null})();
const DETOUR=+q.get('detour')*1000||null;

const T0=Date.now();
export const now=()=>SIM?T0+(Date.now()-T0)*SPEED:Date.now();
export const every=(ms,fn)=>setInterval(fn,ms/SPEED);

// Set by the app: moving, restart (back to the start), jump (put the runner at this route distance;
// negative = behind the start line)
export const sim={moving:false,restart:false,jump:null};

// Stand-in for gps.watch. getRun() → {route, P} or null. One fix per simulated second.
export function simWatch(getRun,onPos,onErr){
  let seed=7,nx=0,ny=0,d=0,mt=0,lastT=now(),pts=null,wob=0;
  const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
  return setInterval(()=>{
    const t=now(),dt=(t-lastT)/1000,r=getRun();lastT=t;
    if(!r)return onErr({message:'Sim: choose a route first'});
    if(r.route.pts!==pts||sim.restart){pts=r.route.pts;d=0;sim.restart=false;mt=0}
    if(sim.jump!=null){d=sim.jump;sim.jump=null}
    const total=pts.at(-1).d;
    let v=0;
    if(sim.moving&&d<total){
      // surge 4 % for 40 s every 3 min, fade 4 % for 40 s at the half-way point of each cycle
      const ph=mt%180,mult=d<0?1:(ph<40?0.96:ph>=90&&ph<130?1.04:1);
      wob=0.95*wob+0.05*gauss()*0.06;
      const base=PACE||paceAt(r.P,Math.max(0,d));
      v=1000/(base*mult*(1+wob));d=Math.min(total,d+dt*v);if(d>=0)mt+=dt;
    }
    let i=0,lo=0,hi=pts.length-2;while(lo<=hi){const m=(lo+hi)>>1;if(pts[m].d<=Math.max(0,d)){i=m;lo=m+1}else hi=m-1}
    const a=d<0?pts[0]:pts[i],b=d<0?pts.find(p=>p.d>=20)||pts.at(-1):pts[i+1]||pts[i],k=Math.cos(a.lat*Math.PI/180);
    const ex=(b.lon-a.lon)*k,ny0=b.lat-a.lat,L=Math.hypot(ex,ny0)||1;
    let lat,lon;
    if(d<0){lat=a.lat+ny0/L*d/111195;lon=a.lon+ex/L*d/(111195*k)}
    else{const f=b.d>a.d?(d-a.d)/(b.d-a.d):0;lat=a.lat+(b.lat-a.lat)*f;lon=a.lon+(b.lon-a.lon)*f}
    const heading=(Math.atan2(ex,ny0)*180/Math.PI+360)%360;
    const off=DETOUR&&d>=DETOUR&&d<DETOUR+300?70*Math.sin(Math.PI*(d-DETOUR)/300):0;
    nx=0.8*nx+0.8*gauss();ny=0.8*ny+0.8*gauss();
    lat+=((ex/L)*off+ny)/111195;lon+=((-ny0/L)*off+nx)/(111195*k);
    onPos({coords:{latitude:lat,longitude:lon,accuracy:5,speed:Math.max(0,v*(1+0.03*gauss())),heading:v?heading:null},timestamp:t});
  },1000/SPEED);
}
