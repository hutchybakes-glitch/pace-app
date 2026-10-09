// Start gate: before a route run's clock starts, guide the runner to the route's start and start the
// clock as they cross the start line, back-dated to the moment of crossing (like a chip mat).
// Positions are measured against the line through the start, square to the route's first 20 m:
// a = metres past the start line (negative = behind it), off = metres to the side of the route.
//   zone   within this of the start point = "at the start"
//   maxAcc ignore fixes worse than this (m)
//   go     the clock starts on the 2nd fix in a row this far past the line, having been at or
//          behind it (a ≤ near) — one jumpy fix while standing at the line can't start it
export const GDEF={zone:25,maxAcc:20,go:10,near:5};

// update(lat,lon,acc,ts) → {state, dist, bearing, a, acc, crossTs?}. States:
//   weak  GPS not accurate enough yet       far   more than zone from the start
//   ready in the zone, at or behind the line  past  in the zone but arrived already over the line
//   crossing  just went over the line from behind (go follows on the next fix past it)
//   go    crossed: crossTs = timestamp the line was crossed
export function createStartGate(pts,o={}){
  o={...GDEF,...o};
  const R=111195,lat0=pts[0].lat,lon0=pts[0].lon,k=Math.cos(lat0*Math.PI/180)*R;
  const ref=pts.find(p=>p.d>=20)||pts.at(-1),rx=(ref.lon-lon0)*k,ry=(ref.lat-lat0)*R,L=Math.hypot(rx,ry)||1;
  const ux=rx/L,uy=ry/L; // route direction at the start
  let inZone=false,hist=[],streak=0;
  return {update(lat,lon,acc,ts){
    const x=(lon-lon0)*k,y=(lat-lat0)*R,a=x*ux+y*uy,off=Math.abs(x*uy-y*ux),dist=Math.hypot(x,y);
    const bearing=(Math.atan2(-x,-y)*180/Math.PI+360)%360; // from the runner to the start, ° from north
    const out={dist,bearing,a,acc};
    if(acc>o.maxAcc)return {...out,state:'weak'};
    if(!inZone&&dist<=o.zone)inZone=true;
    if(inZone&&dist>2*o.zone&&a<o.go){inZone=false;hist=[];streak=0} // wandered well away again
    if(!inZone)return {...out,state:'far'};
    hist.push({a,ts});if(hist.length>300)hist.shift();
    streak=a>=o.go&&off<=o.zone?streak+1:0;
    if(streak>=2){
      const i=hist.findLastIndex(h=>h.a<=0);
      if(i>=0&&i<hist.length-1){const h0=hist[i],h1=hist[i+1];return {...out,state:'go',crossTs:h0.ts+(0-h0.a)/(h1.a-h0.a)*(h1.ts-h0.ts)}}
      const j=hist.findLastIndex(h=>h.a<=o.near);
      if(j>=0)return {...out,state:'go',crossTs:hist[j].ts};
    }
    return {...out,state:a<=o.near?'ready':hist.some(h=>h.a<=o.near)?'crossing':'past'};
  }};
}

// 8-point compass name for a bearing
export const compass=b=>['north','north-east','east','south-east','south','south-west','west','north-west'][Math.round(b/45)%8];
