// Optimal RPE (rate of perceived exertion, 1–10) along the course, check-ins and pacing advice.
//
// What it's based on:
// - In a well-paced race, RPE rises roughly linearly with the proportion of the race done and peaks at
//   the finish (Tucker's anticipatory "template" RPE; Noakes et al.). Feeling fresh early is expected,
//   not a sign to go faster: early RPE is a poor guide, so speed-up advice waits until 30 % in.
// - Even pacing with a small reserve for the finish is how 5 km to marathon world records are run.
// - On hills, letting effort rise a little on climbs and fall on descents beats holding a constant
//   effort (variable-power studies, about 5 % over average on climbs), with recovery after the climb
//   before pushing on. Too much on climbs risks early fatigue, so the rise is capped.
// - On the CR-10 scale, running at the 2 mmol/L lactate boundary is about 4.3 and at 4 mmol/L about
//   6.5, which anchors the Zone 2 (3–4) and threshold (6–7) bands below.
import {timeAt,paceAt} from './pacer.js';

export const RPE_SCALE=[
  {n:1,name:'Very easy',feel:'Barely any effort. A gentle walk or the slowest shuffle.',talk:'You could sing'},
  {n:2,name:'Easy',feel:'Warm-up jog. Loose and relaxed, breathing hardly changes.',talk:'Chat away freely'},
  {n:3,name:'Easy, Zone 2',feel:'Relaxed running. Breathing deeper but calm; you could keep this up for hours.',talk:'Full sentences, no trouble'},
  {n:4,name:'Steady',feel:'Comfortable but you know you\'re working. Top of Zone 2, a long-run effort.',talk:'Sentences, with the odd breath'},
  {n:5,name:'Moderate',feel:'"Comfortably hard" starts here. Marathon effort for many runners.',talk:'Short sentences'},
  {n:6,name:'Hard',feel:'Around threshold, half-marathon effort. You need to concentrate to hold it.',talk:'A few words at a time'},
  {n:7,name:'Very hard',feel:'10 km race effort. Breathing is heavy and you want it to be over.',talk:'Two or three words'},
  {n:8,name:'Really hard',feel:'5 km race effort, or late in a 10 km. Legs and lungs are burning.',talk:'Single words'},
  {n:9,name:'Nearly flat out',feel:'The last kilometre of a race. Holding your form takes everything.',talk:'Can\'t talk'},
  {n:10,name:'Maximal',feel:'An all-out sprint for the line. You can only hold it for moments.',talk:'Nothing left'},
];
export const rpeName=r=>RPE_SCALE[Math.max(0,Math.min(9,Math.round(r)-1))].name;

// What you intend the run to be. start/end: RPE at the start and finish of a typical 10 km; cap: the most
// it should ever be; speedUp: whether it may suggest running faster
export const INTENSITIES=[
  {id:'allout',name:'All-out race',desc:'A PB attempt. Controlled at first, building steadily, nothing left at the line.',end:10,cap:10,speedUp:true},
  {id:'hard',name:'Hard, not all-out',desc:'A strong run, like a parkrun you push but don\'t empty yourself on. You finish with a bit in reserve.',end:8,cap:8.5,speedUp:true},
  {id:'steady',name:'Comfortable',desc:'A steady run that stays under control throughout. Breathing settled, could talk in short sentences.',start:4,end:5.5,cap:6,speedUp:true},
  {id:'easy',name:'Zone 2 easy',desc:'Conversational, for building your aerobic base. Slow right down, or walk, on hills to stay easy.',start:3,end:3.5,cap:4,speedUp:false},
];

// Effort cost of running at grade g % compared with the flat (from metabolic cost studies: about 3.5 %
// more per 1 % up; down to −10 % descents save energy, steeper ones cost it back in braking)
export function gradeCost(g){
  g=Math.max(-25,Math.min(25,g));
  if(g>=0)return 1+0.035*g;
  if(g>=-10)return 1+0.018*g;
  return 0.82+(-10-g)*0.012;
}

// Target RPE at every route point for this pacer and intensity. Returns {d, rpe, start, end, intensity}
export function rpePlan(P,id='allout'){
  const I=INTENSITIES.find(x=>x.id===id)||INTENSITIES[0],n=P.d.length,mins=P.finish/60;
  // Shorter races start nearer their finishing effort; longer ones start well below it
  const s0=I.start??Math.max(3.5,Math.min(6.5,6.5-1.2*Math.log2(Math.max(1,mins)/20)))-(I.id==='hard'?0.5:0);
  const s1=I.end;
  // How hard the pacer is working here compared with its average: its speed times the grade cost
  const work=P.d.map((_,i)=>gradeCost(P.grade[i])/P.pace[i]);
  let wsum=0,tsum=0;
  for(let i=0;i<n-1;i++){const dt=P.time[i+1]-P.time[i];wsum+=work[i]*dt;tsum+=dt}
  const wavg=wsum/(tsum||1);
  const out=[];
  for(let i=0;i<n;i++){
    const f=P.time[i]/P.finish;
    const base=s0+(s1-s0)*Math.pow(f,1.2);
    const hill=Math.max(-1.5,Math.min(1.5,(work[i]/wavg-1)*25)); // about 1 RPE for every 4 % harder
    out.push(base+hill);
  }
  // Smooth over 150 m (effort lags the road), then give recovery over the top of each climb
  let r=smooth(out,P.d,150);
  const climbs=climbsOf(P);
  for(const c of climbs){
    const size=Math.min(1,c.gain/25),len=Math.min(300,150+c.gain*5);
    for(let i=0;i<n;i++){const x=P.d[i]-c.d1;if(x>0&&x<len)r[i]-=0.6*size*(1-x/len)}
  }
  // Before 40 % of the way, stay under the start band + 1 (+1.5 on a real hill) whatever the terrain;
  // and keep half a point below the finishing effort until the last 7 % of the run
  r=r.map((v,i)=>{
    const f=P.time[i]/P.finish,early=f<0.4?s0+(s1-s0)*Math.pow(f,1.2)+(P.grade[i]>3?1.5:1):99;
    const top=f<0.93?s1-0.5:I.cap; // the very top of the scale only in the final push, not for kilometres
    return Math.max(1,Math.min(I.cap,top,early,v));
  });
  return {d:P.d,rpe:r,start:s0,end:s1,intensity:I};
}
export function rpeAt(R,d){
  const D=R.d;if(d<=0)return R.rpe[0];if(d>=D.at(-1))return R.rpe.at(-1);
  let lo=0,hi=D.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(D[m]<=d)lo=m;else hi=m}
  return R.rpe[lo]+(R.rpe[hi]-R.rpe[lo])*(d-D[lo])/(D[hi]-D[lo]);
}

function smooth(v,d,w){
  const o=[];let a=0,b=0,s=0;
  for(let i=0;i<v.length;i++){
    while(b<v.length&&d[b]<=d[i]+w/2){s+=v[b];b++}
    while(d[a]<d[i]-w/2){s-=v[a];a++}
    o.push(s/(b-a));
  }
  return o;
}
// Climbs: stretches averaging over 2 % for at least 150 m, with their height gain
export function climbsOf(P){
  const out=[];let st=null;
  for(let i=0;i<P.d.length;i++){
    const up=P.grade[i]>2;
    if(up&&st==null)st=i;
    if((!up||i===P.d.length-1)&&st!=null){
      const e=i,len=P.d[e]-P.d[st];
      if(len>=150)out.push({d0:P.d[st],d1:P.d[e],gain:P.es[e]-P.es[st]});
      st=null;
    }
  }
  return out;
}

// When to ask how you feel: about a quarter, half and three quarters of the way (once on a short run),
// moved to just over the top if that falls on a climb, plus after the biggest climb if no check is near.
// Never in the last 800 m, and at least 1.2 km apart.
export function checkpoints(P){
  const D=P.total,cl=climbsOf(P),fr=D<3000?[0.5]:[0.25,0.5,0.75];
  const pts=fr.map(f=>{
    let d=f*D;const c=cl.find(c=>d>=c.d0-100&&d<=c.d1);
    if(c)d=c.d1+150;
    return d;
  });
  const big=cl.filter(c=>c.gain>=20).sort((a,b)=>b.gain-a.gain)[0];
  if(big&&!pts.some(d=>Math.abs(d-(big.d1+150))<1000))pts.push(big.d1+150);
  const out=[];
  for(const d of pts.sort((a,b)=>a-b))if(d<D-800&&d>400&&(!out.length||d-out.at(-1)>=1200))out.push(d);
  return out;
}

// Advice after you say how hard it feels. said: your RPE; at: where you are (m); t: your time (s).
// Returns {text, k (multiply the rest of the plan's time by this: < 1 faster, > 1 slower, or null),
// change (s/km on the plan's pace from here), status}
export function advise({R,P,said,at,t}){
  const target=rpeAt(R,at),diff=said-target,I=R.intensity,f=at/P.total;
  const left=P.total-at,restPace=left>50?(timeAt(P,P.total)-timeAt(P,at))/(left/1000):paceAt(P,at);
  const tgt=`about ${Math.round(target)}, ${rpeName(target).toLowerCase()}`;
  const offer=(k,why)=>{const ch=Math.round(restPace*(k-1));return Math.abs(ch)<2?null:{k,change:ch,text:why}};
  if(diff>=1&&!(f>0.85&&diff<1.5&&I.id!=='easy')){
    const k=1+Math.min(0.045,0.015*diff);
    const o=offer(k,`That's above where you want to be. It should feel ${tgt} here.`);
    if(o)return {...o,status:'high',text:`${o.text} Ease off by ${o.change} seconds a kilometre?`};
  }
  if(diff<=-1.5&&I.speedUp){
    if(f<0.3)return {k:null,change:0,status:'low-early',text:`Feeling good is normal this early. It should feel ${tgt}. Hold this and bank it for later.`};
    const k=1-Math.min(0.036,0.012*-diff);
    const o=offer(k,`You've got more in the tank. It's fine to feel ${tgt} here.`);
    if(o)return {...o,status:'low',text:`${o.text} Pick it up by ${-o.change} seconds a kilometre?`};
  }
  if(diff<=-1.5)return {k:null,change:0,status:'low-easy',text:'Nice and easy, exactly right for this run.'};
  if(diff>=1)return {k:null,change:0,status:'high-late',text:'It\'s meant to hurt now. Hang on, nearly there.'};
  return {k:null,change:0,status:'on',text:`Right where you should be. ${Math.round(target)} is the target here.`};
}

// Read an RPE out of what you said: "six", "6", "seven and a half", "about 8"
export function parseRpe(s){
  s=' '+String(s).toLowerCase().replace(/[^a-z0-9. ]/g,' ')+' ';
  const W={one:1,won:1,two:2,to:2,too:2,three:3,tree:3,four:4,for:4,five:5,six:6,sex:6,seven:7,eight:8,ate:8,nine:9,ten:10};
  let n=null;const m=s.match(/(\d+(?:\.\d)?)/);
  if(m)n=+m[1];
  else for(const [w,v] of Object.entries(W))if(new RegExp(` ${w} `).test(s)){n=v;break}
  if(n==null)return null;
  if(/half/.test(s)&&n%1===0)n+=0.5;
  return n>=1&&n<=10?n:null;
}
export const parseYesNo=s=>/\b(yes|yeah|yep|ok|okay|sure|do it|go on|please)\b/i.test(s)?true:/\b(no|nope|keep|stay|leave)\b/i.test(s)?false:null;
