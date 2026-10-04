// Turn-by-turn: turns along a route, from the GPX's own cue waypoints when it has them (e.g.
// plotaroute's "Turn left onto New Lane"), otherwise detected from the route's shape. Each turn is
// {d: route distance m, angle: ° (+ right, − left), kind, dir, text}.
// No DOM access, so it runs under node --test.

const R=111195;
const brg=(a,b)=>{const k=Math.cos(a.lat*Math.PI/180);return Math.atan2((b.lon-a.lon)*k,b.lat-a.lat)*180/Math.PI}; // ° from north
const wrap=x=>((x+540)%360)-180;

// Signed heading change at route point i: direction over the next `k` points vs the previous `k`
function bend(pts,i,k=3){
  if(i-k<0||i+k>=pts.length)return 0;
  return wrap(brg(pts[i],pts[i+k])-brg(pts[i-k],pts[i]));
}

const kindOf=a=>{const x=Math.abs(a);return x<60?'slight':x<125?'turn':x<160?'sharp':'uturn'};
const DEFAULT_TEXT={slight:'Bear',turn:'Turn',sharp:'Turn sharp',keep:'Keep'};
export function turnText(t){
  if(t.text)return t.text;
  if(t.kind==='uturn')return 'Turn around';
  return `${DEFAULT_TEXT[t.kind]} ${t.dir}`;
}

// Turns from shape: local peaks of heading change of at least `min`°, at least `gap` m apart
export function detectTurns(pts,{min=35,gap=60}={}){
  const cand=[];
  for(let i=1;i<pts.length-1;i++){
    const a=bend(pts,i);
    if(Math.abs(a)<min)continue;
    let peak=true;
    for(let j=Math.max(1,i-5);j<=Math.min(pts.length-2,i+5);j++)if(j!==i&&Math.abs(bend(pts,j))>Math.abs(a)){peak=false;break}
    if(peak)cand.push({d:pts[i].d,angle:a});
  }
  const out=[];
  for(const c of cand){
    const last=out.at(-1);
    if(last&&c.d-last.d<gap){if(Math.abs(c.angle)>Math.abs(last.angle))out[out.length-1]=c;continue}
    out.push(c);
  }
  return out.map(c=>({...c,kind:kindOf(c.angle),dir:c.angle>0?'right':'left',text:''}));
}

// Place cues [{lat,lon,...}] at increasing route indices (at least `gap` points apart), minimising the
// total distance from each cue to its point. Keeps the right pass on routes that go by a junction
// twice. Returns [{i, dist}] per cue.
function placeInOrder(pts,cues,gap=2){
  const k=Math.cos(pts[0].lat*Math.PI/180)*R,N=pts.length,C=cues.length;
  const dist=(c,i)=>Math.hypot((pts[i].lon-c.lon)*k,(pts[i].lat-c.lat)*R);
  const cost=[],from=[];
  for(let c=0;c<C;c++){
    cost.push(new Float64Array(N).fill(Infinity));from.push(new Int32Array(N).fill(-1));
    let bestPrev=Infinity,bestJ=-1;
    for(let i=0;i<N;i++){
      if(c>0){const j=i-gap;if(j>=0&&cost[c-1][j]<bestPrev){bestPrev=cost[c-1][j];bestJ=j}}
      const prev=c?bestPrev:0;
      if(prev<Infinity){cost[c][i]=prev+dist(cues[c],i);from[c][i]=bestJ}
    }
  }
  let i=-1,b=Infinity;for(let j=0;j<N;j++)if(cost[C-1][j]<b){b=cost[C-1][j];i=j}
  const out=new Array(C);
  for(let c=C-1;c>=0;c--){out[c]={i,dist:dist(cues[c],i)};i=from[c][i]}
  return out;
}

// Turns from GPX cue waypoints [{lat,lon,text}], placed in order along the route. Start/finish
// cues, non-direction cues and cues more than `near` m from the route are dropped.
export function cueTurns(pts,cues,{near=30}={}){
  const use=cues.filter(c=>{const t=(c.text||'').trim();return t&&!/^(start|finish|end)\b/i.test(t)&&/(left|right|turn|bear|keep|u-?turn|around)/i.test(t)});
  if(!use.length||use.length*2>pts.length)return [];
  const at=placeInOrder(pts,use),out=[];
  for(let n=0;n<use.length;n++){
    const text=use[n].text.trim(),{i:best,dist:bd}=at[n];
    if(bd>near)continue;
    // Angle from the shape near the cue, for drawing the arrow
    let a=0;for(let j=Math.max(0,best-3);j<=Math.min(pts.length-1,best+3);j++){const b=bend(pts,j);if(Math.abs(b)>Math.abs(a))a=b}
    const dir=/left/i.test(text)?'left':/right/i.test(text)?'right':a>0?'right':'left';
    const kind=/u-?turn|around/i.test(text)?'uturn':/sharp/i.test(text)?'sharp':/slight|bear/i.test(text)?'slight':/keep/i.test(text)?'keep':'turn';
    if(dir==='left'&&a>0||dir==='right'&&a<0)a=-a;  // trust the cue's side
    const std={slight:35,keep:20,turn:90,sharp:135,uturn:180}[kind];
    if(Math.abs(a)<std/2)a=(dir==='left'?-1:1)*std;  // shape barely bends here: draw the cue's usual angle
    out.push({d:pts[best].d,angle:a,kind,dir,text:text.charAt(0).toUpperCase()+text.slice(1)});
  }
  return out;
}

// The GPX's cues when it has them, plus any U-turn the shape shows that no cue covers (route planners
// often don't write one for a turnaround); otherwise turns from the shape alone
export function turnsFor(route){
  const shape=detectTurns(route.pts),cues=route.cues?.length?cueTurns(route.pts,route.cues):[];
  if(!cues.length)return shape;
  const extra=shape.filter(t=>t.kind==='uturn'&&!cues.some(c=>Math.abs(c.d-t.d)<60));
  return [...cues,...extra].sort((a,b)=>a.d-b.d);
}

// First turn more than 5 m ahead of route distance rd, or null
export const nextTurn=(turns,rd)=>turns.find(t=>t.d>rd+5)||null;

// "in 400 m", "in 1.2 km", "now"
export function inDist(m){
  if(m<=20)return 'now';
  const r=m>=200?Math.round(m/50)*50:Math.round(m/10)*10;
  return r>=1000?`in ${(m/1000).toFixed(1)} km`:`in ${r} m`;
}
