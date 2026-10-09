// GPS: fix filtering, distance, km splits and rolling pace. No DOM access, so it can be tested in node.
export const WINDOW=30000; // current pace = last 30 s of movement

// Great-circle distance in metres
export function hav(a,b){const r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lon-a.lon)*r;
  const h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(h))}

// Track state: metres, last GPS point, rolling points, km split times (elapsed ms)
export function createTrack(){
  const s={dist:0,last:null,pts:[],splits:[]};
  // c = coords, ts = fix timestamp, el = pause-aware elapsed ms now. True if the fix was used.
  s.add=(c,ts,el)=>{
    if(c.accuracy>25)return false;                 // ignore poor fixes
    const q={lat:c.latitude,lon:c.longitude,t:ts};
    if(!s.last){s.last=q;s.pts.push({t:el,d:s.dist});return true}
    const d=hav(s.last,q);
    if(d<3)return false;                           // GPS jitter while standing
    if(d/Math.max((q.t-s.last.t)/1000,1)>10){s.last=q;return false} // >36 km/h = glitch
    s.dist+=d;s.last=q;
    s.pts.push({t:el,d:s.dist});
    while(s.dist>=(s.splits.length+1)*1000)s.splits.push(el); // km split times
    return true;
  };
  // Drop points older than win ms; returns {sec,km} covered since the oldest kept point, or null
  s.rolling=(t,win=WINDOW)=>{
    s.pts=s.pts.filter(p=>t-p.t<=win);
    const o=s.pts[0];
    return o?{sec:(t-o.t)/1000,km:(s.dist-o.d)/1000}:null;
  };
  s.reset=()=>{s.dist=0;s.last=null;s.pts=[];s.splits=[]};
  return s;
}

// Pace (s/km) from a least-squares fit of distance against time over pts [{t ms, d m}].
// Less jumpy than first-to-last point. Null if under 3 points, spanning under minMs, or slower than 30:00/km.
export function fitPace(pts,minMs=10000){
  if(pts.length<3||pts.at(-1).t-pts[0].t<minMs)return null;
  const n=pts.length,tm=pts.reduce((a,p)=>a+p.t,0)/n,dm=pts.reduce((a,p)=>a+p.d,0)/n;
  let sx=0,sy=0;for(const p of pts){sx+=(p.t-tm)*(p.d-dm);sy+=(p.t-tm)**2}
  const v=sx/sy*1000; // m/s
  return v>1000/1800?1000/v:null;
}

// Pace (s/km) from the mean of GPS-reported (Doppler) speeds over pts [{t ms, v m/s}]: accurate enough
// reading by reading to average over just a few seconds. Null if under 2 readings spanning minMs.
export function speedPace(pts,minMs=10000){
  if(pts.length<2||pts.at(-1).t-pts[0].t<minMs)return null;
  const v=pts.reduce((a,p)=>a+p.v,0)/pts.length;
  return v>1000/1800?1000/v:null;
}

export const watch=(onPos,onErr)=>navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:0});

// Smooths running speed for display: an exponential average with time constant tau (s), so a steady
// change shows within a few seconds while single wild readings (GPS jumps, tree cover) barely register.
// A reading more than 35 % away from the smoothed speed counts a sixth as much, unless 3 in a row agree.
export function createSmoother(tau=6){
  let v=null,last=0,odd=0;
  return {
    update(raw,tMs){
      if(raw==null||!isFinite(raw))return v;
      if(v==null){v=raw;last=tMs;return v}
      const dt=Math.max(0,(tMs-last)/1000);last=tMs;
      const far=Math.abs(raw-v)>0.35*v;odd=far?odd+1:0;
      const k=(1-Math.exp(-dt/tau))*(far&&odd<3?1/6:1);
      v+=(raw-v)*k;
      return v;
    },
    get value(){return v},
    reset(){v=null;odd=0},
  };
}
