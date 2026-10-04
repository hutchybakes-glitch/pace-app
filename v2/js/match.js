// Match: snap GPS fixes to distance along the resampled route.
// back/ahead = search window (m) around the expected position, off = max distance (m) from the route,
// jump = metres of sideways error worth one metre of jumping along the route away from where GPS distance
// says you should be (keeps you on the outbound leg when the return leg runs alongside it).
export const MDEF={back:50,ahead:300,off:40,jump:0.1};

// pts = resampled route [{d,lat,lon}]. update(lat,lon,gpsDist) returns {d,off,err,matched}:
// d is route distance when on route, else last matched d + GPS distance since then.
export function createMatcher(pts,o={}){
  o={...MDEF,...o};
  const R=111195,lat0=pts[0].lat,lon0=pts[0].lon,k=Math.cos(lat0*Math.PI/180)*R;
  const P=pts.map(p=>({x:(p.lon-lon0)*k,y:(p.lat-lat0)*R,d:p.d})),last=P.length-2,total=P.at(-1).d;
  // Nearest point to (x,y) on the leg from P[i] to P[i+1]
  const near=(x,y,i)=>{
    const a=P[i],b=P[i+1],vx=b.x-a.x,vy=b.y-a.y,L=vx*vx+vy*vy;
    const t=L?Math.max(0,Math.min(1,((x-a.x)*vx+(y-a.y)*vy)/L)):0;
    return {err:Math.hypot(a.x+t*vx-x,a.y+t*vy-y),d:a.d+t*(b.d-a.d)};
  };
  const leg=d=>{let lo=0,hi=last;while(lo<hi){const m=(lo+hi+1)>>1;if(P[m].d<=d)lo=m;else hi=m-1}return lo};
  let lastD=0,lastG=0;
  const m={d:0,off:false,err:0,matched:false,total};
  m.update=(lat,lon,g)=>{
    const x=(lon-lon0)*k,y=(lat-lat0)*R,e=lastD+(g-lastG);let best=null;
    if(!m.matched){
      // First match: the earliest pass within range, so a loop's start isn't mistaken for its finish
      for(let i=0;i<=last;i++){const c=near(x,y,i);if(c.err<=o.off){if(!best||c.err<best.err)best=c}else if(best)break}
    }else{
      // Only search a forward window, and among points within range prefer the one that continues
      // smoothly from the last match: a return leg a few metres away but 260 m further on loses
      for(let i=leg(e-o.back),j=leg(e+o.ahead);i<=j;i++){
        const c=near(x,y,i);c.cost=c.err+o.jump*Math.abs(c.d-e);
        if(!best||(c.err<=o.off)>(best.err<=o.off)||(c.err<=o.off)===(best.err<=o.off)&&c.cost<best.cost)best=c;
      }
    }
    if(best&&best.err<=o.off){m.matched=true;lastD=best.d;lastG=g;Object.assign(m,{d:best.d,off:false,err:best.err})}
    else Object.assign(m,{d:Math.min(total,e),off:true,err:best?best.err:Infinity});
    return m;
  };
  // Carry on from a known position (resuming a saved run): d = route distance, g = GPS distance then
  m.seed=(d,g)=>{lastD=d;lastG=g;Object.assign(m,{d,off:false,err:0,matched:true})};
  return m;
}
