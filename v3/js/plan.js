// Your week: a suggested week of running from your goal race (if you've set one), your form and how much
// you've been running, on your own routes. Every session is something Pacer runs with you: a pacer on an
// easy, tempo or race target, an interval session, or a rehearsal of part of your goal race at goal pace.
// Paces s/km, distances m, times ms. No DOM: runs under node --test.

export const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY=864e5;
// Which days you run (0 = Monday), by runs a week: quality on Tuesday and Thursday, long on Sunday
const DAYS={3:[1,3,6],4:[1,3,5,6],5:[0,1,3,5,6],6:[0,1,2,3,5,6]};
// Phases: how far off the goal race is
export const PHASES={base:{name:'Base',f:1.08},build:{name:'Build',f:1.06},taper:{name:'Taper',f:0.8},race:{name:'Race week',f:0.55},keep:{name:'Keep fit',f:1.04}};
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const r500=m=>Math.max(1000,Math.round(m/500)*500);
const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const hms=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const km=m=>m%1000?(m/1000).toFixed(1):String(m/1000);

// Your flat pace over distance d from your form (10 km-equivalent pace), for each kind of run
export const paceFor=(form,d,f=1)=>form*Math.pow(d/10000,0.06)*f;
export const EASY=1.28,TEMPO=1.08;

// A route for a session of about `want` m: the closest one that's long enough (or the longest you have),
// run in full, or the first part of a longer one. prefer(r) breaks ties (lower is better).
export function pickRoute(routes,want,{prefer=()=>0,avoid=null}={}){
  if(!routes.length)return null;
  const ok=routes.filter(r=>r.D>=want*0.85&&r.id!==avoid),pool=ok.length?ok:routes.filter(r=>r.id!==avoid).length?routes.filter(r=>r.id!==avoid):routes;
  const score=r=>(r.D>=want*0.85?Math.abs(r.D-want)/want:5-r.D/want)+prefer(r);
  const r=[...pool].sort((a,b)=>score(a)-score(b))[0];
  if(r.D>want*1.25&&want<r.D-200)return {route:r,how:'part',len:r500(want)};
  return {route:r,how:'full',len:r.D,short:r.D<want*0.85};
}

// monday: ms of this week's Monday 00:00; runsPerWeek 3–6; weekKm: your usual week (km); form: s/km or null;
// goal: {route (id), name, date (ms), time (s), D (m)} or null; routes: [{id, name, D (m), climb (m)}];
// raceFade: % you slow over the last third of races (or null)
// Returns {phase, title, weeksToGoal, km (planned), days:[{i, date, dow, kind, title, what, why, km, pace,
// purpose, route, how, len, int, rehearse, target}]}
// longKm: your longest run lately (the long run doesn't drop below it, outside a taper)
export function weekPlan({monday,runsPerWeek=4,weekKm=20,form=null,goal=null,routes=[],raceFade=null,longKm=0}){
  const n=clip(Math.round(runsPerWeek),3,6);
  let phase='keep',daysTo=null,gday=null;
  if(goal&&goal.date>=monday){
    daysTo=Math.floor((goal.date-monday)/DAY);gday=daysTo<7?daysTo:null;
    phase=daysTo<7?'race':daysTo<14?'taper':daysTo<56?'build':'base';
  }
  const K=clip(weekKm||20,12,120)*PHASES[phase].f,goalR=goal&&routes.find(r=>r.id===goal.route);
  const D=goal?.D||(goalR?.D)||10000;
  // paces (flat; the pacer then takes each route's hills)
  const P=form?{easy:paceFor(form,8000,EASY),long:paceFor(form,16000,EASY),tempo:paceFor(form,8000,TEMPO),
    rep:goal&&D<=5000?goal.time/(D/1000):paceFor(form,5000),race:goal?goal.time/(D/1000):paceFor(form,10000)}:null;
  const at=p=>P?`, about ${mmss(p)}/km`:'';
  const WU=3; // km of easy running around a session: warm-up and cool-down
  const flat=r=>r.climb/(r.D/1000)/10; // tie-break for speed work: the flattest route
  const days=DOW.map((dow,i)=>({i,date:new Date(new Date(monday).getFullYear(),new Date(monday).getMonth(),new Date(monday).getDate()+i).getTime(),dow,kind:'rest',title:'Rest',why:'Rest day. Recovery is when the training lands.'}));
  let run=[...DAYS[n]];
  // race week: the race on its day, rest the day before, nothing hard after
  if(phase==='race'){
    run=run.filter(i=>i!==gday-1&&i!==gday);
    run=run.filter(i=>i<gday||i>gday+1).sort((a,b)=>a-b);
  }
  const quality=phase==='race'?[run.find(i=>i<gday-1)].filter(x=>x!=null):[run.find(i=>i===1)??run[0],run.find(i=>i===3)].filter(x=>x!=null);
  const longDay=phase==='race'?null:run.includes(6)?6:run.at(-1);
  const long=clip(Math.max(K*0.32,phase==='taper'?longKm*0.7:phase==='race'?0:longKm*0.95),6,32)*1000;
  // Sessions
  const set=(i,o)=>Object.assign(days[i],o);
  // speed: intervals at 5K pace (race week: a short sharpener at race pace)
  if(quality[0]!=null){
    const sharp=phase==='race',len=sharp?400:1000,reps=sharp?4:phase==='taper'?4:clip(Math.round(K*0.16),4,8),rest=sharp?60:90;
    const pick=pickRoute(routes,len,{prefer:flat});
    const pace=sharp?P?.race:P?.rep;
    set(quality[0],{kind:'int',title:sharp?'Sharpener':'Intervals',what:`${reps} × ${len<1000?len+' m':km(len)+' km'}`,km:reps*len/1000+WU,pace,
      why:sharp?`${reps} × ${len} m at race pace${at(pace)}, ${rest} s rest: stay sharp, stay fresh.`:`${reps} × 1 km at 5K pace${at(pace)}, ${rest} s easy between. Raises your top end, so race pace feels easier. Jog 1.5 km before and after.`,
      route:pick?.route,how:'int',int:{kind:'repeat',from:0,len:Math.min(len,pick?.route.D||len),reps,dir:'same',slen:1000,rest,pace:pace?Math.round(pace):null,step:0}});
  }
  // threshold: a tempo run, or (building to a goal, every other week, and the week before) a rehearsal of
  // part of the goal race at goal pace
  if(quality[1]!=null){
    const rehearse=goalR&&(phase==='taper'||(phase==='build'&&Math.floor(daysTo/7)%2===0));
    if(rehearse){
      const len=r500(Math.min(goalR.D-500,goalR.D*(phase==='taper'?0.6:0.5)));
      set(quality[1],{kind:'race',rehearse:true,title:'Race rehearsal',what:`First ${km(len)} km of ${goalR.name}`,km:len/1000+WU,pace:P?.race,purpose:'race',
        why:`The first ${km(len)} km of your goal race at goal pace${goal?` (${mmss(goal.time/(D/1000))}/km)`:''}, every hill exactly as you'll race it. Learn where to ease off and where to push. Warm up first.`,
        route:goalR,how:'part',len});
    }else{
      const want=clip(K*0.22,4,10)*1000,pick=pickRoute(routes,want);
      set(quality[1],{kind:'tempo',title:'Tempo',what:pick?`${km(pick.how==='part'?pick.len:pick.route.D)} km`:'',km:(pick?(pick.how==='part'?pick.len:pick.route.D):want)/1000,pace:P?.tempo,purpose:'tempo',
        why:`Comfortably hard${at(P?.tempo)}: right at your threshold, where racing gets easier. The tempo pacer takes the hills for you.`,...pick});
    }
  }
  // no race coming up: every other week, a Saturday race against your own best on a 5K-ish course
  // (Thursday's tempo becomes easy that week, so there are still only two hard days)
  const tt=(phase==='keep'||phase==='base')&&n>=4&&Math.floor(monday/(7*DAY))%2===1&&routes.find(r=>r.D>=4000&&r.D<=6000);
  if(tt&&days[5].kind==='rest'&&run.includes(5)){
    const r=[...routes].filter(x=>x.D>=4000&&x.D<=6000).sort((a,b)=>Math.abs(a.D-5000)-Math.abs(b.D-5000))[0];
    if(quality[1]!=null&&days[quality[1]].kind==='tempo')Object.assign(days[quality[1]],{kind:'rest',title:'Rest',why:''});
    set(5,{kind:'race',vsBest:true,title:'Race your best',what:r.name,km:r.D/1000,pace:P?paceFor(form,r.D):null,purpose:'race',
      why:`Time trial: race your best run on ${r.name}, metre by metre, with the pacer on what your form says you can do. Easy for the first kilometre, then hunt it down.`,route:r,how:'full',len:r.D});
  }
  // the race itself
  if(phase==='race'&&goalR)set(gday,{kind:'race',title:'Race day',what:`${goalR.name}`,km:goalR.D/1000,pace:P?.race,purpose:'race',goalRace:true,
    why:`Race day: goal ${hms(goal.time)}. Trust the pacer: even effort, hills and all.${raceFade>1.5?' Hold back over the first third: in races you usually fade.':''}`,route:goalR,how:'full',len:goalR.D});
  if(phase==='race'&&gday>0&&days[gday-1].kind==='rest')days[gday-1].why='Rest, or 15 minutes very easy. Lay out your kit.';
  // long run
  if(longDay!=null&&days[longDay].kind==='rest'){
    const pick=pickRoute(routes,long);
    set(longDay,{kind:'long',title:'Long run',what:pick?`${km(pick.how==='part'?pick.len:pick.route.D)} km${pick.short?` (or more: ${km(long)} km is the aim)`:''}`:`${km(long)} km`,km:(pick?(pick.how==='part'?pick.len:pick.route.D):long)/1000,pace:P?.long,purpose:'easy',
      why:`Easy and steady${at(P?.long)}. Builds the endurance for the last third of a race${raceFade>1.5?`, where you've been fading ${raceFade.toFixed(0)} %`:''}.`,...pick});
  }
  // easy runs share what's left
  const easyDays=run.filter(i=>days[i].kind==='rest');
  const used=days.reduce((a,d)=>a+(d.km||0),0),each=clip((K-used)/Math.max(1,easyDays.length),3,12)*1000;
  easyDays.forEach((i,j)=>{
    const prev=days.slice(0,i).filter(d=>d.kind==='easy').at(-1)?.route?.id,pick=pickRoute(routes,phase==='race'?Math.min(each,5000):each,{avoid:routes.length>1?prev:null});
    set(i,{kind:'easy',title:phase==='race'&&i>gday?'Recovery':'Easy',what:pick?`${km(pick.how==='part'?pick.len:pick.route.D)} km`:`${km(each)} km`,km:(pick?(pick.how==='part'?pick.len:pick.route.D):each)/1000,pace:P?.easy,purpose:'easy',
      why:`Conversational${at(P?.easy)}. Most of your running should feel like this: the easy pacer stops you drifting quicker.`,...pick});
  });
  const title=goal&&phase!=='keep'?`${PHASES[phase].name} · ${phase==='race'?(gday===0?'race day today':`race on ${DOW[gday]}`):`${Math.ceil(daysTo/7)} weeks to ${goal.name}`}`:PHASES.keep.name;
  return {phase,title,weeksToGoal:daysTo!=null?Math.ceil(daysTo/7):null,km:days.reduce((a,d)=>a+(d.km||0),0),days};
}
