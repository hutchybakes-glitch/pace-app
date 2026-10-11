// Cadence (steps per minute) and stride length (metres per step) from the phone's accelerometer.
//
// Step detection, per sample (~60 Hz, from devicemotion accelerationIncludingGravity):
//   1. magnitude √(x²+y²+z²)
//   2. high-pass: subtract the moving average over the last HP_MS (removes gravity and drift)
//   3. low-pass: moving average over LP_MS (removes jitter)
//   4. a step at each peak above an adaptive threshold: THRESH_K × the rolling standard deviation over
//      STD_MS, never below THRESH_FLOOR, and at least MIN_STEP_MS after the last step (≤ 240 spm)
// Cadence = steps in the last CAD_MS × (60 s / CAD_MS). Stride = distance ÷ steps over the same
// STRIDE_MS window, shown only with at least MIN_STEPS steps and MIN_DIST metres, within STRIDE_MIN–MAX.
import {sim,SIM,now} from './sim.js';

export const HP_MS=1000, LP_MS=100, STD_MS=2000, THRESH_K=0.5, THRESH_FLOOR=0.5; // m/s²
export const MIN_STEP_MS=250, CAD_MS=15000, STRIDE_MS=30000, UPDATE_MS=5000;
export const MIN_STEPS=20, MIN_DIST=30, STRIDE_MIN=0.4, STRIDE_MAX=2.5, CAD_MIN=100, CAD_MAX=240;

// Moving average over the last `ms` of (t, v) samples
function windowMean(ms){
  const q=[];let sum=0,sq=0,head=0;
  return {
    push(t,v){q.push([t,v]);sum+=v;sq+=v*v;while(q[head][0]<t-ms){sum-=q[head][1];sq-=q[head][1]**2;head++}if(head>512){q.splice(0,head);head=0}},
    get mean(){const n=q.length-head;return n?sum/n:0},
    get std(){const n=q.length-head;if(n<2)return 0;const m=sum/n;return Math.sqrt(Math.max(0,sq/n-m*m))}
  };
}

// Streaming step detector: push(t ms, x, y, z) → the time of a step found (the peak's time), or null
export function createStepDetector(){
  const hp=windowMean(HP_MS),lp=windowMean(LP_MS),sd=windowMean(STD_MS);
  let a=null,b=null,last=-1e9; // the previous two smoothed samples [t, v]
  return function push(t,x,y,z){
    const m=Math.sqrt(x*x+y*y+z*z);
    hp.push(t,m);lp.push(t,m-hp.mean);
    const v=lp.mean;sd.push(t,v);
    let step=null;
    if(a&&b&&b[1]>a[1]&&b[1]>=v){ // b is a local peak
      const th=Math.max(THRESH_FLOOR,THRESH_K*sd.std);
      if(b[1]>th&&b[0]-last>=MIN_STEP_MS){last=b[0];step=b[0]}
    }
    a=b;b=[t,v];
    return step;
  };
}

// Pure: samples [[t ms, x, y, z], …] → step timestamps (ms)
export function detectSteps(samples){
  const push=createStepDetector(),out=[];
  for(const s of samples){const st=push(s[0],s[1],s[2],s[3]);if(st!=null)out.push(st)}
  return out;
}

// Cadence (spm) from step times (s) at time t (s): steps in the last CAD_MS. null until a full window.
export function cadenceAt(steps,t,since=0){
  const w=CAD_MS/1000;if(t-since<w)return null;
  let n=0;for(let i=steps.length-1;i>=0&&steps[i]>t-w;i--)if(steps[i]<=t)n++;
  return n*60/w;
}
// Stride (m) from steps and distance over the same window; null when it can't be trusted
export function strideOf(nSteps,dist){
  if(nSteps<MIN_STEPS||dist<MIN_DIST)return null;
  const s=dist/nSteps;
  return s>=STRIDE_MIN&&s<=STRIDE_MAX?s:null;
}

// Per km from a saved run: fixes [[ts, t ms, lat, lon, acc, gpsD, rd, pace, cadence, stride], …], step
// counts at each km (stepSplits, cumulative) and the km split times (s). Returns [{km, cad, stride}]
export function kmMotion(rsplits,stepSplits,elapsed,totalSteps,D){
  const out=[];
  for(let k=0;k*1000<D-1;k++){
    const t0=k?rsplits[k-1]:0,t1=k<rsplits.length?rsplits[k]:elapsed,s0=k?stepSplits[k-1]:0,s1=k<stepSplits.length?stepSplits[k]:totalSteps;
    const len=Math.min(1000,D-k*1000),n=(s1??0)-(s0??0),dt=t1-t0;
    const cad=n>0&&dt>0?n*60/dt:null;
    out.push({km:k+1,cad:cad>=CAD_MIN&&cad<=CAD_MAX?cad:null,stride:strideOf(n,len)}); // nothing believable → –
  }
  return out;
}

// Report insight: the km where you slowed (≥ 3 % slower than your running up to then, allowing for the
// terrain when there's a plan to compare with), and why: cadence held (stride shortening, the usual
// fatigue sign) or cadence dropped. Runs of consecutive km with the same story are told once.
// km: [{km, pace (s/km), cad, stride, climb (m), ref (the plan's pace for that km, or null)}]
export function motionInsight(km){
  const ok=km.filter(k=>k.cad&&k.stride&&k.pace);
  if(ok.length<2)return null;
  const rel=k=>k.pace/(k.ref||1),found=[];
  for(let i=1;i<ok.length;i++){
    const prev=ok.slice(0,i),avg=f=>prev.reduce((s,k)=>s+f(k),0)/prev.length,k=ok[i];
    const r0=avg(rel);if(rel(k)<r0*1.03)continue;
    found.push({k,slower:Math.round(k.pace-r0*(k.ref||1)),c0:avg(k=>k.cad),s0:avg(k=>k.stride),
      kind:k.cad>=avg(k=>k.cad)*0.98?'stride':'cadence'});
  }
  if(found.length){
    const groups=[];
    for(const f of found){const g=groups.at(-1);if(g&&g.kind===f.kind&&g.items.at(-1).k.km===f.k.km-1)g.items.push(f);else groups.push({kind:f.kind,items:[f]})}
    return groups.map(g=>{
      const a=g.items[0],z=g.items.at(-1),many=g.items.length>1,sl=g.items.map(f=>f.slower);
      const where=many?`Km ${a.k.km}–${z.k.km}`:`Km ${a.k.km}`,hill=!many&&!a.k.ref&&a.k.climb>=15?' (on a climb)':'';
      const by=many?`${Math.min(...sl)}–${Math.max(...sl)}`:`${sl[0]}`,terrain=a.k.ref?' for the terrain':'';
      const cads=g.items.map(f=>Math.round(f.k.cad)),cadTxt=many?`${Math.min(...cads)}–${Math.max(...cads)}`:`${cads[0]}`;
      return g.kind==='stride'
        ?{kind:'stride',km:a.k.km,text:`${where}${hill}: ${by} s/km slower${terrain}. Cadence held (${cadTxt} spm) but stride shortened from ${a.s0.toFixed(2)} to ${z.k.stride.toFixed(2)} m${hill?'':', a typical sign of fatigue'}.`}
        :{kind:'cadence',km:a.k.km,text:`${where}${hill}: ${by} s/km slower${terrain}, with cadence down from ${Math.round(a.c0)} to ${cadTxt} spm (stride ${z.k.stride.toFixed(2)} m).`};
    });
  }
  const c=ok.map(k=>k.cad),s=ok.map(k=>k.stride);
  return [{kind:'steady',text:`No km slowed noticeably. Cadence ${Math.round(Math.min(...c))}–${Math.round(Math.max(...c))} spm, stride ${Math.min(...s).toFixed(2)}–${Math.max(...s).toFixed(2)} m.`}];
}

// ---- The phone's accelerometer ----
// request() must be called from a tap (iOS asks for permission). start(onStep) calls onStep(ago) for
// every step, ago = ms since the step happened (detection lags a little); stop() ends it. In the sim, a synthetic accelerometer stream stands in.
export function createMotion(){
  let on=false,push=null,onStep=null,timer=null,ok=null;
  const handler=e=>{
    const g=e.accelerationIncludingGravity;if(!g||g.x==null)return;
    const st=push(e.timeStamp??performance.now(),g.x,g.y,g.z);if(st!=null)onStep?.(performance.now()-st);
  };
  return {
    get available(){return ok},
    // Returns a promise of true/false. Call it synchronously inside the tap handler.
    request(){
      if(SIM)return Promise.resolve(ok=true);
      if(typeof DeviceMotionEvent==='undefined')return Promise.resolve(ok=false);
      if(typeof DeviceMotionEvent.requestPermission==='function')
        return DeviceMotionEvent.requestPermission().then(r=>ok=r==='granted').catch(()=>ok=false);
      return Promise.resolve(ok=true);
    },
    start(cb){
      if(on||!ok)return;on=true;onStep=cb;push=createStepDetector();
      if(SIM)timer=simAccel(push,ago=>onStep?.(ago));
      else addEventListener('devicemotion',handler);
    },
    stop(){on=false;if(timer){clearInterval(timer);timer=null}removeEventListener('devicemotion',handler)},
  };
}

// Sim: a runner's accelerometer at 60 Hz of simulated time: a bounce at the cadence for the sim
// runner's speed (about 164 spm at 6:40/km, 171 at 5:00, 178 at 4:10), plus noise. Standing still,
// just noise.
export const simCadence=v=>140+9.5*v;
function simAccel(push,step){
  let phase=0,t=now(),seed=11;
  const rnd=()=>{seed=seed*16807%2147483647;return seed/2147483647};
  return setInterval(()=>{
    const end=now();
    for(;t<end;t+=1000/60){
      const v=sim.moving?sim.v||0:0,f=v>0.5?simCadence(v)/60:0;
      phase+=2*Math.PI*f/60;
      const amp=v>0.5?6:0,n=()=>(rnd()-0.5)*0.6;
      const st=push(t,n(),9.81+amp*Math.sin(phase)+n(),n());if(st!=null)step(end-st);
    }
  },50);
}

// ---- Cadence and stride guide ----
// What the research says, and how it's used here:
// - Experienced runners self-select a cadence within a few % of their metabolic optimum (novices run a
//   little low, i.e. overstride), so the guide starts from YOUR flat-ground cadence, not a generic 180.
// - Cadence rises only gently with speed (about 6 steps/min per m/s); speed changes come mostly from
//   stride length. So the guide's stride is simply speed ÷ cadence at the pacer's pace there.
// - Uphill at the same speed, cadence rises about 0.6 % per % of gradient (4 % at 7 %) and steps
//   shorten; on a real climb you're slower too, so the stride shortens a lot more.
// - Downhill, runners naturally drop cadence and lengthen their stride sharply, but the energetically
//   optimal cadence barely changes with slope, and running a few % quicker than natural cuts braking,
//   knee loading and quad damage. So on descents cadence holds (steep ones a little quicker) and the
//   stride opens up.
export const CAD_PER_MS=6, CAD_UP_K=0.006, CAD_UP_MAX=0.05, STEEP_DOWN=-5, STEEP_DOWN_K=0.03;
export const TYPICAL_BASE=150;                // spm at 0 m/s by the typical-runner line: 170 at 5:00/km
const gradeAt=(pts,d)=>{const i=Math.max(0,Math.min(pts.length-1,Math.round(d/10))),a=pts[Math.max(0,i-5)],b=pts[Math.min(pts.length-1,i+5)];return b.d>a.d?((b.ele??0)-(a.ele??0))/(b.d-a.d)*100:0};

// Your baseline from past runs: cadence = base + 6 × speed (m/s), from points on flat ground (|grade| < 1.5 %)
// at running speed. runs: saved runs with fixes [.., rd (6), pace (7), cadence (8), ..] and route.pts.
// Returns {base, n (points used), personal}
export function cadenceBaseline(runs){
  const v=[];
  for(const r of runs){
    const pts=r.route?.pts;if(!pts)continue;
    for(const f of r.fixes||[]){
      const c=f[8],p=f[7];if(!c||!p||p<150||p>600||c<120||c>220)continue;
      if(Math.abs(gradeAt(pts,f[6]))>=1.5)continue;
      v.push(c-CAD_PER_MS*1000/p);
    }
  }
  if(v.length<60)return {base:TYPICAL_BASE,n:v.length,personal:false};
  v.sort((a,b)=>a-b);return {base:v[Math.floor(v.length/2)],n:v.length,personal:true};
}

// Gradient adjustment to cadence (fraction): up on climbs, held on descents, a little up on steep ones
export const cadGrade=g=>g>0?Math.min(CAD_UP_MAX,CAD_UP_K*g):g<=STEEP_DOWN?STEEP_DOWN_K*Math.min(1,(STEEP_DOWN-g)/5+0.5):0;

// The guide at every route point for pacer P: {d, cad, stride}. Smoothed over 100 m, so it eases into
// and out of hills rather than stepping.
export function cadencePlan(P,base=TYPICAL_BASE){
  const raw=P.d.map((_,i)=>{const v=1000/P.pace[i];return (base+CAD_PER_MS*v)*(1+cadGrade(P.grade[i]))});
  const cad=raw.map((_,i)=>{let s=0,n=0;for(let j=Math.max(0,i-5);j<=Math.min(raw.length-1,i+5);j++){s+=raw[j];n++}return s/n});
  return {d:P.d,cad,stride:cad.map((c,i)=>1000/P.pace[i]/(c/60))};
}
export function planAt(C,d){
  const i=Math.max(0,Math.min(C.d.length-1,Math.round(d/10)));return {cad:C.cad[i],stride:C.stride[i]};
}

// Signs along the road: at the start of every climb, descent and flat (at least 150 m long), with that
// stretch's typical cadence and stride and a short tip. kind: 'up' | 'down' | 'flat'; steep: |grade| ≥ 5
export function cadenceSigns(P,C){
  const cls=g=>g>2?'up':g<-2?'down':'flat',seg=[];
  for(let i=0;i<P.d.length;i++){const k=cls(P.grade[i]),s=seg.at(-1);if(s&&s.kind===k)s.i1=i;else seg.push({kind:k,i0:i,i1:i})}
  // merge short stretches into the one before
  for(let m=0;m<seg.length;)if(seg.length>1&&P.d[seg[m].i1]-P.d[seg[m].i0]<150){const s=seg.splice(m,1)[0];if(m>0)seg[m-1].i1=s.i1;else seg[0].i0=s.i0;
    for(let k=1;k<seg.length;)if(seg[k].kind===seg[k-1].kind){seg[k-1].i1=seg[k].i1;seg.splice(k,1)}else k++;m=0}else m++;
  return seg.map(s=>{
    const idx=[];for(let i=s.i0;i<=s.i1;i++)idx.push(i);
    const med=a=>{const v=idx.map(i=>a[i]).sort((x,y)=>x-y);return v[Math.floor(v.length/2)]};
    const g=s.kind==='up'?Math.max(...idx.map(i=>P.grade[i])):s.kind==='down'?Math.min(...idx.map(i=>P.grade[i])):0;
    return {d:P.d[s.i0],d1:P.d[s.i1],kind:s.kind,grade:+g.toFixed(1),steep:Math.abs(g)>=5,cad:Math.round(med(C.cad)),stride:+med(C.stride).toFixed(2)};
  });
}
// first: the opening sign (said as you set off)
export function cadenceTip(s,first=false){
  if(first)return `Settle in at about ${s.cad} steps a minute, stride ${s.stride.toFixed(2)} metres.`;
  if(s.kind==='up')return `${s.steep?'Steep climb':'Climb'}: keep your rhythm at about ${s.cad} and shorten your stride, to about ${s.stride.toFixed(2)} metres.`;
  if(s.kind==='down')return s.steep?`Steep descent: quick, light steps, about ${s.cad}. Don't reach out in front.`:`Downhill: keep your cadence around ${s.cad} and let your stride open up.`;
  return `Flat: settle back to about ${s.cad}, stride ${s.stride} metres.`;
}
