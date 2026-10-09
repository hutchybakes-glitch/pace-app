// Courses made from a saved route: part of it, several laps of it, or an interval session on it.
// Routes are resampled every 10 m: [{d, lat, lon, ele}].
// Every 10 m from 0 along points that already carry their distance d (keeps the route's own distances:
// re-measuring between 10 m points would cut across bends and come up short)
function even(raw,step=10){
  const total=raw.at(-1).d,out=[];let j=0;
  const at=d=>{while(j<raw.length-2&&raw[j+1].d<d)j++;const a=raw[j],b=raw[j+1],f=b.d>a.d?(d-a.d)/(b.d-a.d):0;
    return {d,lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,ele:a.ele==null||b.ele==null?null:a.ele+(b.ele-a.ele)*f}};
  for(let k=0;k*step<total-1;k++)out.push(at(k*step));
  out.push(at(total));return out;
}

const R=111195;
const gap=(a,b)=>{const k=Math.cos(a.lat*Math.PI/180);return Math.hypot((b.lon-a.lon)*k*R,(b.lat-a.lat)*R)};

// Point on the route at distance d (interpolated)
export function pointAt(pts,d){
  d=Math.max(0,Math.min(pts.at(-1).d,d));
  let lo=0,hi=pts.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(pts[m].d<=d)lo=m;else hi=m}
  const a=pts[lo],b=pts[hi],f=b.d>a.d?(d-a.d)/(b.d-a.d):0;
  return {lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,ele:(a.ele??0)+((b.ele??0)-(a.ele??0))*f};
}

// The stretch from a to b (route m), measured from 0; reversed (run from b back to a) if reverse
export function slice(pts,a,b,reverse=false){
  a=Math.max(0,a);b=Math.min(pts.at(-1).d,b);
  const raw=[{...pointAt(pts,a),d:a},...pts.filter(p=>p.d>a&&p.d<b),{...pointAt(pts,b),d:b}];
  return even(reverse?raw.reverse().map(p=>({...p,d:b-p.d})):raw.map(p=>({...p,d:p.d-a})));
}

// A loop: finishes within 60 m of where it starts (and is long enough to be worth lapping)
export const isLoop=pts=>pts.at(-1).d>=300&&gap(pts[0],pts.at(-1))<=60;

// n laps of a loop, joined end to start (ends back where it started)
export function laps(pts,n){
  // each lap includes the few metres from where the loop finished back to where it started
  const L=pts.at(-1).d+gap(pts.at(-1),pts[0]),raw=[];
  for(let i=0;i<n;i++)raw.push(...pts.map(p=>({...p,d:p.d+i*L})));
  if(gap(pts.at(-1),pts[0])>1)raw.push({...pts[0],d:n*L}); // and back to the start at the very end
  return even(raw);
}

// Cue sheet turns within a stretch, measured from its start (for a part of the route run forwards)
export const cuesWithin=(cues,a,b)=>(cues||[]).filter(c=>c.d>=a&&c.d<=b).map(c=>({...c,d:c.d-a}));

// An interval session. cfg:
//   kind      'repeat': the same stretch [from, from+len] `reps` times; 'split': the route cut into reps
//             of `len` m one after another
//   dir       repeat only: 'same' (from the same start each time, getting back there in the rest) or
//             'alternate' (there and back: every other rep runs the stretch in reverse)
//   rest      seconds between reps; pace: target s/km for the first rep (flat-equivalent: the pacer
//             adjusts it for the hills); step: s/km change each rep (−2 = each rep 2 s/km quicker)
// Returns [{i, from, to, reverse, len, pace, climb, grade}] (from/to in route m)
export function session(pts,cfg){
  const D=pts.at(-1).d,out=[];
  const push=(from,to,reverse)=>{
    const i=out.length,len=to-from;
    let up=0,down=0;for(let j=Math.round(from/10)+1;j<=Math.round(to/10)&&j<pts.length;j++){const e=(pts[j].ele??0)-(pts[j-1].ele??0);if(e>0)up+=e;else down-=e}
    out.push({i,from,to,reverse,len,pace:cfg.pace+(cfg.step||0)*i,climb:Math.round(reverse?down:up),grade:+(((reverse?-1:1)*((pointAt(pts,to).ele-pointAt(pts,from).ele)/len)*100)).toFixed(1)});
  };
  if(cfg.kind==='split'){
    const L=Math.max(100,cfg.len);
    for(let a=0;a<D-1;a+=L){let b=Math.min(D,a+L);if(D-b<Math.min(200,L/2))b=D;push(a,b,false);if(b>=D)break}
  }else{
    const from=Math.max(0,Math.min(D-100,cfg.from||0)),to=Math.min(D,from+Math.max(100,cfg.len||D));
    for(let i=0;i<Math.max(1,cfg.reps);i++)push(from,to,cfg.dir==='alternate'&&i%2===1);
  }
  return out;
}
