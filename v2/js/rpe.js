// Optimal RPE (rate of perceived exertion, 1–10) along the course, check-ins and pacing advice.
//
// What it's based on, by the kind of run:
// - Easy / Zone 2 and comfortable runs are run by constant effort: Zone 2 is about RPE 3–4, and when
//   effort creeps up (hills, heat, cardiac drift) you slow down or walk rather than let it rise. So these
//   plans are flat, rising only a little on climbs.
// - Hard-but-controlled (tempo) runs hold "comfortably hard", RPE 6–7, building only slightly by the end
//   and finishing with something in reserve.
// - All-out races: RPE rises roughly linearly with the proportion of the race done and peaks at the
//   finish (Tucker's anticipatory "template" RPE). Shorter races start nearer their finishing effort.
//   Feeling fresh early is expected, not a sign to go faster, so speed-up advice waits until 30 % in.
//   Even pacing with a finishing kick is how 5 km to marathon world records are run.
// - On hills in a race, letting effort rise a little on climbs and fall on descents beats holding a
//   constant effort (variable-power studies, about 5 % over average on climbs), with recovery over the
//   top. Too much on climbs risks early fatigue, so the rise is capped.
// - On the CR-10 scale, the 2 mmol/L lactate boundary is about 4.3 and 4 mmol/L about 6.5.
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

// What you intend the run to be.
//   shape   'race': builds from start to end over the run; 'flat': the same effort throughout
//   start/end   RPE at the start and finish (an all-out race's start depends on its length, see rpePlan)
//   hill    how much of the pacer's extra work on a climb shows as extra RPE (1 = all of it)
//   up/down the most RPE may rise on a climb / fall on a descent; cap: never above this
//   recover a short easing over the top of each climb; speedUp: may suggest running faster
export const INTENSITIES=[
  {id:'allout',name:'All-out race',desc:'A PB attempt. Controlled at first, building steadily, nothing left at the line.',
   shape:'race',end:10,hill:1,up:1.5,down:1.5,cap:10,recover:true,speedUp:true},
  {id:'hard',name:'Hard, not all-out',desc:"Comfortably hard, like a tempo run or a parkrun you push but don't empty yourself on. Holds around 6 to 7, a little more by the end.",
   shape:'race',start:6,end:7.5,hill:0.6,up:1,down:1,cap:8,recover:true,speedUp:true},
  {id:'steady',name:'Comfortable',desc:'A steady run at the same effort all the way. Breathing settled, could talk in short sentences. A touch more on climbs.',
   shape:'flat',start:4.5,end:4.5,hill:0.35,up:0.5,down:0.5,cap:5,recover:false,speedUp:true},
  {id:'easy',name:'Zone 2 easy',desc:'Conversational, for building your aerobic base. The same easy effort throughout: slow right down, or walk, on hills to keep it there.',
   shape:'flat',start:3.5,end:3.5,hill:0.3,up:0.5,down:0.5,cap:4,recover:false,speedUp:false},
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
  // All-out: shorter races start nearer their finishing effort (about 6.5 for a 20-minute race, 5 for
  // 50 minutes, 3.5 for 2 hours or more). Hard: lower for long runs too.
  const race=Math.max(3.5,Math.min(6.5,6.5-1.2*Math.log2(Math.max(1,mins)/20)));
  const s0=I.id==='allout'?race:I.id==='hard'?Math.min(I.start,race+1):I.start,s1=I.end;
  const base=f=>I.shape==='flat'?s0:s0+(s1-s0)*(I.id==='allout'?Math.pow(f,1.2):f);
  // How hard the pacer is working here compared with its average: its speed times the grade cost
  const work=P.d.map((_,i)=>gradeCost(P.grade[i])/P.pace[i]);
  let wsum=0,tsum=0;
  for(let i=0;i<n-1;i++){const dt=P.time[i+1]-P.time[i];wsum+=work[i]*dt;tsum+=dt}
  const wavg=wsum/(tsum||1);
  const hillOf=i=>Math.max(-I.down,Math.min(I.up,(work[i]/wavg-1)*25*I.hill)); // about 1 RPE per 4 % harder
  // Smooth over 150 m (effort lags the road)
  let r=smooth(P.d.map((_,i)=>base(P.time[i]/P.finish)+hillOf(i)),P.d,150);
  // Races: recovery over the top of each climb
  if(I.recover)for(const c of climbsOf(P)){
    const size=Math.min(1,c.gain/25),len=Math.min(300,150+c.gain*5);
    for(let i=0;i<n;i++){const x=P.d[i]-c.d1;if(x>0&&x<len)r[i]-=0.6*size*(1-x/len)}
  }
  // Races: in the first 40 % stay within 1 of the build (1.5 on a real hill) whatever the terrain, and
  // keep half a point below the finishing effort until the final push (the last 7 %)
  r=r.map((v,i)=>{
    const f=P.time[i]/P.finish;let hi=I.cap;
    if(I.shape==='race'){if(f<0.4)hi=Math.min(hi,base(f)+(P.grade[i]>3?1.5:1));if(f<0.93)hi=Math.min(hi,s1-0.5)}
    return Math.max(1,Math.min(hi,I.shape==='flat'?Math.max(s0-I.down,v):v));
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
  if(diff>=1&&!(f>0.85&&diff<1.5&&I.shape==='race')){
    const k=1+Math.min(0.045,0.015*diff);
    const o=offer(k,`That's above where you want to be. It should feel ${tgt} here.`);
    if(o)return {...o,status:'high',text:`${o.text} Ease off by ${o.change} seconds a kilometre?`};
  }
  if(diff<=-1.5&&I.speedUp){
    if(f<0.3&&I.shape==='race')return {k:null,change:0,status:'low-early',text:`Feeling good is normal this early. It should feel ${tgt}. Hold this and bank it for later.`};
    const k=1-Math.min(0.036,0.012*-diff);
    const o=offer(k,`You've got more in the tank. It's fine to feel ${tgt} here.`);
    if(o)return {...o,status:'low',text:`${o.text} Pick it up by ${-o.change} seconds a kilometre?`};
  }
  if(diff<=-1.5)return {k:null,change:0,status:'low-easy',text:'Nice and easy, exactly right for this run.'};
  if(diff>=1&&I.shape==='race')return {k:null,change:0,status:'high-late',text:'It\'s meant to hurt now. Hang on, nearly there.'};
  if(diff>=1)return {k:null,change:0,status:'high',text:`A bit above the ${tgt} this run is meant to be. Ease back a little.`};
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

// Colour for an RPE: green (easy) through yellow and orange to red (maximal)
export const rpeCol=r=>r<2.5?'#86efac':r<4.5?'#a3e635':r<6.5?'#facc15':r<8?'#fb923c':r<9?'#f87171':'#ef4444';
// RPE shown to the nearest half
export const rpeRound=r=>Math.round(r*2)/2;
// Where to write the target RPE beside the road: wherever it changes (to the nearest half), at least
// 100 m apart, and every 400 m regardless so there's always one coming up
export function rpeMarks(R){
  const out=[],D=R.d.at(-1);let last=null,lastD=-1e9;
  for(let d=0;d<D-30;d+=25){
    const r=rpeRound(rpeAt(R,d));
    if((r!==last&&d-lastD>=100)||d-lastD>=400){out.push({d,r});last=r;lastD=d}
  }
  return out;
}
