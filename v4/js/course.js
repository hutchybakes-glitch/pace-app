// The course as you actually ran it: the route, minus any parts you cut off, plus any extra you ran off
// it (an overshoot, a detour). Keeps the pacer fair: it skips whatever you skipped, so the gap, splits and
// projected finish compare you over the same ground; and your distance is what you really ran.
import {timeAt,distAt} from './pacer.js';

// P: the pacer. skips [{from, to, len}] (route m), extras [{at, len}] (route m where you rejoined, metres run)
export function createCourse(P,saved={}){
  const skips=[...(saved.skips||[])],extras=[...(saved.extras||[])];
  const clampD=d=>Math.max(0,Math.min(P.total,d));
  // Route metres skipped before route distance d
  const skipLen=d=>skips.reduce((s,k)=>s+Math.max(0,Math.min(d,k.to)-k.from),0);
  // Pacer seconds over the skipped parts before d
  const skipTime=d=>skips.reduce((s,k)=>{const b=Math.min(d,k.to);return b>k.from?s+timeAt(P,clampD(b))-timeAt(P,clampD(k.from)):s},0);
  const extraLen=d=>extras.reduce((s,x)=>x.at<=d?s+x.len:s,0);
  const c={
    skips,extras,
    add(ev){
      if(!ev)return;
      if(ev.kind==='skip')skips.push({from:clampD(ev.from),to:clampD(ev.to),len:Math.round(ev.len)});
      else extras.push({at:ev.at,len:Math.round(ev.len)});
    },
    get skipped(){return skips.reduce((s,k)=>s+(k.to-k.from),0)},
    get extra(){return extras.reduce((s,x)=>s+x.len,0)},
    // Distance you've actually run at route distance d, plus offDist m off the course right now
    ran:(d,offDist=0)=>d-skipLen(d)+extraLen(d)+offDist,
    // The pacer's time to reach route distance d on the course as you're running it
    pacerT:d=>timeAt(P,clampD(d))-skipTime(d),
    // …and where on the route the pacer is at time t (it jumps over the parts you skipped)
    pacerD(t){
      let tt=t;
      for(const k of [...skips].sort((a,b)=>a.from-b.from)){if(distAt(P,tt)<k.from)break;tt+=timeAt(P,clampD(k.to))-timeAt(P,clampD(k.from))}
      return distAt(P,tt);
    },
    // Route distance at which you'd have run `a` metres: walk the course, jumping skips, adding extras
    routeAt(a){
      const ev=[...skips.map(k=>({at:k.from,skip:k})),...extras.map(x=>({at:x.at,extra:x}))].sort((p,q)=>p.at-q.at);
      let pos=0;
      for(const e of ev){
        if(a<=e.at-pos)return clampD(pos+a);
        a-=Math.max(0,e.at-pos);pos=Math.max(pos,e.at);
        if(e.skip)pos=e.skip.to;else{a-=e.extra.len;if(a<=0)return clampD(pos)}
      }
      return clampD(pos+a);
    },
    // The pacer's time to cover the first `a` metres you ran
    pacerAtRan(a){return c.pacerT(c.routeAt(a))},
    toJSON:()=>({skips,extras}),
  };
  return c;
}
