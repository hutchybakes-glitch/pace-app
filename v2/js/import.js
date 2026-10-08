// A run from someone's GPX (Strava, Garmin, …) to race: every point's time gives the pace all the way
// round. Turned into the same shape as a run recorded in the app, so it can be raced as a past run.
import {createMatcher} from './match.js';

const R=111195;
const dist=(a,b)=>{const k=Math.cos(a.lat*Math.PI/180);return Math.hypot((b.lon-a.lon)*k*R,(b.lat-a.lat)*R)};

// Does this GPX have times? (nearly every point, spanning at least a minute)
export const hasTimes=pts=>{const t=pts.filter(p=>p.t!=null);return t.length>=Math.max(10,pts.length*0.8)&&t.at(-1).t-t[0].t>=60000};

// Pauses: a gap of more than PAUSE_S with less than PAUSE_M moved (a watch's auto-pause, or a stop) is
// taken out, so the run races at its moving pace
export const PAUSE_S=20,PAUSE_M=25;

// raw: [{lat, lon, ele, t (ms), cad (spm) | null}]; route: the resampled route it was run on.
// Returns {started, fixes, rsplits (ms at each km), elapsed (ms), rd (route m), dist (m), paused (ms),
// complete} with fixes in the app's shape: [ts, t ms, lat, lon, acc, gpsD, rd, pace s/km, cadence, stride, ran]
export function importRun(raw,route){
  const pts=raw.filter(p=>p.t!=null).sort((a,b)=>a.t-b.t);
  const m=createMatcher(route);let g=0,paused=0,v=3;const F=[]; // v: recent running speed (m/s)
  for(let i=0;i<pts.length;i++){
    const p=pts[i],q=pts[i-1];
    if(q){
      const step=dist(q,p),gap=(p.t-q.t)/1000;
      // a pause: take out the time beyond what that bit would have taken at your recent speed
      if(gap>PAUSE_S&&step<PAUSE_M)paused+=Math.max(0,(gap-step/v)*1000);
      else if(gap>0&&step>0)v=0.8*v+0.2*Math.min(8,Math.max(0.5,step/gap));
      g+=step;
    }
    const t=p.t-pts[0].t-paused,r=m.update(p.lat,p.lon,g);
    F.push([p.t,t,p.lat,p.lon,5,g,r.d,null,p.cad??null,null,g]);
  }
  // Pace (s/km) over ±5 points, and stride from cadence where there is one
  for(let i=0;i<F.length;i++){
    const a=F[Math.max(0,i-5)],b=F[Math.min(F.length-1,i+5)],dd=b[5]-a[5],dt=(b[1]-a[1])/1000;
    F[i][7]=dd>5?Math.round(dt/(dd/1000)):null;
    if(F[i][8]&&dd>5){const st=(dd/dt)/(F[i][8]/60);F[i][9]=st>=0.4&&st<=2.5?+st.toFixed(2):null}
  }
  // Splits: the time at each km along the route
  const rsplits=[];
  for(let i=1;i<F.length;i++){
    while(F[i][6]>=(rsplits.length+1)*1000&&F[i-1][6]<(rsplits.length+1)*1000+1e-9){
      const k=(rsplits.length+1)*1000,a=F[i-1],b=F[i],f=b[6]>a[6]?(k-a[6])/(b[6]-a[6]):0;
      rsplits.push(Math.round(a[1]+(b[1]-a[1])*f));
    }
  }
  const total=route.at(-1).d,rd=Math.max(...F.map(f=>f[6]));
  return {started:pts[0].t,fixes:F,rsplits,elapsed:F.at(-1)[1],rd,dist:Math.round(g),paused,complete:rd>=total-50};
}

// A saved route this GPX was run on: same length (±3 %) and the same start, middle and finish (±80 m)
export function sameRoute(routes,pts){
  const D=pts.at(-1).d,mid=pts[Math.floor(pts.length/2)];
  return routes.find(r=>{const E=r.pts.at(-1).d;if(Math.abs(E-D)>D*0.03)return false;
    return dist(r.pts[0],pts[0])<80&&dist(r.pts.at(-1),pts.at(-1))<80&&dist(r.pts[Math.floor(r.pts.length/2)],mid)<80})||null;
}
