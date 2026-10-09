// Training plans, the Norwegian way, customised to your race and its course.
//
// The method (adapted from the Norwegian model for runners who train once a day, "Norwegian singles"):
//   - most of the work is sub-threshold intervals: comfortably hard, never straining, with short rests,
//     two (three with five or more runs a week) sessions a week. Shorter reps run a little quicker,
//     longer reps a little slower, so every session is controlled and repeatable
//   - the one weekly session above threshold is short hill reps (the Ingebrigtsens' 20 × 200 m uphill,
//     scaled down): strength and form for the climbs without flat-out speedwork. Early on they start as
//     hill sprints of a few seconds
//   - everything else is genuinely easy, with strides to keep the legs quick
//   - periodised: base → build → peak (race-specific: rehearsing race pace on the course) → taper
//     (less running, the same quality), the week of each fitness test lighter
//   - fitness tests are the race course itself, all-out: the first on the day you choose, then every
//     four weeks. Each sets your fitness (VDOT, from the run with its hills taken out) and so every pace
//   - how each session felt (effort, legs, energy, pain) nudges paces, turns a hard day easy when you're
//     tired and rests you when you're hurt
// Every session says where to run it (venue hints, resolved against your routes in venues.js), how to
// warm up and cool down, why it's in the plan and why at this point.
// Paces s/km, distances m, times s, dates ms. No DOM: runs under node --test.

const DAY=864e5;
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const kmt=m=>{const k=m/1000;return Math.abs(k-Math.round(k))<0.05?String(Math.round(k)):k.toFixed(1)};
const R100=m=>Math.max(200,Math.round(m/100)*100);

// ---------------------------------------------------------------------------------------------------
// Dates (local calendar: a week across the clocks changing is still seven days)
// ---------------------------------------------------------------------------------------------------
export const mondayOf=ms=>{const d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()};
export const addDays=(ms,n)=>{const d=new Date(ms);d.setHours(0,0,0,0);d.setDate(d.getDate()+n);return d.getTime()};
export const dayNum=ms=>{const d=new Date(ms);return Math.round(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY)};

// ---------------------------------------------------------------------------------------------------
// Fitness: VDOT (Daniels & Gilbert)
// ---------------------------------------------------------------------------------------------------
export const vo2=v=>-4.60+0.182258*v+0.000104*v*v;                     // ml/kg/min at v m/min
export const pctMax=t=>0.8+0.1894393*Math.exp(-0.012778*t)+0.2989558*Math.exp(-0.1932605*t); // of VO2max, for t min
export const vdotOf=(d,s)=>{const t=s/60;return vo2(d/t)/pctMax(t)};
export function raceTime(v,d){let lo=d/1000*100,hi=d/1000*1200;for(let k=0;k<60;k++){const m=(lo+hi)/2;if(vdotOf(d,m)>v)lo=m;else hi=m}return (lo+hi)/2}
export const paceAtPct=(v,f)=>{const a=0.000104,b=0.182258,c=-4.60-f*v,vel=(-b+Math.sqrt(b*b-4*a*c))/(2*a);return 60000/vel};
// Training paces (flat ground; the pacer then takes each route's hills). Sub-threshold has three gears:
// short reps (about 3 min) a touch quicker, long reps (10 min) a touch slower
export function paces(v,{easyAdj=1}={}){
  const P=f=>paceAtPct(v,f);
  return {easy:P(0.67)*easyAdj,long:P(0.66)*easyAdj,recovery:P(0.6)*easyAdj,
    thr:P(0.88),subS:P(0.87),sub:P(0.855),subL:P(0.84),hill:P(0.98),
    mar:raceTime(v,42195)/42.195,half:raceTime(v,21097.5)/21.0975,r5k:raceTime(v,5000)/5,r10k:raceTime(v,10000)/10};
}
export const PACE_NAMES=[['easy','Easy','🌿'],['long','Long run','🛤️'],['subL','Sub-T long reps','🌊'],['sub','Sub-T 6 min reps','🌊'],['subS','Sub-T short reps','🌊'],['thr','Threshold','🔥']];

// ---------------------------------------------------------------------------------------------------
// Races, phases, sessions
// ---------------------------------------------------------------------------------------------------
export const DIST={
  '5k':{name:'5K',d:5000,taper:1,longCap:14,peak:36},
  '10k':{name:'10K',d:10000,taper:1,longCap:18,peak:45},
  half:{name:'Half marathon',d:21097.5,taper:2,longCap:22,peak:56},
  mar:{name:'Marathon',d:42195,taper:3,longCap:32,peak:72},
};
export const PHASES={base:{name:'Base',col:'#2dd4bf'},build:{name:'Build',col:'#60a5fa'},peak:{name:'Peak',col:'#fb923c'},taper:{name:'Taper',col:'#4ade80'}};
export const KINDS={
  easy:{name:'Easy',rpe:[2,4],fam:'easy'},recovery:{name:'Recovery run',rpe:[1,3],fam:'easy'},strides:{name:'Easy + strides',rpe:[2,4],fam:'easy'},
  hillsprints:{name:'Easy + hill sprints',rpe:[3,5],fam:'easy'},long:{name:'Long run',rpe:[3,5],fam:'long'},
  sub:{name:'Sub-threshold',rpe:[5,7],fam:'tempo'},hills:{name:'Hill reps',rpe:[7,8],fam:'int'},rehearsal:{name:'Course rehearsal',rpe:[7,8],fam:'race'},
  sharpener:{name:'Sharpener',rpe:[6,7],fam:'int'},test:{name:'Course test',rpe:[9,10],fam:'race'},race:{name:'Race day',rpe:[9,10],fam:'race'},rest:{name:'Rest',rpe:[0,0],fam:'rest'},
};
export const HARD=new Set(['sub','hills','rehearsal','sharpener','test','race']);
export const RPE_WORDS=['','Very easy','Easy','Easy','Steady','Moderate','Comfortably hard','Hard','Very hard','Extremely hard','Max'];

// Warm-ups, cool-downs and the extras, as lines to read before you go
export const WARM={
  hard:['10–15 min easy jog','Drills, about 5 min: leg swings ×10 each way, then 2 × 20 m each of A-skips, high knees and butt kicks','4 × 20 s strides, building up to the session\'s pace'],
  race:['15 min easy jog','Drills, about 5 min: leg swings, A-skips, high knees, butt kicks','4–6 × 20 s strides, the last two at race pace','Be on the line within 5 minutes of finishing them'],
  easy:['Start the first 5 minutes slower than easy: let your body warm into it'],
};
export const COOL={
  hard:['10 min easy jog','Recovery routine (8 min): calf stretch against a wall, kneeling hip-flexor stretch, hamstring stretch, figure-4 glute stretch: 45 s each side'],
  easy:['Optional: the recovery routine (calves, hip flexors, hamstrings, glutes, 45 s each side)'],
  race:['10–15 min very easy jog, then the recovery routine','Refuel within 30 minutes: carbohydrate and some protein'],
};
export const STRENGTH={title:'Strength and mobility (20 min)',steps:['Single-leg calf raises 3 × 15 each side (slow down, knee straight then bent)','Split squats 3 × 8 each side','Glute bridges 3 × 12 (single-leg once easy)','Side plank 2 × 30 s each side','Dead bugs 2 × 10'],
  why:'Strong calves, glutes and hips make you more economical and much less likely to get injured. Twice a week is plenty.'};

// ---------------------------------------------------------------------------------------------------
// The programme
// ---------------------------------------------------------------------------------------------------
// Which days you run (0 = Monday) for runs a week, the long run last
const RUN_DAYS={3:[1,3,6],4:[1,3,5,6],5:[0,1,3,5,6],6:[0,1,2,3,5,6]};

// The weeks: phase, tests (the first on cfg.firstTest, then every four weeks, never in the last 13 days),
// lighter test weeks, the taper (a week longer when the race is early in the week)
// cfg: {start, raceDate, dist, firstTest (ms or null)}
export function skeleton(cfg){
  const m0=mondayOf(cfg.start),W=clip(Math.round((dayNum(mondayOf(cfg.raceDate))-dayNum(m0))/7)+1,1,40),D=DIST[cfg.dist];
  const raceIdx=dayNum(cfg.raceDate)-dayNum(mondayOf(cfg.raceDate));
  const tests=[];
  if(cfg.firstTest!=null)for(let t=cfg.firstTest;dayNum(t)<=dayNum(cfg.raceDate)-13;t=addDays(t,28))tests.push(t);
  const T=Math.min(D.taper+(raceIdx<=2?1:0),Math.max(1,Math.floor(W/4))),Rw=W-T;
  const base=Rw>=4?Math.round(Rw*0.4):Math.min(Rw,1),build=Rw>=3?Math.round(Rw*0.35):Math.max(0,Rw-base);
  return Array.from({length:W},(_,w)=>{
    const monday=addDays(m0,7*w),phase=w<base?'base':w<base+build?'build':w<Rw?'peak':'taper';
    const test=tests.find(t=>dayNum(t)>=dayNum(monday)&&dayNum(t)<dayNum(monday)+7)??null;
    const start=phase==='base'?0:phase==='build'?base:phase==='peak'?base+build:Rw,len=phase==='base'?base:phase==='build'?build:phase==='peak'?Rw-base-build:T;
    return {w,monday,phase,test,cut:!!test,p:len>1?(w-start)/(len-1):1,fromRace:W-1-w,raceIdx};
  });
}

// Weekly distance and long run: from where you are now towards the peak, at most +10 % a week, 75 % in
// test weeks, then the taper. The long run starts from the one you already do.
export function volumes(cfg,weeks){
  const D=DIST[cfg.dist],K0=Math.max(8,cfg.km||15),peak=Math.max(K0,Math.min(D.peak*clip(cfg.days/5,0.7,1.3),K0*1.6));
  const nT=weeks.filter(x=>x.phase==='taper').length,taperF={1:[0.6],2:[0.7,0.45],3:[0.8,0.6,0.4],4:[0.85,0.7,0.55,0.4]}[nT]||[0.6],build=weeks.length-nT;
  let k=K0,top=K0,lg=Math.max(5,cfg.longKm||K0*0.3);
  return weeks.map((x,i)=>{
    if(x.phase==='taper'){const K=top*(taperF[i-build]??0.5);return {K,long:Math.min(lg,Math.max(6,K*0.32))}}
    const aim=K0+(peak-K0)*Math.min(1,(i+1)/Math.max(1,build-1));
    if(!x.cut){k=Math.min(aim,k*1.1,top*1.1);top=Math.max(top,k)}
    const K=x.cut?top*0.75:k,want=Math.max(K*0.28,Math.min(cfg.longKm||0,K*0.45));
    const L=clip(Math.min(want,lg+(x.cut?0:1.5)),5,D.longCap);if(!x.cut)lg=Math.max(lg,L);
    return {K,long:x.cut?L*0.8:L};
  });
}

// One session: what it is, its target, the warm-up and cool-down, why, and where (a venue hint)
function sess(kind,o={}){
  const K=KINDS[kind],hard=HARD.has(kind),wu=hard&&kind!=='race'&&kind!=='test'?2.5:kind==='test'?3:0; // km of warm-up and cool-down
  const s={kind,title:o.title||K.name,rpe:K.rpe,hard,warm:hard?(kind==='race'||kind==='test'?WARM.race:WARM.hard):kind==='rest'?[]:WARM.easy,
    cool:hard?(kind==='race'||kind==='test'?COOL.race:COOL.hard):kind==='rest'?[]:COOL.easy,extras:[],...o};
  if(s.reps){s.km=s.reps*s.len/1000+wu;s.what=s.what||`${s.reps} × ${s.len<1000?s.len+' m':kmt(s.len)+' km'}${s.repWhat?' '+s.repWhat:''}`}
  else if(s.dist){s.km=s.dist/1000+wu;s.what=s.what||`${kmt(s.dist)} km`}
  return s;
}
// Sub-threshold reps: minutes each, at the right gear for their length
function subReps(n,min,pc,rest=60){
  const pace=min<=4?pc.subS:min<=7?pc.sub:pc.subL,len=R100(min*60/pace*1000);
  return {reps:n,len,rest,pace,repWhat:`(about ${min} min each)`,min};
}

// The whole programme. cfg: {start, raceDate, dist, days, km, longKm, firstTest, goalTime, course (true if
// the race course is one of your routes)}. st: {vdot, easyAdj, fatigue, pain, now}
// Returns {weeks:[{…, K, long, focus, days:[7 sessions: i, date, key, kind, title, what, km, pace, reps…,
// warm, main, cool, why, now, venue, extras]}], paces}
export function programme(cfg,st){
  const pc=paces(st.vdot,{easyAdj:st.easyAdj||1}),weeks=skeleton(cfg),vols=volumes(cfg,weeks),D=DIST[cfg.dist];
  const n=clip(cfg.days||4,3,6),run=RUN_DAYS[n],startDay=dayNum(cfg.start)-dayNum(mondayOf(cfg.start));
  const racePace=cfg.goalTime?cfg.goalTime/(D.d/1000):raceTime(st.vdot,D.d)/(D.d/1000),short=D.d<=10500;
  const course=cfg.course,cName=cfg.courseName||'the race course';
  const out=weeks.map((x,w)=>{
    const days=Array.from({length:7},(_,i)=>({i,date:addDays(x.monday,i),key:`${w}-${i}`,...sess('rest',{why:'Rest day. Recovery is when the training lands: the work you did adapts into fitness while you rest.'})}));
    const set=(i,s)=>{if(s)Object.assign(days[i],s,{i,date:addDays(x.monday,i),key:`${w}-${i}`})};
    const last=w===weeks.length-1,ri=x.raceIdx,ti=x.test!=null?dayNum(x.test)-dayNum(x.monday):null,p=x.p,ph=x.phase;
    let rd=run.slice();
    if(w===0){rd=rd.filter(i=>i>=startDay);for(const d of days)if(d.i<startDay)d.pre=true}
    if(last)rd=rd.filter(i=>i<ri-1);
    // the test, on its day, on the full course; the day before easy, and no hard session the day after
    if(ti!=null){
      set(ti,sess('test',{dist:course?cfg.courseD:short?D.d:5000,pace:raceTime(st.vdot,course?cfg.courseD:short?D.d:5000)/((course?cfg.courseD:short?D.d:5000)/1000),venue:{type:course&&short?'course-full':'flat-5k'},
        what:course&&short?`The full ${cName}, all-out`:`${short?kmt(D.d):5} km time trial`,vsLastTest:true,
        main:[course&&short?`The whole course at race effort: start controlled for the first kilometre, then race it`:'All-out, as evenly as you can: controlled first kilometre, then race'],
        why:`An all-out run of ${course&&short?'the race course itself':'a time trial'}. It measures your fitness (with the hills allowed for, so a hilly course still gives a fair number), and that sets every pace for the next block. ${w?'You race your last test as the purple runner, so you see exactly where you\'ve gained.':'The pacer runs your estimated time: beat it if you can.'}`,
        now:w===0?'Everything is built on knowing where you are. Testing on the course from the start gives a baseline on the exact hills you\'ll race.'
          :`Four weeks since your last test: enough time for the training to land. This week is lighter so you test fresh, and the result resets your paces for the next block.`}));
      if(ti-1>=0)rd=rd.filter(i=>i!==ti-1);           // the day before: rest (or a very easy jog)
      if(ti-1>=0)days[ti-1].why='Rest, or 15–20 minutes very easy with 4 strides: fresh legs for tomorrow\'s test.';
    }
    const hardOK=i=>days[i].kind==='rest'&&rd.includes(i)&&!(ti!=null&&(i===ti+1||i===ti-1));
    const longDay=rd.includes(6)&&!(ti===6)?6:rd.includes(5)&&ti!==5&&!rd.includes(6)?5:null;
    // Sub-threshold sessions: Tuesday on flat ground (pace is effort), Thursday on the course (holding
    // effort over its hills), a third on Saturday with five or more runs a week
    const A=rd.includes(1)?1:null,B=rd.includes(3)?3:null,C=n>=5&&rd.includes(5)?5:null,H=rd.includes(5)?5:rd.includes(4)?4:null;
    if(ph==='taper'){
      if(last){
        if(A!=null&&A<ri-1)set(A,sess('sharpener',{reps:4,len:400,rest:90,pace:racePace,venue:{type:course?'course-start':'flat'},why:'Four short reps at race pace: just enough to remind your legs of the rhythm. You should finish feeling you could do much more.',now:'Race week: fatigue is dropping fast, and a little race-pace work keeps you sharp without costing anything.'}));
      }else{
        if(A!=null)set(A,sess('sub',{...subReps(5,4,pc),venue:{type:'flat'},why:'A shortened sub-threshold session: the same effort as always, less of it.',now:'Taper: the volume drops by about 40 % so the fatigue of the last weeks clears, but the intensity stays so you don\'t lose the edge. This is when the fitness you\'ve built shows up.'}));
        if(B!=null)set(B,sess('sharpener',{reps:5,len:1000,rest:90,pace:racePace,venue:{type:course?'course-start':'flat'},title:'Race-pace kilometres',why:`Five kilometres at your race pace, ${mmss(racePace)}/km${course?', on the opening stretch of the course':''}, with short recoveries. Locks in the rhythm you\'ll race at.`,now:'The last real session: rehearse race pace while you\'re fresh, then it\'s easy running to race day.'}));
      }
    }else{
      // Tuesday: flat sub-threshold, the reps progressing through the block
      if(A!=null&&hardOK(A)&&!(ti!=null&&A>=ti-1)){
        const r=ph==='base'?subReps(Math.round(5+p),6,pc):ph==='build'?(w%2?subReps(Math.round(8+2*p),3,pc):subReps(Math.round(5+p),6,pc)):subReps(10,3,pc);
        set(A,sess('sub',{...r,venue:{type:'flat'},why:`Sub-threshold: comfortably hard, ${mmss(r.pace)}/km, never straining. The short rests keep your effort just under the point where lactate starts to build, so you can do a lot of it and recover quickly. This is the engine of the Norwegian method: it raises your threshold, the pace you can hold for about an hour, which is what decides your ${D.name}.`,
          now:ph==='base'?'Base: learning the effort. Longer reps at a steady pace teach you what sub-threshold feels like; the total time at it grows week by week.'
            :ph==='build'?(r.min<=4?'Build: shorter reps run a touch quicker, alternating with 6-minute reps, so your threshold is pushed from both sides.':'Build: more time at sub-threshold each week. This is the heart of the plan.')
            :'Peak: short reps a touch quicker keep your threshold sharp while the race-specific work comes in.'}));
      }
      // Thursday: on the course (if it's one of your routes): sub-threshold over its hills, then, at the
      // peak, a rehearsal of the race itself
      if(B!=null&&hardOK(B)&&ti==null){ // (a test week keeps just one sub-threshold session, so you test fresh)
        if(ph==='peak'&&course&&short){
          const len=Math.round(clip(cfg.courseD*(0.45+0.15*p),3000,cfg.courseD-1000)/500)*500;
          set(B,sess('rehearsal',{dist:len,pace:racePace,venue:{type:'course-part',len},what:`${kmt(len)} km at race pace`,
            why:`${kmt(len)} km at your race pace, best on the start of ${cName} so the pacer takes each of its climbs and descents at goal effort and you learn where to hold back. Anywhere rolling works if you can't get there.`,
            now:'Peak: race-specific. With your threshold built, rehearsing the race on its own hills turns fitness into a race plan.'}));
        }else{
          const r=ph==='base'?subReps(Math.round(2+p),10,pc,90):subReps(Math.round(3+p),ph==='build'?8:10,pc,75);
          set(B,sess('sub',{...r,venue:{type:course?'course':'rolling'},why:`Sub-threshold again, ideally over some hills: the pacer eases on the climbs and lifts on the descents so the effort stays even, as you'll need to on race day${course?` on ${cName}`:''}. On the flat it does just as much for your threshold, so run it wherever suits you.`,
            now:ph==='base'?'Base: two or three long reps teach you to settle into the effort and hold it over changing ground.':'Build: longer total time at sub-threshold, on hills, so climbing at effort becomes second nature.'}));
        }
      }
      // A third sub-threshold session (five or more runs a week): short reps, short rests
      if(C!=null&&hardOK(C)&&!(ti!=null&&C>=ti-2)&&ph!=='base'){
        const r=subReps(Math.round(8+4*p),2,pc,45);
        set(C,sess('sub',{...r,venue:{type:'flat'},title:'Sub-threshold (short)',why:'Short reps with short rests: the third sub-threshold session of the Norwegian week. Quick enough to feel like work, controlled enough to recover from by the next day.',now:'Adding a third session is how the method grows your threshold volume without adding hard days of a different kind.'}));
      }
    }
    // The hill element: hill sprints on an easy run in the base and taper, hill reps in the build and peak
    // (on the hill most like the course's main climb)
    const hDay=[H,5,4,2,0].find(i=>i!=null&&rd.includes(i)&&days[i].kind==='rest'&&!(ti!=null&&(i>=ti-1&&i<=ti+1))&&!(i===longDay));
    if(hDay!=null&&ph!=='taper'&&!last){
      const easyKm=Math.round(clip(vols[w].K*0.15,4,8));
      if(ph==='base'||x.cut)set(hDay,sess('hillsprints',{dist:easyKm*1000,pace:pc.easy,venue:{type:'hill-short'},what:`${easyKm} km easy + ${x.cut?6:Math.round(6+4*p)} × 10 s hill sprints`,
        main:[`${easyKm} km easy, about ${mmss(pc.easy)}/km`,`Then ${x.cut?6:Math.round(6+4*p)} × 8–10 s sprints up a steep hill: fast, tall, powerful`,'Walk back down and wait until you feel fully recovered (about 2 min) before the next one'],
        why:'Very short, very steep sprints: pure power and stride strength. They are too short to build up fatigue, so they make you stronger and quicker without taking anything from the next session.',
        now:ph==='base'?'Base: hill sprints prepare your legs and tendons for the longer hill reps that start in the build.':'A lighter week: a few sprints keep the legs sharp while you freshen up.'}));
      else{
        const reps=ph==='build'?Math.round(10+6*p):12;
        set(hDay,sess('hills',{reps,len:200,rest:75,pace:pc.hill,hill:true,repWhat:'uphill',venue:{type:'hill',len:200},
          main:[`${reps} × 200 m uphill, strong (about 5K effort): drive the arms, stay tall, quick feet`,'Easy jog back down as the recovery','No hill handy? 45–60 s hard on the flat with a 90 s jog does a similar job'],
          why:`The Norwegian method's one session faster than threshold: the Ingebrigtsens' 20 × 200 m uphill, scaled down. Climbing at a strong effort builds the strength and form ${course?`the climbs on ${cName} demand`:'that climbs demand'}, and running up a hill means far less pounding than fast reps on the flat.`,
          now:ph==='build'?'Build: with the hill sprints done, the hill reps start, adding a couple each week.':'Peak: holding the hill session steady keeps the strength you\'ve built for the course\'s climbs.'}));
      }
    }
    // Race day
    if(last)set(ri,sess('race',{dist:D.d,pace:racePace,venue:{type:course?'course-full':'flat'},what:D.name,
      main:[`Race: the pacer runs ${cfg.goalTime?'your goal':'your predicted time'}, ${mmss(racePace)}/km on the flat, with every hill built in`,'Start a touch easier than you want to; let the pacer pull you through'],
      why:'Race day. Even effort, hills and all.',now:'Everything has been building to this.'}));
    if(last&&ri-1>=0&&days[ri-1].kind==='rest')days[ri-1].why='Rest, or 15 minutes very easy with 4 strides. Lay out your kit, and eat a carbohydrate-rich dinner.';
    // Long run
    if(longDay!=null&&days[longDay].kind==='rest'&&!last){
      const L=Math.round(vols[w].long),roll=ph!=='base'&&!x.cut;
      set(longDay,sess('long',{dist:L*1000,pace:pc.long,venue:{type:roll?'long-rolling':'long-flat',len:L*1000},
        why:`Easy and conversational, about ${mmss(pc.long)}/km. The long run grows your aerobic engine: more capillaries, more mitochondria, more fat-burning, so the end of a race feels easier.${roll?' On rolling ground now, so climbing on tired legs becomes normal.':''}`,
        now:ph==='base'?'Base: the long run builds steadily, a kilometre or so a week.':ph==='build'?'Build: the long run keeps growing, now over hills like the race course.':ph==='peak'?'Peak: the longest runs of the plan, still easy: endurance for the last third of the race.':'Taper: shorter, to freshen up.'}));
    }
    // Easy runs: what's left of the week, with strides on the last one in the base, peak and taper
    const used=days.reduce((a,d)=>a+(d.km||0),0),easy=rd.filter(i=>days[i].kind==='rest');
    const each=clip((vols[w].K-used)/Math.max(1,easy.length),3,12);
    easy.forEach((i,j)=>{
      const strides=ph!=='build'&&j===easy.length-1&&!(ti!=null&&i>=ti-1),km=Math.round(last||(ti!=null&&i===ti+1)?Math.min(each,5):each),rec=ti!=null&&i===ti+1;
      set(i,sess(rec?'recovery':strides?'strides':'easy',{dist:km*1000,pace:rec?pc.recovery:pc.easy,venue:{type:'any',len:km*1000},what:`${km} km${strides?' + 6 strides':''}`,
        main:strides?[`${km} km easy, about ${mmss(pc.easy)}/km`,'Then 6 × 20 s strides: quick, tall and relaxed, building to about mile pace, walking back between']:[`${km} km at about ${mmss(rec?pc.recovery:pc.easy)}/km: you should be able to chat`],
        why:rec?'Very easy, short: blood flow to flush out the test without adding any stress.':strides?'Easy running with strides at the end: the strides keep your stride quick and economical without any fatigue.':'Genuinely easy: this is what lets the hard days work. Most of your running should feel like this.',
        now:rec?'The day after a hard effort: recovery first.':'Easy days make room for the sub-threshold sessions: run them easy even when you feel great.'}));
    });
    // Keep the week within about 10 % of its budget (warm-ups count): take reps off the longest
    // sub-threshold session first, then shorten the easy part of a hill-sprint run, and only then the long
    // run (never below the long run you already do, up to 45 % of the week)
    const tot=()=>days.reduce((a,d)=>a+(d.km||0),0),Lmin=Math.max(6000,Math.min((cfg.longKm||0)*1000,vols[w].K*450),vols[w].K*300);
    for(let g=0;g<30&&tot()>vols[w].K*1.1;g++){
      const sb=days.filter(d=>d.kind==='sub'&&d.reps>(d.min>=8?2:4)).sort((a,b)=>b.reps*b.len-a.reps*a.len)[0];
      if(sb){sb.reps--;sb.km-=sb.len/1000;sb.what=`${sb.reps} × ${sb.len<1000?sb.len+' m':kmt(sb.len)+' km'}${sb.repWhat?' '+sb.repWhat:''}`;continue}
      const hs=days.find(d=>d.kind==='hillsprints'&&d.dist>3000);
      if(hs){hs.dist-=1000;hs.km-=1;hs.what=hs.what.replace(/^\d+ km/,`${kmt(hs.dist)} km`);hs.main=[hs.main[0].replace(/^\d+ km/,`${kmt(hs.dist)} km`),...hs.main.slice(1)];continue}
      const L=days.find(d=>d.kind==='long');
      if(L&&L.dist-1000>=Lmin){L.dist-=1000;L.km-=1;L.what=`${kmt(L.dist)} km`;continue}
      break;
    }
    // Strength and mobility: twice a week outside the taper, on easy or rest days
    if(ph!=='taper'&&!last){
      const sd=[0,4,2,6].filter(i=>!days[i].hard&&!days[i].pre&&!(ti!=null&&(i===ti||i===ti-1))).slice(0,2);
      for(const i of sd)days[i].extras=[...days[i].extras,STRENGTH];
    }
    const focus=x.cut&&x.test?(w===0?'Test week: find your starting point on the course.':'Test week: lighter, so you arrive at the test fresh. The result resets your paces.')
      :ph==='base'?'Base: build the aerobic engine. Long sub-threshold reps, hill sprints, easy miles.'
      :ph==='build'?'Build: the heart of the plan. More sub-threshold, and the weekly hill reps.'
      :ph==='peak'?`Peak: race-specific. ${course&&short?'Rehearsals on the course at race pace, ':''}threshold kept sharp, hill strength held.`
      :last?'Race week: fresh legs, a touch of speed, then race.':'Taper: about 40 % less running, the same quality. Fatigue clears, fitness shows.';
    return {...x,...vols[w],focus,days};
  });
  // Adapting to how you feel: pain rests the next two days; tiredness turns the next hard session easy
  if(st.now!=null){
    const today=dayNum(st.now),fut=out.flatMap(x=>x.days).filter(d=>dayNum(d.date)>=today);
    if(st.pain)for(const d of fut.filter(d=>dayNum(d.date)<=today+1&&d.kind!=='race'))Object.assign(d,sess('rest',{why:'Rest: you noted pain. Give it two days; if it is still there when you run easy, stop and get it looked at before any hard running.',adapted:'pain'}));
    else if(st.fatigue>=3){const h=fut.find(d=>d.hard&&d.kind!=='race'&&d.kind!=='test'&&dayNum(d.date)<=today+4);
      if(h)Object.assign(h,sess('easy',{dist:Math.round(Math.max(4,(h.km||6)-2.5))*1000,pace:pc.easy,venue:{type:'any'},what:`${Math.round(Math.max(4,(h.km||6)-2.5))} km easy`,swapped:h.title,adapted:'tired',
        why:`Swapped from ${h.title.toLowerCase()}: your legs and energy say you're carrying fatigue. An easy day now pays off more than a hard one run tired.`,now:'Adapting to how you feel.'}))}
  }
  return {weeks:out,paces:pc};
}

// ---------------------------------------------------------------------------------------------------
// Adapting to how sessions felt
// ---------------------------------------------------------------------------------------------------
// fb: [{t, kind, feel:{rpe, how:'plan'|'easy'|'hard'|'cut', legs, energy, pain}}]; since: the last test.
// Returns {dv (VDOT nudge, ±2 at most), easyAdj, fatigue, pain, why}
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
  const easyHard=fb.filter(x=>now-x.t<21*DAY&&['easy','recovery','long','strides','hillsprints'].includes(x.kind)&&x.feel?.rpe>=6).length;
  let fatigue=0;
  for(const f of fb.filter(x=>now-x.t<7*DAY&&x.t<=now&&x.feel)){
    const w=now-f.t<3*DAY?1:0.6,F=f.feel,e=KINDS[f.kind]?.rpe;
    fatigue+=w*((F.legs==='heavy'?1:F.legs==='sore'?2:0)+(F.energy==='low'?1:0)+(e&&F.rpe>=e[1]+2?1:0));
  }
  const pain=fb.some(x=>now-x.t<2*DAY&&x.t<=now&&x.feel?.pain);
  return {dv,easyAdj:easyHard>=2?1.03:1,fatigue,pain,why};
}

// Training load: effort × minutes by week (oldest first) and this week against the four before it
export function load(runs,now,n=8){
  const m=mondayOf(now),wk=Array.from({length:n},(_,k)=>({monday:addDays(m,-7*(n-1-k)),load:0,min:0}));
  for(const r of runs){const k=n-1-Math.round((dayNum(m)-dayNum(mondayOf(r.t)))/7);if(k<0||k>=n)continue;wk[k].load+=r.min*r.rpe;wk[k].min+=r.min}
  const prev=wk.slice(-5,-1).map(x=>x.load),avg=prev.reduce((a,b)=>a+b,0)/Math.max(1,prev.filter(Boolean).length);
  return {weeks:wk,ramp:avg>0?wk.at(-1).load/avg:null};
}
