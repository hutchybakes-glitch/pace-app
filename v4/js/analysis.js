// Insights: what your runs say about how you run. Everything here is fitted from your own recorded and
// imported runs, on the phone (nothing is sent anywhere):
//   - every run is cut into 100 m segments with its gradient, pace, cadence and stride
//   - a hill model (how much you slow per % of climb, how much descents give back) is fitted to those
//     segments by least squares, and blended with the typical runner's until there's plenty of your data
//   - with hills taken out ("flat-equivalent pace"), your fitness trend, race predictions, pacing
//     evenness and fade come out of the same segments
// Paces are s/km, distances m, times s. No DOM: runs under node --test.
import {smooth} from './route.js';
import {CLIMB,DESCENT,effort} from './pacer.js';

export const SEG=100;            // segment length (m)
export const SKIP_START=300;     // the first bit of a run (standing start, GPS settling) is left out
export const PRIOR=25;           // the typical runner counts as this many segments of evidence
export const TYPICAL={climb:CLIMB.average,gain:DESCENT.average.gain,taper:DESCENT.average.taper};
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const median=a=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;

// Your own runs: a friend's run (a challenge, or an imported run with their name) can be raced, but it
// isn't learned from and doesn't count towards your bests or totals
export const mine=r=>!r.imported?.who;
// Runs that can be analysed: yours, finished, on a route with points, with enough timed fixes
export const usable=runs=>runs.filter(r=>mine(r)&&r.status==='done'&&r.mode!=='intervals'&&r.route?.pts?.length>20&&(r.fixes?.length||0)>20);

// Efforts over different distances made comparable: a flat-equivalent pace over dist as the pace it's
// worth over 10 km (Riegel: pace scales with distance^0.06)
export const eq10=(fp,dist)=>fp*Math.pow(10000/dist,0.06);
export const FORM_DAYS=42;
// What kind of run, from how hard it was against your best around then (10 km-equivalent pace within six
// weeks either side): race ≤ 3.5 % off it, tempo ≤ 12 %, else easy (long if 14 km or more). A purpose set
// before the run (race, tempo, easy) wins.
export const KINDS={race:{name:'Race',icon:'🏁'},tempo:{name:'Tempo',icon:'🔥'},easy:{name:'Easy',icon:'🌿'},long:{name:'Long',icon:'🛤️'},int:{name:'Intervals',icon:'⏱️'}};
export function classify(per){
  for(const x of per){
    const t=x.run.started,ref=Math.min(...per.filter(y=>Math.abs(y.run.started-t)<=FORM_DAYS*864e5).map(y=>y.eq));
    x.ratio=x.eq/ref;
    const p=x.run.purpose,auto=x.ratio<=1.035?'race':x.ratio<=1.12?'tempo':'easy';
    x.kind=p==='race'||p==='tempo'?p:p==='easy'||auto==='easy'?(x.dist>=14000?'long':'easy'):auto;
  }
  return per;
}
// Your form at time t: your strongest 10 km-equivalent pace in the six weeks up to then (null if none)
export function formAt(per,t){
  const v=per.filter(x=>x.run.started<=t&&t-x.run.started<FORM_DAYS*864e5).map(x=>x.eq);
  return v.length?Math.min(...v):null;
}

// Best efforts: your quickest time over each distance anywhere inside a run (not intervals). A run a few
// metres short of a distance (a 4.99 km parkrun) counts at its own pace. [{id, name, d, t, run}]
export const BESTS=[{id:'1k',name:'1 km',d:1000},{id:'5k',name:'5K',d:5000},{id:'10k',name:'10K',d:10000},{id:'half',name:'Half',d:21097.5}];
export function effortsOf(run){
  const F=[];let far=-1;
  for(const f of run.fixes||[]){const d=f[10]??f[6];if(d==null||!(d>far+0.5))continue;far=d;F.push([d,f[1]/1000])}
  if(F.length<10)return {};
  const at=x=>{let lo=0,hi=F.length-1;if(x<=F[0][0])return F[0][1];while(hi-lo>1){const m=(lo+hi)>>1;if(F[m][0]<=x)lo=m;else hi=m}
    const a=F[lo],b=F[hi];return a[1]+(b[1]-a[1])*(x-a[0])/((b[0]-a[0])||1)};
  const total=F.at(-1)[0]-F[0][0],out={};
  for(const B of BESTS){
    if(total<B.d-30)continue;
    if(total<B.d){out[B.id]=(F.at(-1)[1]-F[0][1])*B.d/total;continue}
    let best=Infinity;for(const [d,t] of F){if(d-B.d<F[0][0])continue;best=Math.min(best,t-at(d-B.d))}
    if(best<Infinity&&best/(B.d/1000)>=120)out[B.id]=best;
  }
  return out;
}
export function bests(runs){
  const out={};
  for(const r of runs){
    if(!mine(r)||r.status!=='done'||r.mode==='intervals'||r.mode==='free')continue;
    const e=effortsOf(r);for(const [k,t] of Object.entries(e))if(!out[k]||t<out[k].t)out[k]={...BESTS.find(b=>b.id===k),t,run:r};
  }
  return BESTS.map(b=>out[b.id]).filter(Boolean);
}

// Effort multiplier at grade g for a model {climb, gain, taper}
export const effortOf=(m,g)=>effort(g,m.climb,{gain:m.gain,taper:m.taper});

// A run's 100 m segments: {segs:[{d, grade, pace, cad, stride, t, frac}], time, dist}
export function segments(run){
  const pts=run.route.pts,es=smooth(pts.map(p=>({...p,ele:p.ele??0})),120),n=pts.length;
  const eleAt=d=>{const i=d/10,a=Math.max(0,Math.min(n-1,Math.floor(i))),b=Math.min(n-1,a+1),f=i-a;return es[a]+(es[b]-es[a])*f};
  // the run as a timeline along the route (route distance only ever increasing)
  const F=[];let far=-1;const stop=run.freestyle?.rd??Infinity;
  for(const f of run.fixes){const rd=f[6];if(rd==null||rd>stop||!(rd>far+0.5))continue;far=rd;F.push({rd,ran:f[10]??rd,t:f[1]/1000,cad:f[8],str:f[9]})}
  if(F.length<5)return {segs:[],time:0,dist:0};
  const at=(d,k)=>{let lo=0,hi=F.length-1;if(d<=F[0].rd)return F[0][k];if(d>=F[hi].rd)return F[hi][k];
    while(hi-lo>1){const m=(lo+hi)>>1;if(F[m].rd<=d)lo=m;else hi=m}const a=F[lo],b=F[hi];return a[k]+(b[k]-a[k])*(d-a.rd)/(b.rd-a.rd)};
  const segs=[];let j=0;
  for(let a=0;a+SEG<=F.at(-1).rd;a+=SEG){
    const b=a+SEG,ta=at(a,'t'),tb=at(b,'t'),ran=at(b,'ran')-at(a,'ran');
    if(Math.abs(ran-SEG)>20)continue; // part of the course cut off, or extra run off it
    while(j<F.length&&F[j].rd<a)j++;
    const inside=[];for(let k=j;k<F.length&&F[k].rd<b;k++)inside.push(F[k]);
    const cads=inside.map(x=>x.cad).filter(x=>x>=100&&x<=240),strs=inside.map(x=>x.str).filter(x=>x>=0.4&&x<=2.5);
    segs.push({d:a,grade:(eleAt(b)-eleAt(a))/SEG*100,pace:(tb-ta)/(SEG/1000),cad:mean(cads),stride:mean(strs),t:ta});
  }
  const time=F.at(-1).t,med=median(segs.map(s=>s.pace));
  // running pace only: stops (a long way slower than the run's typical pace) and GPS glitches are dropped
  const ok=segs.filter(s=>s.pace>=150&&s.pace<=900&&s.pace<med*2.2);
  for(const s of ok)s.frac=time>0?s.t/time:0;
  return {segs:ok,time,dist:F.at(-1).rd};
}

// A run's flat-equivalent pace under model m: what its effort would have been worth on the flat
export function flatPace(segs,m){
  const use=segs.filter(s=>s.d>=SKIP_START);if(use.length<3)return null;
  let T=0,E=0;for(const s of use){T+=s.pace;E+=effortOf(m,s.grade)}
  return T/E;
}

// Fit the hill model to segments from many runs: [{grade, r}] where r = pace ÷ that run's flat pace.
// Uphill: r = 1 + climb·g (least squares through 1 at the flat). Downhill: r = 1 + gain·g down to the
// taper grade, braking after it (grid search). Each is blended with the typical runner by how much
// data there is. Returns {climb, gain, taper, nUp, nDown}
export function fitHills(pts){
  const up=pts.filter(p=>p.grade>=1&&p.grade<=20),down=pts.filter(p=>p.grade<=-1&&p.grade>=-20);
  // uphill, with one pass to drop outliers
  let c=TYPICAL.climb,nUp=0;
  for(let pass=0;pass<2;pass++){
    const use=up.filter(p=>pass===0||Math.abs(p.r-1-c*p.grade)<0.3);
    const sg=use.reduce((a,p)=>a+p.grade*p.grade,0),sr=use.reduce((a,p)=>a+p.grade*(p.r-1),0);
    if(sg>0)c=clip(sr/sg,0.005,0.09);nUp=use.length;
  }
  c=(nUp*c+PRIOR*TYPICAL.climb)/(nUp+PRIOR);
  // downhill: gain on a grid, taper only if there are enough steep descents to tell
  const steep=down.filter(p=>p.grade<-7).length,tapers=steep>=10?[-6,-8,-10,-12,-14,-16]:[TYPICAL.taper];
  let best=null;
  for(const taper of tapers)for(let gain=0;gain<=0.045;gain+=0.001){
    let e=0;for(const p of down){const x=p.r-effort(p.grade,0,{gain,taper});e+=Math.min(x*x,0.09)} // (capped: outliers)
    if(!best||e<best.e)best={e,gain,taper};
  }
  const nDown=down.length,gain=best?(nDown*best.gain+PRIOR*TYPICAL.gain)/(nDown+PRIOR):TYPICAL.gain;
  return {climb:c,gain,taper:best?.taper??TYPICAL.taper,nUp,nDown};
}

// Average r in 1 % gradient bins (for the chart's dots): [{grade, r, n}]
export function binned(pts){
  const b={};for(const p of pts){const k=Math.round(p.grade);if(k<-12||k>12)continue;(b[k]??=[]).push(p.r)}
  return Object.entries(b).map(([k,v])=>({grade:+k,r:median(v),n:v.length})).filter(x=>x.n>=3).sort((a,b)=>a.grade-b.grade);
}

// Cadence against speed: cadence = a + b·v (v m/s), and how cadence and stride change on climbs and
// descents at the same speed. Null without cadence data.
export function fitCadence(runSegs){
  const all=runSegs.flatMap(x=>x.segs).filter(s=>s.cad&&s.d>=SKIP_START);
  if(all.length<15)return null;
  const P=all.map(s=>({v:1000/s.pace,c:s.cad,g:s.grade,st:s.stride}));
  // speed vs cadence from flat-ish ground (on hills cadence moves with the gradient, not just speed)
  const L=P.filter(p=>Math.abs(p.g)<2).length>=10?P.filter(p=>Math.abs(p.g)<2):P;
  const mv=mean(L.map(p=>p.v)),mc=mean(L.map(p=>p.c));
  let sxy=0,sxx=0;for(const p of L){sxy+=(p.v-mv)*(p.c-mc);sxx+=(p.v-mv)**2}
  const b=sxx>0.05?clip(sxy/sxx,0,20):6,a=mc-b*mv;
  const res=k=>{const v=P.filter(k);return v.length>=5?mean(v.map(p=>p.c-(a+b*p.v))):null};
  const strideRatio=(k)=>{const f=P.filter(p=>Math.abs(p.g)<1&&p.st),x=P.filter(p=>k(p)&&p.st);return f.length>=5&&x.length>=5?mean(x.map(p=>p.st))/mean(f.map(p=>p.st)):null};
  return {a,b,n:P.length,mean:mc,base:a-(6-b)*mv, // base: on the guide's line (base + 6·v) through your average
    up:res(p=>p.g>3),down:res(p=>p.g<-3),strideUp:strideRatio(p=>p.g>3),strideDown:strideRatio(p=>p.g<-3),
    at:v=>a+b*v,points:P};
}

// Pacing in one run, hills taken out: how even (CV of km flat-equivalent pace, %) and how much you faded
// (last third vs first third, % slower; negative = finished quicker)
export function pacing(segs,m){
  const use=segs.filter(s=>s.d>=SKIP_START);if(use.length<15)return null;
  const gap=use.map(s=>({d:s.d,frac:s.frac,p:s.pace/effortOf(m,s.grade)}));
  const km={};for(const g of gap)(km[Math.floor(g.d/1000)]??=[]).push(g.p);
  const kp=Object.values(km).filter(v=>v.length>=5).map(mean);
  const mk=mean(kp),cv=kp.length>=2?Math.sqrt(mean(kp.map(x=>(x-mk)**2)))/mk*100:null;
  const first=gap.filter(g=>g.frac<1/3).map(g=>g.p),last=gap.filter(g=>g.frac>2/3).map(g=>g.p);
  const fade=first.length>=3&&last.length>=3?(mean(last)/mean(first)-1)*100:null;
  return {cv,fade};
}

// Riegel: time over D2 from time T1 over D1
export const riegel=(T1,D1,D2)=>T1*Math.pow(D2/D1,1.06);
export const LONG_NEED=0.6;
export const RACES=[{id:'5k',name:'5K',d:5000},{id:'10k',name:'10K',d:10000},{id:'half',name:'Half marathon',d:21097.5},{id:'mar',name:'Marathon',d:42195}];

// Scores out of 100 (50 = a typical runner)
export const score={
  climb:c=>Math.round(clip(50+(TYPICAL.climb-c)/TYPICAL.climb*110,3,99)),
  descent:g=>Math.round(clip(50+(g-TYPICAL.gain)/TYPICAL.gain*60,3,99)),
  pacing:cv=>Math.round(clip(100-cv*12,3,99)),
  endurance:fade=>Math.round(clip(65-fade*7,3,99)),
  cadence:base=>Math.round(clip(50+(base-150)*2.5,3,99)),
  speed:p=>Math.round(clip((450-p)/270*100,3,99)),
};

// The kind of runner the scores add up to
export function runnerType(s){
  const T=(id,icon,name,desc)=>({id,icon,name,desc});
  if(s.climb>=68&&s.descent>=68)return T('goat','🐐','Mountain goat','Strong both ways on hills: you bank time on every climb and every descent.');
  if(s.climb>=68)return T('climber','⛰️','Climber','Hills are your weapon: you lose far less time going up than most runners.');
  if(s.descent>=68)return T('descender','🪂','Descender','You let gravity work: descents give you more time than they give most runners.');
  if(s.climb<=32&&s.descent<=35)return T('road','🛣️','Road runner','Built for flat, fast roads. Hills cost you more than most, so pace them gently.');
  if(s.endurance!=null&&s.endurance>=78)return T('closer','📈','Closer','You finish stronger than you start: patient early, dangerous late.');
  if(s.pacing!=null&&s.pacing>=78)return T('metronome','⏱️','Metronome','Remarkably even effort from start to finish, whatever the road does.');
  if(s.endurance!=null&&s.endurance<=35)return T('front','🔥','Front-runner','You go out hard and fight to hold on. A little patience early could buy a lot late.');
  return T('allround','⚖️','All-rounder','No obvious weakness: balanced on climbs, descents and pacing.');
}

// Everything for the Insights screen. runs: saved runs; now: ms (for the trend window)
export function analyse(runs,now=Date.now()){
  const R=usable(runs).sort((a,b)=>a.started-b.started).map(run=>({run,...segments(run)})).filter(x=>x.segs.length>=10);
  const km=R.reduce((a,x)=>a+x.dist,0)/1000;
  if(R.length<1)return {ready:false,runs:0,need:1,km};
  // hill model. Each run's own flat pace and climbing slope come from a straight line through its pace
  // against gradient on flat and uphill segments (so a run's flat pace doesn't depend on the model), and
  // the slopes are pooled, weighted by how much gradient each run had. Descents: pace ÷ that flat pace.
  const lines=R.map(x=>{
    const u=x.segs.filter(s=>s.d>=SKIP_START&&s.grade>=-0.5&&s.grade<=15);if(u.length<8)return null;
    const mg=mean(u.map(s=>s.grade)),mp=mean(u.map(s=>s.pace));let sxy=0,sxx=0;
    for(const s of u){sxy+=(s.grade-mg)*(s.pace-mp);sxx+=(s.grade-mg)**2}
    if(sxx<8)return null; // hardly any climbing: nothing to learn the slope from
    const B=sxy/sxx,A=mp-B*mg;return A>100?{A,c:B/A,w:sxx,n:u.filter(s=>s.grade>=1).length}:null;
  });
  const L=lines.filter(Boolean),W=L.reduce((a,l)=>a+l.w,0),nUp=L.reduce((a,l)=>a+l.n,0);
  const cData=W?clip(L.reduce((a,l)=>a+l.c*l.w,0)/W,0.005,0.09):TYPICAL.climb;
  let m={...TYPICAL,climb:(nUp*cData+PRIOR*TYPICAL.climb)/(nUp+PRIOR)};
  const pts=[];
  R.forEach((x,i)=>{const fp=lines[i]?.A??flatPace(x.segs,m);if(!fp)return;for(const s of x.segs)if(s.d>=SKIP_START)pts.push({grade:s.grade,r:s.pace/fp})});
  const f=fitHills(pts);m={climb:m.climb,gain:f.gain,taper:f.taper,nUp,nDown:f.nDown};
  // per run: flat-equivalent pace, pacing
  const per=classify(R.map(x=>{const fp=flatPace(x.segs,m);return {run:x.run,dist:x.dist,time:x.time,fp,eq:fp&&eq10(fp,x.dist),...(pacing(x.segs,m)||{})}}).filter(x=>x.fp));
  // pacing is about the runs you push: races and tempo runs (all runs until there are a couple of those)
  const hard=per.filter(x=>x.kind==='race'||x.kind==='tempo'),pace=hard.filter(x=>x.cv!=null).length>=2?hard:per;
  const cvs=pace.map(x=>x.cv).filter(x=>x!=null),fades=pace.map(x=>x.fade).filter(x=>x!=null);
  const races=per.filter(x=>x.kind==='race'&&x.fade!=null);
  const cad=fitCadence(R);
  // form: your strongest 10 km-equivalent effort over the last six weeks, at each run; trend (s/km per
  // 30 days) of that over the last 120 days
  for(const x of per)x.form=formAt(per,x.run.started);
  const recent=per.filter(x=>now-x.run.started<120*864e5&&x.run.started<=now);
  let trend=null;
  if(recent.length>=3){
    const X=recent.map(x=>(x.run.started-now)/864e5),Y=recent.map(x=>x.form),mx=mean(X),my=mean(Y);
    let sxy=0,sxx=0;X.forEach((x,i)=>{sxy+=(x-mx)*(Y[i]-my);sxx+=(x-mx)**2});
    if(sxx>1)trend=sxy/sxx*30;
  }
  // predictions: from each recent run of 3 km or more, its flat-equivalent time scaled by Riegel; the
  // best (quickest) for each distance, not reaching further than 4.5 times the run's distance
  const src=(recent.length?recent:per).filter(x=>x.dist>=3000);
  // the long races also need the legs for them: a long run of at least LONG_NEED of the distance in the
  // last four months (else Riegel flatters a runner who's never gone that far)
  const longest=Math.max(0,...(recent.length?recent:per).map(x=>x.dist)),locked=[];
  const predict=RACES.map(rc=>{
    if(rc.d>15000&&longest<rc.d*LONG_NEED){locked.push({...rc,need:Math.ceil(rc.d*LONG_NEED/1000)});return null}
    let best=null;for(const x of src){if(rc.d/x.dist>4.5)continue;const t=riegel(x.fp*x.dist/1000,x.dist,rc.d);if(!best||t<best.t)best={t,from:x.run}}
    return best&&{...rc,...best};
  }).filter(Boolean);
  const bestFp=Math.min(...per.map(x=>x.fp));
  const s={climb:score.climb(m.climb),descent:score.descent(m.gain),
    pacing:cvs.length?score.pacing(median(cvs)):null,endurance:fades.length?score.endurance(median(fades)):null,
    cadence:cad?score.cadence(cad.base):null,speed:score.speed(bestFp)};
  return {ready:R.length>=1,runs:R.length,need:1,km,segs:pts.length,model:m,hills:binned(pts),per,trend,predict,cadence:cad,
    cv:cvs.length?median(cvs):null,fade:fades.length?median(fades):null,scores:s,type:runnerType(s),bestFp,
    locked,longest,form:formAt(per,now),raceFade:races.length>=2?median(races.map(x=>x.fade)):null,nRaces:per.filter(x=>x.kind==='race').length,
    kindOf:new Map(per.map(x=>[x.run.id,x.kind]))};
}

// Percent slower (+) or quicker (−) than on the flat at grade g, for a model
export const pctAt=(m,g)=>(effortOf(m,g)-1)*100;

// A pacer profile that runs the hills the way you do (pacer.js reads fit)
export function learnedProfile(a){
  if(!a?.ready)return null;
  const m=a.model,near=(v,tab,key)=>Object.entries(tab).filter(([k])=>k!=='none').sort((x,y)=>Math.abs(key(x[1])-v)-Math.abs(key(y[1])-v))[0][0];
  return {id:'me',name:'Like you',icon:'🧬',climb:near(m.climb,CLIMB,x=>x),descent:near(m.gain,DESCENT,x=>x.gain),strategy:'even',
    fit:{climb:+m.climb.toFixed(4),gain:+m.gain.toFixed(4),taper:m.taper},
    desc:`Learned from your ${a.runs} runs: slows ${pctAt(m,5).toFixed(0)} % up a 5 % climb, ${Math.abs(pctAt(m,-5)).toFixed(0)} % quicker down a 5 % descent.`};
}

// Your likely time over a course today (pacer P): your strongest recent flat-equivalent pace, scaled to
// the course's distance (Riegel), then slowed and quickened by your own hill model at every point
export function courseTime(A,P,now=Date.now()){
  if(!A?.ready)return null;
  const D=P.total,past=A.per.filter(x=>x.run.started<=now&&x.dist>=1500),recent=past.filter(x=>now-x.run.started<120*864e5),pool=recent.length?recent:past;
  if(!pool.length)return null;
  let best=null;for(const x of pool){const fp=x.fp*Math.pow(D/x.dist,0.06);if(!best||fp<best.fp)best={fp,from:x.run}}
  let T=0;for(let i=1;i<P.d.length;i++)T+=best.fp*effortOf(A.model,(P.grade[i-1]+P.grade[i])/2)*(P.d[i]-P.d[i-1])/1000;
  return {t:T,from:best.from};
}

// Interval sessions you've repeated (the same reps on the same stretch of the same route), session by
// session: average rep pace, against target, and how much the last rep slows on the first (s/km)
export function sessionProgress(runs){
  const key=r=>{const c=r.session||{};return `${r.route?.id}|${c.kind}|${c.kind==='split'?c.slen:`${c.from}-${c.len}-${c.dir}`}`};
  const G={};
  for(const r of runs){if(!mine(r)||r.mode!=='intervals'||r.status!=='done'||!(r.reps||[]).some(x=>x.done&&x.dist>0))continue;(G[key(r)]??=[]).push(r)}
  return Object.values(G).filter(g=>g.length>=2).map(g=>{
    g.sort((a,b)=>a.started-b.started);
    const S=g.map(r=>{
      const R=r.reps.filter(x=>x.done&&x.dist>0),T=R.reduce((a,x)=>a+x.time,0),D=R.reduce((a,x)=>a+x.dist,0);
      return {run:r,t:r.started,n:R.length,pace:T/(D/1000),vs:R.reduce((a,x)=>a+x.time-(x.pacer??x.time),0)/R.length,
        fade:R.length>=3?(R.at(-1).time/(R.at(-1).dist/1000)-R[0].time/(R[0].dist/1000)):null};
    });
    const c=g.at(-1).session||{},len=c.kind==='split'?c.slen:c.len,fades=S.map(x=>x.fade).filter(x=>x!=null);
    return {route:g[0].route?.name||'',len,reps:S.at(-1).n,sessions:S,first:S[0].pace,last:S.at(-1).pace,best:Math.min(...S.map(x=>x.pace)),
      fade:fades.length?median(fades):null};
  }).sort((a,b)=>b.sessions.at(-1).t-a.sessions.at(-1).t);
}
