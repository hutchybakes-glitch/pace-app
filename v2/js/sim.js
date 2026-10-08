// Simulated run for desk testing: open with ?sim=1. The runner follows the pacer's pace along the
// selected route with a gentle wobble, surges and fades (so the gap moves), and GPS noise, on a
// sped-up clock. With the start gate on, they jog in from 150 m behind the start line.
//   &speed=10   clock multiplier (default 10)
//   &pace=4:30  constant pace instead of following the pacer
//   &detour=3   at this km, a 300 m detour up to 70 m off the route
//   &cut=2200-2800  at 2200 m along the route, carry on from 2800 m (turning back early on an out-and-back)
//   &over=2500:150  at 2500 m, run 150 m straight on past the route and back (overshooting a turnaround)
//   &beyond=1   keep running straight on past the finish (to make up a shortened course)
// The Home screen's Sim scenario (sim.scenario) shapes the race: see SCENARIOS.
import {paceAt} from './pacer.js';

const q=new URLSearchParams(typeof location!=='undefined'?location.search:'');
export const SIM=q.has('sim');
export const SPEED=SIM?Math.max(1,+q.get('speed')||10):1;
const PACE=(()=>{const m=(q.get('pace')||'').match(/^(\d+):(\d\d)$/);return m?+m[1]*60+ +m[2]:null})();
const DETOUR=+q.get('detour')*1000||null;
const CUT=(q.get('cut')||'').split('-').map(Number).filter(x=>x>0),OVER=(q.get('over')||'').split(':').map(Number).filter(x=>x>0),BEYOND=q.has('beyond');

const T0=Date.now();
export const now=()=>SIM?T0+(Date.now()-T0)*SPEED:Date.now();
export const every=(ms,fn)=>setInterval(fn,ms/SPEED);

// Set by the app: moving, restart (back to the start), jump (put the runner at this route distance;
// negative = behind the start line)
// v: the runner's current speed (m/s), for the synthetic accelerometer in motion.js
export const sim={moving:false,restart:false,jump:null,scenario:'steady',v:0};

// Sim scenarios: the runner's pace as a multiple of the pacer's pace at the same spot (so terrain still
// counts), by fraction of the route: [[from, multiplier], …] (< 1 = quicker). Phases blend over ±4 %
// of the route. 'steady' instead follows the pacer with short surges and fades.
export const SCENARIOS=[
  {id:'steady',name:'Steady with surges',desc:'Stays with the pacer, with short surges and fades'},
  {id:'race',name:'Fast start, fade, comeback',desc:'Goes off quick and builds a lead, fades so the pacer overtakes and gets away, then comes back to retake the lead near the end',
   phases:[[0,0.94],[0.15,1],[0.3,1.06],[0.5,1.04],[0.65,0.95],[0.85,0.99]]},
  {id:'negative',name:'Slow start, strong finish',desc:'Starts easy and lets the pacer go, then reels it in over the last third',
   phases:[[0,1.04],[0.4,1],[0.7,0.95]]},
  {id:'blowup',name:'Blow-up',desc:'Flies off quick, then fades badly over the second half while the pacer drops you',
   phases:[[0,0.95],[0.3,1],[0.6,1.08]]},
];
// Multiplier at fraction f of the route for a scenario with phases (null for 'steady')
export function scenarioMult(id,f){
  const ph=SCENARIOS.find(x=>x.id===id)?.phases;if(!ph)return null;
  const val=x=>{let m=ph[0][1];for(const [a,v] of ph)if(x>=a)m=v;return m};
  let sum=0;for(let k=-4;k<=4;k++)sum+=val(f+k*0.01);  // blend phases over ±4 % of the route
  return sum/9;
}

// Stand-in for gps.watch. getRun() → {route, P} or null. One fix per simulated second.
export function simWatch(getRun,onPos,onErr){
  let seed=7,nx=0,ny=0,d=0,mt=0,lastT=now(),pts=null,wob=0,cutDone=false,ov=null; // ov: metres into an overshoot
  const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-9))*Math.cos(2*Math.PI*rnd());
  return setInterval(()=>{
    const t=now(),dt=(t-lastT)/1000,r=getRun();lastT=t;
    if(!r)return onErr({message:'Sim: choose a route first'});
    if(r.route.pts!==pts||sim.restart){pts=r.route.pts;d=0;sim.restart=false;mt=0;cutDone=false;ov=null}
    if(sim.jump!=null){d=sim.jump;sim.jump=null}
    const total=pts.at(-1).d;
    let v=0;
    if(sim.moving&&(d<total||ov!=null||BEYOND)){
      // steady: surge 4 % for 40 s every 3 min, fade 4 % for 40 s half-way through each cycle;
      // other scenarios: their phase multiplier, with only a small wobble
      const ph=mt%180,story=d<0?null:scenarioMult(sim.scenario,d/total);
      const mult=d<0?1:story??(ph<40?0.96:ph>=90&&ph<130?1.04:1);
      wob=0.95*wob+0.05*gauss()*(story?0.03:0.06);
      const base=PACE||paceAt(r.P,Math.max(0,d));
      v=1000/(base*mult*(1+wob));
      if(ov!=null){ov+=dt*v;if(ov>=2*OVER[1])ov=-1}       // out past the route and back
      else d=Math.min(total,d+dt*v);
      if(ov===-1){ov=null;OVER.length=0}
      if(CUT.length===2&&!cutDone&&d>=CUT[0]){d=CUT[1];cutDone=true}
      if(OVER.length===2&&ov==null&&d>=OVER[0]){d=OVER[0];ov=0}
      if(BEYOND&&ov==null&&d>=total){OVER[0]=total;OVER[1]=1e6;ov=0}
      if(d>=0)mt+=dt;
    }
    sim.v=v;
    let i=0,lo=0,hi=pts.length-2;while(lo<=hi){const m=(lo+hi)>>1;if(pts[m].d<=Math.max(0,d)){i=m;lo=m+1}else hi=m-1}
    const a=d<0?pts[0]:pts[i],b=d<0?pts.find(p=>p.d>=20)||pts.at(-1):pts[i+1]||pts[i],k=Math.cos(a.lat*Math.PI/180);
    const ex=(b.lon-a.lon)*k,ny0=b.lat-a.lat,L=Math.hypot(ex,ny0)||1;
    let lat,lon;
    if(d<0){lat=a.lat+ny0/L*d/111195;lon=a.lon+ex/L*d/(111195*k)}
    else{const f=b.d>a.d?(d-a.d)/(b.d-a.d):0;lat=a.lat+(b.lat-a.lat)*f;lon=a.lon+(b.lon-a.lon)*f}
    const heading=(Math.atan2(ex,ny0)*180/Math.PI+360)%360;
    const off=DETOUR&&d>=DETOUR&&d<DETOUR+300?70*Math.sin(Math.PI*(d-DETOUR)/300):0;
    if(ov!=null){ // straight on past the route, the way you were heading just before it
      const j=Math.max(1,Math.min(pts.length-1,Math.round(OVER[0]/10))),p0=pts[j-1],p1=pts[j],dx=(p1.lon-p0.lon)*k,dy=p1.lat-p0.lat,l=Math.hypot(dx,dy)||1;
      const o=ov<OVER[1]?ov:2*OVER[1]-ov;lat=p1.lat+(dy/l)*o/111195;lon=p1.lon+(dx/l)*o/(111195*k);
    }
    nx=0.8*nx+0.8*gauss();ny=0.8*ny+0.8*gauss();
    lat+=((ex/L)*off+ny)/111195;lon+=((-ny0/L)*off+nx)/(111195*k);
    onPos({coords:{latitude:lat,longitude:lon,accuracy:5,speed:Math.max(0,v*(1+0.03*gauss())),heading:v?heading:null},timestamp:t});
  },1000/SPEED);
}
