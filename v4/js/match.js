// Match: snap GPS fixes to distance along the resampled route, and notice when you leave it.
//
// Normally each fix is matched within a window around where you should be (last match + GPS distance
// since), preferring the point that continues smoothly and runs the same way you're running (so on an
// out-and-back the outbound side of the road and the return side are told apart).
//
// When nothing in the window fits (you turned early, cut across, overshot a turnaround, went the wrong
// way), your place on the course freezes and the app knows how far you've run off it. Once fixes fit the
// course again, it looks for the earliest point you could be on (anywhere from just behind your last
// match onwards, running the right way) and, after a few consistent fixes, picks up from there. Comparing
// how far the course moved on with how far you actually ran tells what happened in between:
//   skip  the course moved on further than you ran: part of it was cut off
//   extra you ran further than the course moved on: an overshoot or a detour
//
// back/ahead = normal search window (m); off = max distance (m) from the route; jump = metres of sideways
// error worth one metre of jumping along the route; confirm = consistent fixes needed to pick up again;
// tol = how much (m, or fraction of the gap) a gap may differ from your running before it counts.
export const MDEF={back:50,ahead:300,off:40,jump:0.1,confirm:3,tol:25,tolK:0.05};

// pts = resampled route [{d,lat,lon}]. update(lat,lon,gpsDist) returns
// {d, off, err, matched, offDist, event, rejoin}:
//   d       route distance (frozen at the last match while you're off the course)
//   offDist metres run since the last match while off it (0 when on)
//   event   when you've just picked up the course again: {kind:'skip', from, to, len} or
//           {kind:'extra', at, len}; otherwise null
//   rejoin  while off: the nearest point of the course ahead {d, dist (m), bearing (° from north)}
export function createMatcher(pts,o={}){
  o={...MDEF,...o};
  const R=111195,lat0=pts[0].lat,lon0=pts[0].lon,k=Math.cos(lat0*Math.PI/180)*R;
  const P=pts.map(p=>({x:(p.lon-lon0)*k,y:(p.lat-lat0)*R,d:p.d})),last=P.length-2,total=P.at(-1).d;
  const T=P.slice(0,-1).map((a,i)=>{const b=P[i+1],L=Math.hypot(b.x-a.x,b.y-a.y)||1;return [(b.x-a.x)/L,(b.y-a.y)/L]});
  // Nearest point to (x,y) on the leg from P[i] to P[i+1]
  const near=(x,y,i)=>{
    const a=P[i],b=P[i+1],vx=b.x-a.x,vy=b.y-a.y,L=vx*vx+vy*vy;
    const t=L?Math.max(0,Math.min(1,((x-a.x)*vx+(y-a.y)*vy)/L)):0;
    return {err:Math.hypot(a.x+t*vx-x,a.y+t*vy-y),d:a.d+t*(b.d-a.d),i};
  };
  const leg=d=>{let lo=0,hi=last;while(lo<hi){const m=(lo+hi+1)>>1;if(P[m].d<=d)lo=m;else hi=m-1}return lo};
  // Your direction of travel over the last ~15 m (null when standing or just turned)
  let trail=[];
  const heading=(x,y,g)=>{
    trail.push({x,y,g});while(trail.length>2&&trail[1].g<=g-15)trail.shift();
    const a=trail[0],vx=x-a.x,vy=y-a.y,L=Math.hypot(vx,vy);
    return L>=8&&g-a.g>=8?[vx/L,vy/L]:null;
  };
  const wrongWay=(u,i)=>u&&u[0]*T[i][0]+u[1]*T[i][1]<-0.3;

  let lastD=0,lastG=0,pending=null,stall=0,stallErr=0; // stall: metres run while the course hasn't moved on (at a dead end)
  const m={d:0,off:false,err:0,matched:false,total,offDist:0,event:null,rejoin:null};
  const accept=(c,g)=>{
    const ran=g-lastG,moved=c.d-lastD,tol=Math.max(o.tol,o.tolK*ran);
    m.event=null;
    if(m.matched){
      if(moved>ran+tol)m.event={kind:'skip',from:lastD+ran/2,to:lastD+ran/2+(moved-ran),len:moved-ran};
      else if(moved<ran-tol){stall+=ran-Math.max(0,moved);stallErr=Math.max(stallErr,o.off)} // came back after an overshoot or detour: counted below
      // Running on while the course doesn't move on (past the tip of a turnaround, still within range of
      // it) adds up fix by fix; it counts as extra once you're moving along the course again
      else if(ran>0.5&&moved<0.3*ran){stall+=ran-Math.max(0,moved);stallErr=Math.max(stallErr,c.err)}
      // …but only if you really went beyond it (GPS jitter while standing still doesn't count)
      else{if(stall>o.tol&&stallErr>15)m.event={kind:'extra',at:c.d,len:stall};stall=0;stallErr=0}
      if(m.event?.kind==='extra'){stall=0;stallErr=0}
    }
    m.matched=true;lastD=c.d;lastG=g;pending=null;
    Object.assign(m,{d:c.d,off:false,err:c.err,offDist:0,rejoin:null});
  };
  m.update=(lat,lon,g)=>{
    const x=(lon-lon0)*k,y=(lat-lat0)*R,u=heading(x,y,g),e=lastD+(g-lastG);m.event=null;
    if(!m.matched){
      // First match: the earliest pass within range, so a loop's start isn't mistaken for its finish
      let best=null;
      for(let i=0;i<=last;i++){const c=near(x,y,i);if(c.err<=o.off){if(!best||c.err<best.err)best=c}else if(best)break}
      if(best)accept(best,g);else Object.assign(m,{d:0,off:true,err:Infinity});
      return m;
    }
    // Where you should be: within the window, running the right way, continuing smoothly
    let best=null;
    if(!pending)for(let i=leg(e-o.back),j=leg(e+o.ahead);i<=j;i++){
      const c=near(x,y,i);if(c.err>o.off||wrongWay(u,i))continue;
      c.cost=c.err+o.jump*Math.abs(c.d-e);if(!best||c.cost<best.cost)best=c;
    }
    if(best){accept(best,g);return m}
    // Not there: the earliest point of the course from just behind your last match onwards that fits
    let wide=null;
    for(let i=leg(lastD-o.back);i<=last;i++){
      const c=near(x,y,i);if(c.err>o.off||wrongWay(u,i))continue;
      // the earliest pass in range: its closest point (not the first one within range, up to 40 m short)
      wide=c;for(let j=i+1;j<=last;j++){const n=near(x,y,j);if(n.err>o.off||wrongWay(u,j))break;if(n.err<wide.err)wide=n}
      break;
    }
    if(wide){
      // Pick up there once a few fixes agree (one wild fix shouldn't move you along the course)
      const ok=pending&&Math.abs(wide.d-(pending.d+(g-pending.g)))<=o.tol;
      pending=ok?{...pending,d:wide.d,g,n:pending.n+1}:{d:wide.d,g,n:1};
      if(pending.n>=o.confirm){accept(wide,g);return m}
    }else pending=null;
    // Off the course: stay where you left it; point the way back
    let near1=null;
    for(let i=leg(lastD-o.back),j=leg(lastD+600);i<=j;i++){const c=near(x,y,i);if(!near1||c.err<near1.err)near1=c}
    const rp=near1&&(()=>{const a=P[near1.i],b=P[near1.i+1],f=(near1.d-a.d)/((b.d-a.d)||1);return [a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f]})();
    Object.assign(m,{d:lastD,off:true,err:wide?wide.err:near1?.err??Infinity,offDist:Math.max(0,g-lastG),
      rejoin:rp?{d:near1.d,dist:Math.hypot(rp[0]-x,rp[1]-y),bearing:(Math.atan2(rp[0]-x,rp[1]-y)*180/Math.PI+360)%360}:null});
    return m;
  };
  // Carry on from a known position (resuming a saved run): d = route distance, g = GPS distance then
  m.seed=(d,g)=>{lastD=d;lastG=g;trail=[];pending=null;Object.assign(m,{d,off:false,err:0,matched:true,offDist:0,event:null,rejoin:null})};
  return m;
}
