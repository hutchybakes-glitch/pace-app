// Pacing: grade→effort model and per-segment / per-km targets. Paces are seconds per km.
export const COEF={up:0.033,down:0.018,taper:-10};

// Effort factor for grade g (%). Downhill benefit grows to the taper point, then braking
// eats it back, reaching 1 again at 2×taper.
export function effort(g,c=COEF){
  if(g>=0)return 1+c.up*g;
  if(g>=c.taper)return 1+c.down*g;
  return Math.min(1,1+c.down*(2*c.taper-g));
}

// Even effort: solve base pace b so Σ len·b·f = total time, then target = b·f
export function plan(segs,pace,c=COEF){
  const dist=segs.reduce((a,x)=>a+x.len,0),T=pace*dist/1000;
  const base=T/segs.reduce((a,x)=>a+x.len*effort(x.g,c),0)*1000;
  return {T,base,segs:segs.map(x=>({...x,f:effort(x.g,c),target:base*effort(x.g,c)}))};
}

// Per-km target = time-weighted average of the segment targets within that km
export function perKm(segs){
  const dist=segs[segs.length-1].d1,out=[];
  for(let k0=0;k0<dist-0.5;k0+=1000){
    const k1=Math.min(k0+1000,dist);let t=0;
    for(const x of segs){const o=Math.min(x.d1,k1)-Math.max(x.d0,k0);if(o>0)t+=o*x.target/1000}
    out.push({km:out.length+1,d0:k0,d1:k1,target:t/((k1-k0)/1000)});
  }
  return out;
}

// Index of the segment containing route distance d
export const segAt=(segs,d)=>{let i=0;while(i<segs.length-1&&segs[i].d1<=d)i++;return i};

// Cumulative target time (s) to reach route distance d
export function timeAt(segs,d){
  let t=0;
  for(const x of segs){if(d<=x.d0)break;t+=(Math.min(d,x.d1)-x.d0)*x.target/1000}
  return t;
}

// Status colour for current pace vs target, both s/km; S = sensitivity (s/km)
export const band=(cur,target,S,amber)=>{const e=Math.abs(cur-target);return e<=S?'green':amber&&e<=2*S?'amber':'red'};

// Returns f(reading) → shown value, which only changes after n consecutive identical readings
export function hysteresis(n=2){
  let shown=null,cand=null,c=0;
  return v=>{
    if(v===shown){cand=null;c=0}
    else if(v===cand){if(++c>=n){shown=v;cand=null;c=0}}
    else{cand=v;c=1;if(c>=n){shown=v;cand=null;c=0}}
    return shown;
  };
}

export const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};

// "4:30" → 270, "1:35:00" → 5700. A dot works as a colon ("4.30"). NaN if malformed.
export function parseTime(str){
  const p=String(str).trim().split(/[:.]/);
  if(p.length>3||!/^\d+$/.test(p[0])||p.slice(1).some(x=>!/^[0-5]\d$/.test(x)))return NaN;
  return p.reduce((a,x)=>a*60+ +x,0);
}
