// The pacer: a virtual runner who paces the route metre by metre. Their pace follows the local
// gradient through a runner profile (how hard climbs feel, how much descents give back, how effort is
// spread over the race) and is scaled so they finish exactly on the target time.
// Paces are seconds per km, distances metres, times seconds. No DOM access: runs under node --test.
import {smooth} from './route.js';
import {weatherFactors} from './weather.js';

// Profile traits
export const CLIMB={none:0,strong:0.024,average:0.033,weak:0.045};          // slower per +1 % grade
export const DESCENT={none:{gain:0,taper:-10},cautious:{gain:0.008,taper:-6},
  average:{gain:0.018,taper:-10},strong:{gain:0.026,taper:-14}};              // faster per −1 %, braking from taper %
export const STRATEGY={even:0,negative:0.03,positive:-0.03};                 // + = start slower, finish faster
export const TRAIT_NAMES={
  climb:{weak:'Weak',average:'Average',strong:'Strong',none:'Ignores hills'},
  descent:{cautious:'Cautious',average:'Average',strong:'Strong',none:'Ignores hills'},
  strategy:{even:'Even',negative:'Negative split',positive:'Fast start'},
};

export const PROFILES=[
  {id:'even',name:'Even effort',icon:'⚖️',desc:'Eases off on climbs and uses the descents. The classic way to pace hills.',climb:'average',descent:'average',strategy:'even'},
  {id:'climber',name:'Strong climber',icon:'⛰️',desc:'Attacks the uphills, steady on the way down.',climb:'strong',descent:'average',strategy:'even'},
  {id:'descender',name:'Strong descender',icon:'🪂',desc:'Holds back on climbs, flies down the hills.',climb:'weak',descent:'strong',strategy:'even'},
  {id:'hills',name:'Hill specialist',icon:'🐐',desc:'Strong up and down: banks time on every hill.',climb:'strong',descent:'strong',strategy:'even'},
  {id:'flat',name:'Flat-road runner',icon:'🛣️',desc:'Quick on the flat, careful on hills both ways.',climb:'weak',descent:'cautious',strategy:'even'},
  {id:'negative',name:'Negative splitter',icon:'📈',desc:'Even effort, but starts 3 % easy and finishes 3 % quicker.',climb:'average',descent:'average',strategy:'negative'},
  {id:'metronome',name:'Metronome',icon:'⏱️',desc:'Exactly the same pace everywhere, hills or not.',climb:'none',descent:'none',strategy:'even'},
];

// Effort factor at grade g % (pace multiplier). Descents help down to the taper grade, then braking
// takes the benefit back. Grades beyond ±25 % are treated as ±25 %.
export function effort(g,climb,descent){
  g=Math.max(-25,Math.min(25,g));
  if(g>=0)return 1+climb*g;
  if(g>=descent.taper)return 1+descent.gain*g;
  return Math.min(1,1+descent.gain*(2*descent.taper-g));
}

// Centred moving average of values v over route points pts within ±win/2 m
function smoothVals(v,pts,win){
  const h=win/2,out=[];let a=0,b=0,sum=0;
  for(let i=0;i<v.length;i++){
    while(b<v.length&&pts[b].d<=pts[i].d+h)sum+=v[b++];
    while(pts[a].d<pts[i].d-h)sum-=v[a++];
    out.push(sum/(b-a));
  }
  return out;
}

// Build the pacer for route points pts (every 10 m, with ele), target finish time (s) and profile traits.
// Returns {d[], grade[], pace[], time[], es[], base, finish, total, wx}: arrays per route point.
//   smoothM elevation smoothing, gradeM span grade is measured over, easeM how gradually pace changes
//   (a real pacemaker eases into a change over a couple of hundred metres; map noise shouldn't twitch it)
//   cond    weather: {w (fetchWeather), start (ms), shelter, mode: 'keep' (same finish, effort spread for
//           the conditions) | 'adjust' (conditions move the finish time)}. wx then reports the effect.
export function buildPacer(pts,finish,prof,{smoothM=120,gradeM=100,easeM=200,cond=null}={}){
  const n=pts.length,D=pts[n-1].d,es=smooth(pts,smoothM),h=Math.max(1,Math.round(gradeM/20));
  const grade=pts.map((p,i)=>{const a=Math.max(0,i-h),b=Math.min(n-1,i+h);return pts[b].d>pts[a].d?(es[b]-es[a])/(pts[b].d-pts[a].d)*100:0});
  const c=CLIMB[prof.climb],ds=DESCENT[prof.descent],s=STRATEGY[prof.strategy];
  const shape=(wet,wf)=>smoothVals(grade.map((g,i)=>effort(g,c,wet?.[i]?{...ds,gain:ds.gain/2}:ds)*(1+s*(1-2*pts[i].d/D))*(wf?.[i]??1)),pts,easeM);
  const total=q=>{let W=0;for(let i=1;i<n;i++)W+=(q[i-1]+q[i])/2*(pts[i].d-pts[i-1].d);return W};
  const times=(q,base)=>{const t=[0];for(let i=1;i<n;i++)t.push(t[i-1]+(q[i-1]+q[i])/2*base*(pts[i].d-pts[i-1].d)/1000);return t};
  let q=shape(),W0=total(q),base=finish*1000/W0,wx=null;
  if(cond?.w){
    // Weather depends on when the pacer gets to each point, so place them twice: once on the plain plan,
    // then again on the weather-adjusted one
    const v=D/finish;let f=null;
    for(let pass=0;pass<2;pass++){
      const t=times(q,pass?base:finish*1000/W0);
      f=weatherFactors(pts,t,cond.w,cond.start,{shelter:cond.shelter,v});
      q=shape(f.wet,f.f);
      base=cond.mode==='adjust'?finish*1000/W0:finish*1000/total(q);
    }
    const Ww=total(q),avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
    wx={mode:cond.mode,costPct:(Ww/W0-1)*100,suggested:finish*Ww/W0,heatPct:avg(f.heat),head:f.head,wet:f.wet.some(Boolean),start:cond.start,shelter:cond.shelter};
  }
  const pace=q.map(x=>x*base),time=times(q,base);
  return {d:pts.map(p=>p.d),grade,pace,time,es,base,finish:time[n-1],target:finish,total:D,wx};
}

// Index of the last point at or before distance d
function idx(P,d){let lo=0,hi=P.d.length-2;while(lo<hi){const m=(lo+hi+1)>>1;if(P.d[m]<=d)lo=m;else hi=m-1}return lo}
const lerp=(a,b,f)=>a+(b-a)*f;

// Pacer's elapsed time (s) on reaching distance d, and pace (s/km) there
export function timeAt(P,d){
  if(d<=0)return 0;if(d>=P.total)return P.finish;
  const i=idx(P,d),f=(d-P.d[i])/(P.d[i+1]-P.d[i]);
  if(P.lin)return P.time[i]+(P.time[i+1]-P.time[i])*f; // a past run: exactly when you got there
  return P.time[i]+(lerp(P.pace[i],P.pace[i+1],f/2)*(d-P.d[i]))/1000; // trapezoid to d
}
export function paceAt(P,d){
  d=Math.max(0,Math.min(P.total,d));
  const i=idx(P,d),f=(d-P.d[i])/((P.d[i+1]-P.d[i])||1);
  return lerp(P.pace[i],P.pace[i+1]??P.pace[i],f);
}
// Pacer's distance (m) at elapsed time t (s)
export function distAt(P,t){
  if(t<=0)return 0;if(t>=P.finish)return P.total;
  let lo=0,hi=P.time.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(P.time[m]<=t)lo=m;else hi=m}
  if(P.lin){const dt=P.time[hi]-P.time[lo];return P.d[lo]+(dt>0?(t-P.time[lo])/dt:0)*(P.d[hi]-P.d[lo])}
  // within the step: pace changes linearly, solve the trapezoid for the distance
  const L=P.d[hi]-P.d[lo],p0=P.pace[lo],p1=P.pace[hi],dt=(t-P.time[lo])*1000,k=(p1-p0)/L;
  const x=Math.abs(k)<1e-9?dt/p0:(-p0+Math.sqrt(p0*p0+2*k*dt))/k;
  return P.d[lo]+Math.max(0,Math.min(L,x));
}
// Pacer's average pace (s/km) between distances a and b
export const avgBetween=(P,a,b)=>b-a>1?(timeAt(P,b)-timeAt(P,a))/((b-a)/1000):paceAt(P,a);

// Fastest and slowest points of the pacer's run: {d, pace}
export function extremes(P){
  let lo=0,hi=0;P.pace.forEach((p,i)=>{if(p<P.pace[lo])lo=i;if(p>P.pace[hi])hi=i});
  return {fast:{d:P.d[lo],pace:P.pace[lo],grade:P.grade[lo]},slow:{d:P.d[hi],pace:P.pace[hi],grade:P.grade[hi]}};
}

// Road colour for a grade: grey only when truly flat (under 0.3 %); from very light red for the slightest
// incline to dark red at 10 % and steeper, and very light green to dark green for descents. The scale is
// square-rooted so gentle grades (1–3 %) are clearly told apart. Returns [r,g,b].
export function gradeRGB(g){
  const mix=(a,b,t)=>a.map((x,i)=>Math.round(x+(b[i]-x)*t));
  if(Math.abs(g)<0.3)return [148,163,184];
  const t=Math.sqrt(Math.min(1,Math.abs(g)/10));
  return g>0?mix([254,226,226],[153,27,27],t):mix([220,252,231],[20,83,45],t);
}
export const gradeColor=g=>`rgb(${gradeRGB(g).join(',')})`;

// Where to write the target pace on the road: about 100 m in, then wherever the pacer's pace for the
// next 100 m differs by `change` s/km or more from the last mark (at least `minGap` m apart), and at
// least every `maxGap` m on steady stretches. Returns [{d, pace}].
export function paceMarks(P,{minGap=100,maxGap=400,change=6,ahead=100}={}){
  const out=[],need=d=>avgBetween(P,d,Math.min(P.total,d+ahead));
  for(let d=100;d<P.total-ahead/2;d+=10){
    const p=need(d),last=out.at(-1);
    if(!last||(d-last.d>=minGap&&Math.abs(p-last.pace)>=change)||d-last.d>=maxGap)out.push({d,pace:p});
  }
  return out;
}

// Projected finish time (s) for a runner at route distance d after t seconds, using how they're doing
// against the pacer's plan (which already knows the hills ahead): half their whole run so far, half
// their last km (tBack = their elapsed time 1 km back, if known). Null until 200 m in.
export function projectFinish(P,d,t,tBack=null){
  if(d<200||t<=0)return null;
  const overall=t/timeAt(P,d);
  let r=overall;
  if(tBack!=null&&d>=1200){const plan=timeAt(P,d)-timeAt(P,d-1000);if(plan>0)r=0.5*overall+0.5*(t-tBack)/plan}
  return t+(P.finish-timeAt(P,d))*r;
}

// Pace written on the road: the pacer's exact pace at that spot, every `step` m from `step` in
export function roadMarks(P,step=50){
  const out=[];
  for(let d=step;d<P.total-step/2;d+=step)out.push({d,pace:paceAt(P,d)});
  return out;
}

// ---- Racing a past run ----
// A pacer from one of your runs on this route (a "ghost"): it reaches every point exactly when you did
// that day. Terrain (elevation, grade) comes from the route; times from the run. lin: true makes
// timeAt/distAt interpolate those times; pace (for display and the coach) is your pace there, smoothed.
// fixes: [[ts, t ms, lat, lon, acc, gpsD, rd m, pace], …]; elapsed: the run's time (s)
export function ghostFromRun(pts,fixes,elapsed){
  const F=[];let far=-1;
  for(const f of fixes){const r=f[6];if(r==null||!(r>far+0.5))continue;far=r;F.push([r,f[1]/1000])}
  const D=pts.at(-1).d,T=[];let j=0;
  const tail=F.length>1?(F.at(-1)[1]-F[Math.max(0,F.findIndex(x=>x[0]>=F.at(-1)[0]-300))][1])/Math.max(1,F.at(-1)[0]-F[Math.max(0,F.findIndex(x=>x[0]>=F.at(-1)[0]-300))][0]):0.3;
  for(const p of pts){
    const d=p.d;
    if(!F.length||d<=0){T.push(0);continue}
    if(d<=F[0][0]){T.push(F[0][1]*d/Math.max(1,F[0][0]));continue}
    if(d>=F.at(-1)[0]){T.push(F.at(-1)[1]+(d-F.at(-1)[0])*tail);continue}
    while(j<F.length-2&&F[j+1][0]<d)j++;
    const a=F[j],b=F[j+1];T.push(a[1]+(b[1]-a[1])*(d-a[0])/(b[0]-a[0]));
  }
  if(F.length&&F.at(-1)[0]>=D-30)T[T.length-1]=Math.max(T.at(-2)??0,elapsed); // finished: exactly your time
  return ghostFromTimes(pts,T);
}

// The same, from times already worked out (saved with a run, so results can be rebuilt later)
export function ghostFromTimes(pts,T){
  const n=pts.length;
  for(let i=1;i<n;i++)T[i]=Math.max(T[i],T[i-1]);
  const base=buildPacer(pts,Math.max(60,T[n-1]),{climb:'average',descent:'average',strategy:'even'});
  const raw=pts.map((p,i)=>{const a=Math.max(0,i-5),b=Math.min(n-1,i+5),dd=pts[b].d-pts[a].d;return dd>0?(T[b]-T[a])/(dd/1000):300});
  const pace=smoothVals(raw,pts,150);
  return {...base,time:T,pace,finish:T[n-1],target:T[n-1],lin:true,ghost:true};
}

// Change the plan from where you are: the rest of the run takes k times as long (k < 1 faster). The time
// at d stays the same, so the gap doesn't jump.
export function adjustPacer(P,d,k){
  const t0=timeAt(P,d),time=P.time.map((t,i)=>P.d[i]>d?t0+(t-t0)*k:t),pace=P.pace.map((p,i)=>P.d[i]>d?p*k:p);
  return {...P,time,pace,finish:t0+(P.finish-t0)*k,adjusted:true};
}
