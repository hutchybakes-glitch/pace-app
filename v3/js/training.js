// Training plans: a programme from now to race day, built on current coaching practice:
//   - fitness as VDOT (Daniels & Gilbert's oxygen-cost model): a race or a time trial gives it, and it
//     gives every training pace (easy, marathon, threshold, interval, repetition) and race predictions
//   - periodised: base (aerobic, hills, strides) → build (threshold and VO2max) → peak (race-specific)
//     → taper (volume down ~40–60 %, intensity kept), with a lighter week every fourth week and a fitness
//     retest at the end of it
//   - mostly easy running (80/20 or pyramidal), volume up no more than ~10 % a week
//   - four styles: endurance (more volume, polarised), balanced (pyramidal), quality (lower mileage, three
//     key runs), threshold (Norwegian singles: two or three sub-threshold interval sessions)
//   - how each session felt (effort 1–10, legs, energy, pain) nudges paces and swaps hard days for easy
//     ones when you're tired
// Paces s/km, distances m, times s (dates ms). No DOM: runs under node --test.

const DAY=864e5,WEEK=7*DAY;
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const kmt=m=>{const k=m/1000;return Math.abs(k-Math.round(k))<0.05?String(Math.round(k)):k.toFixed(1)};

// ---------------------------------------------------------------------------------------------------
// Fitness: VDOT
// ---------------------------------------------------------------------------------------------------
// Oxygen cost (ml/kg/min) of running at v m/min, and the fraction of VO2max you can hold for t minutes
export const vo2=v=>-4.60+0.182258*v+0.000104*v*v;
export const pctMax=t=>0.8+0.1894393*Math.exp(-0.012778*t)+0.2989558*Math.exp(-0.1932605*t);
// VDOT from a race or time trial: d m in s seconds
export const vdotOf=(d,s)=>{const t=s/60;return vo2(d/t)/pctMax(t)};
// Race time (s) over d m for a VDOT
export function raceTime(v,d){
  let lo=d/1000*100,hi=d/1000*1200;
  for(let k=0;k<60;k++){const m=(lo+hi)/2;if(vdotOf(d,m)>v)lo=m;else hi=m}
  return (lo+hi)/2;
}
// Pace (s/km) that costs fraction f of VDOT
export const paceAtPct=(v,f)=>{const a=0.000104,b=0.182258,c=-4.60-f*v,vel=(-b+Math.sqrt(b*b-4*a*c))/(2*a);return 60000/vel};
// Training paces for a VDOT (flat, still air; the pacer then takes each route's hills)
export function paces(v,{easyAdj=1}={}){
  const P=f=>paceAtPct(v,f);
  return {easy:P(0.67)*easyAdj,easyLo:P(0.62)*easyAdj,easyHi:P(0.72)*easyAdj,long:P(0.66)*easyAdj,recovery:P(0.6)*easyAdj,
    mar:raceTime(v,42195)/42.195,half:raceTime(v,21097.5)/21.0975,thr:P(0.88),sub:P(0.845),int:P(0.975),rep:P(1.07),
    r5k:raceTime(v,5000)/5,r10k:raceTime(v,10000)/10};
}
export const PACE_NAMES=[['easy','Easy','🌿'],['long','Long run','🛤️'],['mar','Marathon','🏃'],['sub','Sub-threshold','🌊'],['thr','Threshold','🔥'],['int','Interval','⚡'],['rep','Repetition','🚀']];

// ---------------------------------------------------------------------------------------------------
// Races and styles
// ---------------------------------------------------------------------------------------------------
export const DIST={
  '5k':{name:'5K',d:5000,taper:1,longCap:14,peak:{endurance:42,balanced:36,quality:26,threshold:36}},
  '10k':{name:'10K',d:10000,taper:1,longCap:18,peak:{endurance:52,balanced:45,quality:32,threshold:45}},
  half:{name:'Half marathon',d:21097.5,taper:2,longCap:22,peak:{endurance:64,balanced:56,quality:40,threshold:56}},
  mar:{name:'Marathon',d:42195,taper:3,longCap:32,peak:{endurance:85,balanced:72,quality:52,threshold:72}},
};
export const STYLES={
  endurance:{name:'Endurance',sub:'Higher mileage · 80/20',icon:'🛤️',vol:1.15,longShare:0.28,
    desc:'About 80 % of your running easy, and more of it, with two hard sessions a week: one fast, one at threshold. Builds the biggest engine; the most time on your feet.'},
  balanced:{name:'Balanced',sub:'Pyramidal · the all-rounder',icon:'⚖️',vol:1,longShare:0.3,
    desc:'Mostly easy, a threshold session and a faster session each week, and race-pace work as the race gets close. Research finds it works as well as anything for most runners.'},
  quality:{name:'Quality',sub:'Lower mileage · three key runs',icon:'🎯',vol:0.8,longShare:0.33,
    desc:'Three key runs a week (intervals, tempo, long) and little else; other days are short and easy, or cross-training. For busy weeks or injury-prone legs: less running, every run counts.'},
  threshold:{name:'Threshold',sub:'Norwegian singles',icon:'🌊',vol:1,longShare:0.28,
    desc:'Two or three sub-threshold interval sessions a week (comfortably hard, never all-out) and easy running in between. Very repeatable, kind to the legs, big aerobic gains; no flat-out speedwork.'},
};
export const PHASES={base:{name:'Base',col:'#2dd4bf'},build:{name:'Build',col:'#60a5fa'},peak:{name:'Peak',col:'#fb923c'},taper:{name:'Taper',col:'#4ade80'}};

// How each kind of session should feel (effort out of 10), and its colour family on Today
export const KINDS={
  easy:{name:'Easy',rpe:[2,4],fam:'easy'},recovery:{name:'Recovery',rpe:[1,3],fam:'easy'},strides:{name:'Easy + strides',rpe:[2,4],fam:'easy'},
  fartlek:{name:'Fartlek',rpe:[4,6],fam:'easy'},long:{name:'Long run',rpe:[3,5],fam:'long'},progression:{name:'Progression run',rpe:[5,7],fam:'tempo'},
  tempo:{name:'Tempo',rpe:[6,7],fam:'tempo'},cruise:{name:'Cruise intervals',rpe:[6,8],fam:'tempo'},sub:{name:'Sub-threshold',rpe:[5,7],fam:'tempo'},
  hills:{name:'Hill reps',rpe:[7,9],fam:'int'},vo2:{name:'VO2max intervals',rpe:[8,9],fam:'int'},racepace:{name:'Race-pace reps',rpe:[7,9],fam:'int'},
  test:{name:'Fitness test',rpe:[9,10],fam:'race'},race:{name:'Race day',rpe:[9,10],fam:'race'},rest:{name:'Rest',rpe:[0,0],fam:'rest'},
};
export const HARD=new Set(['tempo','cruise','sub','hills','vo2','racepace','progression','test','race']);
export const RPE_WORDS=['','Very easy','Easy','Easy','Steady','Moderate','Comfortably hard','Hard','Very hard','Extremely hard','Max'];

// ---------------------------------------------------------------------------------------------------
// The programme
// ---------------------------------------------------------------------------------------------------
// Which days you run (0 = Monday), by runs a week, with the long run on Sunday (6) or Saturday (5)
const RUN_DAYS={3:[1,3,6],4:[1,3,5,6],5:[0,1,3,5,6],6:[0,1,2,3,5,6]};
export const mondayOf=ms=>{const d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()};
// Calendar arithmetic in local time (a week across the clocks changing is still seven days): midnight
// n days after ms, and a day's number (for comparing days)
export const addDays=(ms,n)=>{const d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()+n);return d.getTime()};
export const dayNum=ms=>{const d=new Date(ms);return Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY)};

// The weeks: phase, lighter weeks, tests. cfg: {start (ms, when the plan began), raceDate, dist, test}
export function skeleton(cfg){
  const m0=mondayOf(cfg.start),W=clip(Math.round((dayNum(mondayOf(cfg.raceDate))-dayNum(m0))/7)+1,1,40),D=DIST[cfg.dist];
  const T=Math.min(D.taper,Math.max(1,Math.floor(W/4))),R=W-T;
  const base=R>=4?Math.round(R*0.4):Math.min(R,1),build=R>=3?Math.round(R*0.35):Math.max(0,R-base),peak=Math.max(0,R-base-build);
  return Array.from({length:W},(_,w)=>{
    const phase=w<base?'base':w<base+build?'build':w<R?'peak':'taper';
    const cut=phase!=='taper'&&(w+1)%4===0&&w<R-1;   // every fourth week lighter (not the one before the taper)
    const start=phase==='base'?0:phase==='build'?base:phase==='peak'?base+build:R,len=phase==='base'?base:phase==='build'?build:phase==='peak'?peak:T;
    return {w,monday:addDays(m0,7*w),phase,cut,test:(w===0&&cfg.test)||cut,p:len>1?(w-start)/(len-1):1,fromRace:W-1-w};
  });
}

// Weekly distance and long run for each week: from where you are now towards the style's peak, at most
// +10 % a week, 75 % in lighter weeks, then the taper
export function volumes(cfg,weeks){
  const D=DIST[cfg.dist],S=STYLES[cfg.style],K0=Math.max(8,cfg.km||15),peak=Math.max(K0,Math.min(D.peak[cfg.style]*Math.max(0.7,Math.min(1.3,cfg.days/5)),K0*1.6));
  const build=weeks.filter(x=>x.phase!=='taper').length,taperF={1:[0.6],2:[0.75,0.5],3:[0.8,0.65,0.45]}[weeks.filter(x=>x.phase==='taper').length]||[0.6];
  let k=K0,top=K0,lg=Math.max(5,cfg.longKm||K0*0.3);
  return weeks.map((x,i)=>{
    if(x.phase==='taper'){const f=taperF[i-(weeks.length-taperF.length)]??0.6,K=top*f;return {K,long:Math.min(lg,Math.max(6,K*0.3))}}
    const aim=K0+(peak-K0)*Math.min(1,(i+1)/Math.max(1,build-1));
    if(!x.cut){k=Math.min(aim,k*1.1,top*1.1);top=Math.max(top,k)}
    const K=x.cut?top*0.75:k;
    // the long run: its share of the week, but never below the long run you already do (up to 45 % of
    // the week), growing at most 1.5 km a week
    const want=Math.max(K*S.longShare,Math.min(cfg.longKm||0,K*0.45)),L=clip(Math.min(want,lg+(x.cut?0:1.5)),5,D.longCap);if(!x.cut)lg=Math.max(lg,L);
    return {K,long:x.cut?L*0.8:L};
  });
}

// One session. pc: paces; o: what kind and how much
function sess(kind,pc,o={}){
  const K=KINDS[kind],s={kind,title:o.title||K.name,rpe:K.rpe,hard:HARD.has(kind),...o};
  const wu=s.hard&&kind!=='race'?2:0; // ~1 km easy before and after a hard session
  if(s.reps){const rk=s.reps*s.len/1000;s.km=rk+wu+(s.restKm||0);s.what=`${s.reps} × ${s.len<1000?s.len+' m':kmt(s.len)+' km'}${s.repWhat?' '+s.repWhat:''}`}
  else if(s.dist){s.km=s.dist/1000+wu;s.what=s.what||`${kmt(s.dist)} km`}
  return s;
}
// Hard sessions by phase, style and race distance; p: how far through the phase (0–1)
function quality(slot,x,cfg,pc){
  const D=DIST[cfg.dist].d,st=cfg.style,ph=x.phase,p=x.p,R=k=>Math.round(k);
  const longRace=D>=21000,racePace=D<=5000?pc.r5k:D<=10000?pc.r10k:D<=21100?pc.half:pc.mar;
  const sub=(n,len,rest=60)=>sess('sub',pc,{reps:n,len,rest,pace:pc.sub,why:`Just below threshold, about ${mmss(pc.sub)}/km: comfortably hard, never straining. Short rests keep it controlled; this is where the Norwegian method builds its engine.`});
  const vo2=(n,len)=>sess('vo2',pc,{reps:n,len,rest:R(len/1000*pc.int*0.8),pace:pc.int,why:`At interval pace, about ${mmss(pc.int)}/km, with an easy jog between. Raises your VO2max, your ceiling, so race pace feels easier.`});
  const cruise=(n,len)=>sess('cruise',pc,{reps:n,len,rest:60,pace:pc.thr,why:`Threshold pace, about ${mmss(pc.thr)}/km, broken up with a minute's jog: the same benefit as a long tempo with less strain.`});
  const tempo=min=>sess('tempo',pc,{dist:R(min*60/pc.thr*10)*100,pace:pc.thr,what:`${min} min tempo`,why:`${min} minutes at threshold, about ${mmss(pc.thr)}/km: comfortably hard, the pace you could hold for about an hour. The tempo pacer takes the hills for you.`});
  const hills=n=>sess('hills',pc,{reps:n,len:200,rest:90,pace:pc.int,hill:true,repWhat:'uphill',why:`Hard up a hill for about a minute, jog back down. Builds strength and form for climbs without the pounding of fast flat running.`});
  const rp=(n,len)=>sess('racepace',pc,{reps:n,len,rest:R(Math.max(60,len/1000*60)),pace:racePace,why:`At your goal-race pace, about ${mmss(racePace)}/km. Rehearses exactly the rhythm you'll race at.`});
  const prog=km=>sess('progression',pc,{dist:km*1000,pace:(pc.easy+pc.thr)/2,why:`Start easy and finish the last third at threshold, about ${mmss(pc.thr)}/km. Teaches you to run strong on tired legs.`});
  if(ph==='taper'){
    if(x.fromRace===0)return slot==='A'?rp(3,1000):null;
    return slot==='A'?rp(4,1000):slot==='B'?tempo(longRace?20:15):null;
  }
  if(st==='threshold'){
    if(ph==='peak'&&slot==='A')return longRace?rp(R(2+p),3000):rp(R(4+2*p),1000);
    if(slot==='A')return sub(R(6+2*p),1000);
    if(slot==='B')return ph==='base'?sub(3,R((6+2*p)*60/pc.sub*10)*100):sub(R(3+p),2000);
    if(slot==='C')return sub(R(8+4*p),400,45);
  }
  if(slot==='A'){
    if(ph==='base')return hills(R(6+4*p));
    if(ph==='build')return longRace?cruise(R(4+p),1600):vo2(R(5+p),p<0.5?800:1000);
    return longRace?rp(R(2+p),D>30000?5000:3000):D<=5000?rp(R(5-p),R(1000+400*p)):rp(R(4-p),R(2000+1000*p));
  }
  if(slot==='B'){
    if(ph==='base')return tempo(R(15+10*p));
    if(ph==='build')return longRace?tempo(R(25+10*p)):cruise(R(3+p),1600);
    return longRace?tempo(R(30+10*p)):st==='quality'?tempo(25):prog(Math.max(6,R(D/1000*0.8)));
  }
  return null;
}

// The whole programme. cfg: {start, raceDate, dist, style, days, longDay (5|6), km, longKm, test, goalTime?}
// st: {vdot, easyAdj, fatigue, pain, now}. Returns {weeks:[{…, K, long, days:[7 sessions with date, i, key]}], paces}
export function programme(cfg,st){
  const pc=paces(st.vdot,{easyAdj:st.easyAdj||1}),weeks=skeleton(cfg),vols=volumes(cfg,weeks);
  const n=clip(cfg.days||4,3,6),longDay=cfg.longDay===5?5:6,startDay=dayNum(cfg.start)-dayNum(mondayOf(cfg.start));
  let run=RUN_DAYS[n].map(d=>longDay===5&&(d===5||d===6)?(d===5?6:5):d).sort((a,b)=>a-b);
  if(longDay===5&&n<4)run=run.map(d=>d===6?5:d);
  const raceIdx=dayNum(cfg.raceDate)-dayNum(mondayOf(cfg.raceDate));
  const out=weeks.map((x,w)=>{
    const days=Array.from({length:7},(_,i)=>({i,date:addDays(x.monday,i),key:`${w}-${i}`,...sess('rest',pc,{why:'Rest day. Recovery is when the training lands.'})}));
    const set=(i,s)=>{if(s)Object.assign(days[i],s,{i,date:addDays(x.monday,i),key:`${w}-${i}`})};
    let rd=run.slice();
    const last=w===weeks.length-1;
    if(w===0){rd=rd.filter(i=>i>=startDay);for(const d of days)if(d.i<startDay)d.pre=true} // the plan starts today
    if(last)rd=rd.filter(i=>i<raceIdx-1);                     // race week: nothing after, rest the day before
    const A=rd.includes(1)?1:rd.find(i=>i!==longDay),B=rd.includes(3)&&A!==3?3:rd.find(i=>i!==A&&i!==longDay&&i>(A??-1)+1);
    const C=cfg.style==='threshold'&&n>=5&&rd.includes(longDay===6?5:4)?(longDay===6?5:4):null;
    // the test: in the first week, the first run day you have; in lighter weeks, the second key day
    let testDay=null;
    if(x.test&&!last){testDay=w===0?rd.find(i=>i!==longDay)??rd[0]:B??A;if(testDay!=null)set(testDay,sess('test',pc,{dist:cfg.testD||5000,pace:pc.r5k,
      what:`${kmt(cfg.testD||5000)} km time trial`,why:`An all-out ${kmt(cfg.testD||5000)} km on fresh legs, after a good warm-up. The pacer runs your predicted time; beat it if you can. Your result sets every training pace${w?' for the next block':''}.`}))}
    // key sessions (a lighter week keeps a gentle fartlek; the day after a test is never hard)
    for(const [slot,day] of [['A',A],['B',B],['C',C]]){
      if(day==null||day===testDay||days[day].kind!=='rest')continue;
      if(testDay!=null&&(day===testDay+1||(w===0&&day<testDay)))continue;
      const q=x.cut?(slot==='A'?sess('fartlek',pc,{dist:Math.round(vols[w].K*0.15)*1000||5000,pace:pc.easy,what:'8 × 1 min brisk',why:'An easy run with eight one-minute pick-ups, one minute easy between. Keeps you sharp in a lighter week.'}):null):quality(slot,x,cfg,pc);
      if(q)set(day,q);
    }
    if(last&&raceIdx<7)set(raceIdx,sess('race',pc,{dist:DIST[cfg.dist].d,pace:cfg.goalTime?cfg.goalTime/(DIST[cfg.dist].d/1000):raceTime(st.vdot,DIST[cfg.dist].d)/(DIST[cfg.dist].d/1000),
      what:DIST[cfg.dist].name,why:'Race day. Start a touch easier than you want to and let the pacer pull you through: even effort, hills and all.'}));
    if(last&&raceIdx-1>=0&&days[raceIdx-1].kind==='rest')days[raceIdx-1].why='Rest, or 15 minutes very easy with a few strides. Lay out your kit.';
    // long run
    if(!last&&rd.includes(longDay)&&days[longDay].kind==='rest'){
      const L=Math.round(vols[w].long),mpFin=x.phase==='peak'&&DIST[cfg.dist].d>=21000&&!x.cut?Math.round(L*(cfg.dist==='mar'?0.4:0.25)):0;
      set(longDay,sess('long',pc,{dist:L*1000,pace:pc.long,what:`${L} km${mpFin?`, last ${mpFin} at race pace`:''}`,
        why:mpFin?`Easy at about ${mmss(pc.long)}/km, then the last ${mpFin} km at ${cfg.dist==='mar'?'marathon':'half-marathon'} pace (${mmss(cfg.dist==='mar'?pc.mar:pc.half)}/km): race rhythm on tired legs.`
          :`Easy and steady, about ${mmss(pc.long)}/km: conversational the whole way. Builds the endurance for the last third of your race.`}));
    }
    // easy runs share what's left of the week (quality style: short ones)
    const used=days.reduce((a,d)=>a+(d.km||0),0),easy=rd.filter(i=>days[i].kind==='rest');
    const each=clip((vols[w].K-used)/Math.max(1,easy.length),cfg.style==='quality'?3:4,cfg.style==='quality'?6:14);
    easy.forEach((i,j)=>{
      const strides=(x.phase==='base'||x.phase==='taper')&&j===easy.length-1&&!x.cut;
      const km=Math.round(last&&i===raceIdx-2?Math.min(each,5):each);
      set(i,sess(strides?'strides':'easy',pc,{dist:km*1000,pace:pc.easy,what:`${km} km${strides?' + 6 strides':''}`,
        why:strides?`Easy, about ${mmss(pc.easy)}/km, then six relaxed 20-second strides: quick, tall and light, walking back between. Keeps your legs sharp.`
          :cfg.style==='quality'?`Short and easy, about ${mmss(pc.easy)}/km, or swap it for 30–40 minutes of cycling or swimming.`:`Conversational, about ${mmss(pc.easy)}/km. Most of your running should feel like this: it's what lets the hard days work.`}));
    });
    return {...x,...vols[w],days};
  });
  // adapting to how you feel: pain rests the next two days; tiredness turns the next hard session easy
  if(st.now!=null){
    const today=dayNum(st.now),all=out.flatMap(x=>x.days),fut=all.filter(d=>dayNum(d.date)>=today);
    if(st.pain)for(const d of fut.filter(d=>dayNum(d.date)<=today+1&&d.kind!=='race'))Object.assign(d,sess('rest',pc,{why:'Rest: you noted pain. Give it two days; if it is still there when you run easy, stop and get it looked at before any hard running.',adapted:'pain'}));
    else if(st.fatigue>=3){const h=fut.find(d=>d.hard&&d.kind!=='race'&&d.kind!=='test'&&dayNum(d.date)<=today+4);
      if(h)Object.assign(h,sess('easy',pc,{dist:Math.round(h.km||6)*1000,pace:pc.easy,what:`${Math.round(h.km||6)} km easy`,swapped:h.title,adapted:'tired',
        why:`Swapped from ${h.title.toLowerCase()}: your legs and energy say you're carrying fatigue. An easy day now pays off more than a hard one run tired.`}))}
  }
  return {weeks:out,paces:pc};
}

// ---------------------------------------------------------------------------------------------------
// Adapting to how sessions felt
// ---------------------------------------------------------------------------------------------------
// fb: [{t (ms), kind, feel:{rpe 1–10, how:'plan'|'easy'|'hard'|'cut', legs:'fresh'|'ok'|'heavy'|'sore',
// energy:'great'|'ok'|'low', pain:bool}}]. since: the last fitness test (only later feedback moves the
// paces). Returns {dv (VDOT nudge, ±2 at most), easyAdj (×easy paces), fatigue (0+), pain, why:[...]}
export function adapt(fb,{since=0,now=Date.now()}={}){
  let dv=0;const why=[];
  for(const f of fb.filter(x=>x.t>=since&&x.feel?.rpe)){
    const e=KINDS[f.kind]?.rpe;if(!e||!HARD.has(f.kind)||f.kind==='test'||f.kind==='race')continue;
    const r=f.feel.rpe,h=f.feel.how;
    if(h==='easy'||(r<=e[0]-2&&h!=='hard'&&h!=='cut')){dv+=0.4;why.push({t:f.t,kind:f.kind,up:true})}
    else if(h==='hard'||h==='cut'){dv-=0.6;why.push({t:f.t,kind:f.kind,up:false})}
    else if(r>=e[1]+2){dv-=0.3;why.push({t:f.t,kind:f.kind,up:false})}
  }
  dv=clip(dv,-2,2);
  const easyHard=fb.filter(x=>now-x.t<21*DAY&&['easy','recovery','long','strides'].includes(x.kind)&&x.feel?.rpe>=6).length;
  let fatigue=0;
  for(const f of fb.filter(x=>now-x.t<7*DAY&&x.t<=now&&x.feel)){
    const w=now-f.t<3*DAY?1:0.6,F=f.feel,e=KINDS[f.kind]?.rpe;
    fatigue+=w*((F.legs==='heavy'?1:F.legs==='sore'?2:0)+(F.energy==='low'?1:0)+(e&&F.rpe>=e[1]+2?1:0));
  }
  const pain=fb.some(x=>now-x.t<2*DAY&&x.t<=now&&x.feel?.pain);
  return {dv,easyAdj:easyHard>=2?1.03:1,fatigue,pain,why};
}

// Training load: session effort × minutes (sRPE), by week. runs: [{t, min, rpe}]. Returns the last n weeks'
// totals (oldest first) and how this week compares with the four before it (1 = the same)
export function load(runs,now,n=8){
  const m=mondayOf(now),wk=Array.from({length:n},(_,k)=>({monday:addDays(m,-7*(n-1-k)),load:0,min:0}));
  for(const r of runs){const k=n-1-Math.round((dayNum(m)-dayNum(mondayOf(r.t)))/7);if(k<0||k>=n)continue;wk[k].load+=r.min*r.rpe;wk[k].min+=r.min}
  const prev=wk.slice(-5,-1).map(x=>x.load),avg=prev.reduce((a,b)=>a+b,0)/Math.max(1,prev.filter(Boolean).length);
  return {weeks:wk,ramp:avg>0?wk.at(-1).load/avg:null};
}
