// The Plan tab, the plan builder and the "how did it feel?" form. Pure rendering: app.js gives the data
// and handles the taps.
import {DIST,STYLES,PHASES,KINDS,PACE_NAMES,RPE_WORDS,raceTime} from './training.js';

const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const day=ms=>new Date(ms).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
export const FAMCOL={easy:'#4ade80',long:'#2dd4bf',tempo:'#facc15',int:'#c084fc',race:'#fb923c',rest:'#475569'};
export const ICON={easy:'🌿',recovery:'🌿',strides:'🌿',fartlek:'🎲',long:'🛤️',progression:'📈',tempo:'🔥',cruise:'🔥',sub:'🌊',hills:'⛰️',vo2:'⚡',racepace:'🎯',test:'🧪',race:'🏁',rest:'·'};
const rpeCol=r=>r<=3?'#4ade80':r<=5?'#a3e635':r<=7?'#facc15':r<=8?'#fb923c':'#f87171';

// The structure of a session, as lines to read before you go
export function steps(s,pc){
  const P=p=>`${fmt(p)}/km`;
  if(s.kind==='rest')return [];
  if(s.reps){const L=s.len<1000?`${s.len} m`:`${(s.len/1000).toFixed(s.len%1000?1:0)} km`;
    return [`Warm up: 10–15 min easy${s.kind==='hills'?'':', then 4 strides'}`,`${s.reps} × ${L}${s.hill?' uphill, hard (about 5K effort)':` at ${P(s.pace)}`}`,s.hill?'Jog back down to the start between reps':`${s.rest>=60?`${Math.round(s.rest/60*2)/2} min`:`${s.rest} s`} easy jog between`,'Cool down: 10 min easy']}
  if(s.kind==='test')return ['Warm up: 15 min easy, with 4 strides','Time trial: '+s.what+', as fast as you can hold it evenly','Cool down: 10 min easy'];
  if(s.kind==='tempo'||s.kind==='progression')return ['Warm up: 10–15 min easy',s.kind==='tempo'?`${s.what} at ${P(s.pace)}`:`${s.what}: start easy, the last third at ${P(pc.thr)}`,'Cool down: 10 min easy'];
  if(s.kind==='race')return ['Warm up: 10–15 min easy with strides','Race: start a touch easier than you want to','Then celebrate'];
  return [`${s.what} at ${P(s.pace)}${s.kind==='long'?' or a little slower':''}`];
}

// ---------------------------------------------------------------------------------------------------
// The Plan tab
// ---------------------------------------------------------------------------------------------------
// d: {pg (the plan's settings), P (programme), pc (paces), vdot, v0, wk (this week's index), today (day
// number), did (key → runs), feelOf(run), notes [text], load {weeks, ramp}, tests [{t, v, run}], routeName,
// open (key of the expanded session), dayNum}
// h: {onRun(s), onFeel(run), onOpenRun(run), onEdit(), onEnd(), onToggle(key)}
export function renderPlanTab(el,d,h){
  const {pg,P,pc}=d,D=DIST[pg.dist],S=STYLES[pg.style],W=P.weeks,wk=Math.max(0,Math.min(W.length-1,d.wk)),x=W[wk];
  const days=Math.round((d.dayNum(pg.raceDate)-d.today)),pred=raceTime(d.vdot,D.d),dv=d.vdot-d.v0;
  let h0=`<div class="card pgh"><div class="eyebrow">${S.icon} ${esc(D.name)} · ${esc(S.name)} plan</div>
    <h2>${esc(d.routeName||D.name)}</h2><div class="sub">${day(pg.raceDate)} · ${days<=0?'race day':days===1?'tomorrow':`${days} days to go`}</div>
    <div class="pgn"><div><span>Fitness</span><b>${d.vdot.toFixed(1)}</b><small>VDOT${Math.abs(dv)>=0.1?` · ${dv>0?'+':''}${dv.toFixed(1)} since the start`:''}</small></div>
      <div><span>${esc(D.name)} today</span><b>${fmt(pred)}</b><small>${pg.goalTime?`goal ${fmt(pg.goalTime)}`:`${fmt(pred/(D.d/1000))}/km on the flat`}</small></div></div>
    <div class="tl">${W.map((w,i)=>`<i class="${i===wk?'now':''} ${w.cut?'cut':''}" style="background:${PHASES[w.phase].col}" title="Week ${i+1}">${w.days.some(s=>s.kind==='test')?'<em>🧪</em>':''}</i>`).join('')}</div>
    <div class="tll">${Object.keys(PHASES).filter(k=>W.some(w=>w.phase===k)).map(k=>`<span><i style="background:${PHASES[k].col}"></i>${PHASES[k].name}</span>`).join('')}<span>🧪 test</span></div></div>`;
  if(d.notes.length)h0+=`<div class="card pgnotes"><div class="h">Coach</div>${d.notes.map(n=>`<p>${n}</p>`).join('')}</div>`;
  // this week
  const done=x.days.reduce((a,s)=>a+(d.did[s.key]||[]).reduce((b,r)=>b+(r.yd??r.rd??0)/1000,0),0);
  h0+=`<div class="card pgweek"><div class="pgwh"><div><div class="eyebrow" style="color:${PHASES[x.phase].col}">Week ${wk+1} of ${W.length} · ${PHASES[x.phase].name}${x.cut?' · lighter week':''}</div><b>${phaseLine(x,pg)}</b></div><div class="pl-km"><b>${done.toFixed(0)}</b><span>of ${Math.round(x.days.reduce((a,s)=>a+(s.km||0),0))} km</span></div></div>`;
  h0+=x.days.filter(s=>!s.pre).map(s=>sessionRow(s,d,pc)).join('')+`</div>`;
  // paces
  h0+=`<div class="card pgpace"><div class="h">Your training paces</div><div class="pcs">${PACE_NAMES.filter(([k])=>pg.dist==='mar'||k!=='mar').map(([k,n,ic])=>`<div><span>${ic} ${n}</span><b>${fmt(pc[k])}</b><small>/km</small></div>`).join('')}</div>
    <p class="note">From VDOT ${d.vdot.toFixed(1)}${d.tests.length?`: your ${(d.tests.at(-1).run.yd/1000||5).toFixed(1)} km test on ${day(d.tests.at(-1).t)}`:pg.base?.from==='race'?': the race result you gave':pg.base?.from==='runs'?': your recent runs':''}${Math.abs(d.adj||0)>=0.1?`, ${d.adj>0?'+':''}${d.adj.toFixed(1)} from how sessions have felt`:''}. Flat-ground paces: on your routes the pacer adds the hills.</p></div>`;
  // load
  if(d.load.weeks.some(w=>w.load>0)){
    const mx=Math.max(...d.load.weeks.map(w=>w.load),1),r=d.load.ramp;
    h0+=`<div class="card pgload"><div class="h">Training load</div><div class="ldbars">${d.load.weeks.map((w,i)=>`<div class="${i===d.load.weeks.length-1?'now':''}"><i style="height:${Math.max(3,w.load/mx*100)}%"></i><small>${i===d.load.weeks.length-1?'now':''}</small></div>`).join('')}</div>
      <p class="note">Effort (1–10) × minutes, week by week. ${r==null?'':r>1.4?'<b>This week is a big jump on your last month</b>: keep the easy days truly easy.':r<0.7?'A light week so far.':'Steady: in line with your last month.'} Runs without a feeling logged count by their kind.</p></div>`;
  }
  // the whole plan
  h0+=`<details class="card fold pgall"><summary><span><b>The whole plan</b><small>${W.length} weeks · ${Math.round(W.reduce((a,w)=>a+w.days.reduce((b,s)=>b+(s.km||0),0),0))} km · ${W.flatMap(w=>w.days).filter(s=>s.kind==='test').length} fitness tests</small></span><i class="chev"></i></summary>
    ${W.map((w,i)=>`<div class="pgw ${i===wk?'now':''} ${i<wk?'past':''}"><span class="n" style="background:${PHASES[w.phase].col}">${i+1}</span><span class="t"><b>${PHASES[w.phase].name}${w.cut?' · lighter':''} · ${Math.round(w.days.reduce((a,s)=>a+(s.km||0),0))} km</b><small>${w.days.filter(s=>s.hard||s.kind==='long').map(s=>`${ICON[s.kind]} ${esc(s.what||s.title)}`).join(' · ')}</small></span></div>`).join('')}
    <div class="bt2"><button class="btn ghost" id="pgedit">Change the plan</button><button class="btn ghost" id="pgend">End the plan</button></div></details>`;
  h0+=methods();
  el.innerHTML=h0;
  el.querySelectorAll('.ses').forEach(b=>b.onclick=e=>{if(e.target.closest('button.act'))return;h.onToggle(b.dataset.key)});
  el.querySelectorAll('.act[data-run]').forEach(b=>b.onclick=()=>h.onRun(x.days.find(s=>s.key===b.dataset.run)));
  el.querySelectorAll('.act[data-open]').forEach(b=>b.onclick=()=>h.onOpenRun(+b.dataset.open));
  el.querySelector('#pgedit').onclick=h.onEdit;el.querySelector('#pgend').onclick=h.onEnd;
}
function phaseLine(x,pg){
  if(x.phase==='base')return 'Building the engine: easy miles, hills and strides, a little threshold';
  if(x.phase==='build')return pg.style==='threshold'?'More sub-threshold volume: controlled and repeatable':'Threshold and VO2max: raising your ceiling';
  if(x.phase==='peak')return 'Race-specific: your race pace, rehearsed';
  return x.fromRace===0?'Race week: fresh legs, a touch of speed':'Taper: less running, the same quality';
}
function sessionRow(s,d,pc){
  const runs=d.did[s.key]||[],dn=d.dayNum(s.date),past=dn<d.today,now=dn===d.today,open=d.open===s.key,col=FAMCOL[KINDS[s.kind].fam];
  const f=runs.map(d.feelOf).find(Boolean),state=runs.length?'done':past&&s.kind!=='rest'?'missed':now?'today':'';
  let x=`<div class="ses ${state} ${open?'open':''} ${s.kind==='rest'?'rest':''}" data-key="${s.key}" style="--k:${col}" role="button">
    <span class="sd"><small>${DOW[s.i]}</small><b>${new Date(s.date).getDate()}</b></span>
    <span class="si">${runs.length?'✓':ICON[s.kind]}</span>
    <span class="st"><b>${esc(s.title)}${s.adapted?' <em class="adp">adjusted</em>':''}</b><small>${s.kind==='rest'?'':esc(s.what||'')}${s.km&&s.kind!=='rest'?` · ${Math.round(s.km)} km in all`:''}</small></span>
    <span class="sr">${f?`<i class="rpe" style="background:${rpeCol(f.rpe)}">${f.rpe}</i>`:runs.length?'<i class="rpe q">?</i>':''}</span></div>`;
  if(open&&s.kind!=='rest'){
    x+=`<div class="sesd" style="--k:${col}">${steps(s,pc).map(l=>`<div class="stp">${esc(l)}</div>`).join('')}
      <p>${esc(s.why)}</p><div class="sesr">Should feel: <b>${s.rpe[0]}–${s.rpe[1]} out of 10</b>, ${RPE_WORDS[s.rpe[1]].toLowerCase()}</div>
      ${runs.length?runs.map(r=>`<button class="act btn ghost" data-open="${r.id}">${d.feelOf(r)?'See the run':'See the run · log how it felt'}</button>`).join(''):!past?`<button class="act btn go" data-run="${s.key}">${now?'Run it with Pacer':`Run it with Pacer (${DOW[s.i]})`}</button>`:''}</div>`;
  }else if(open)x+=`<div class="sesd"><p>${esc(s.why)}</p></div>`;
  return x;
}
function methods(){
  return `<details class="card fold"><summary><span><b>How your plan works</b><small>The methods behind it</small></span><i class="chev"></i></summary><div class="meth">
    <p><b>Fitness as VDOT.</b> Your test (or race) gives a VDOT (Daniels' running-economy model), and that gives every training pace and your race predictions. A retest every fourth week keeps them honest.</p>
    <p><b>Mostly easy.</b> Around 80 % of your running is easy. Polarised and pyramidal plans both work well; for most runners the differences are small. Consistency wins.</p>
    <p><b>Periodised.</b> Base (aerobic, hills, strides) → build (threshold and VO2max) → peak (race pace) → taper (about 40–60 % less running, intensity kept). Every fourth week is lighter.</p>
    <p><b>Built up gently.</b> Weekly distance rises by no more than about 10 %, and the long run by 1.5 km at most.</p>
    <p><b>Listens to you.</b> After each run, say how it felt. Sessions that feel too easy nudge your paces up; ones that feel too hard bring them down. Heavy legs and low energy turn the next hard day easy, and pain rests you.</p></div></details>`;
}

// No plan yet, or it's finished
export function renderPlanIntro(el,o,h){
  el.innerHTML=`${o.finished?`<div class="card pgh"><div class="eyebrow">🏁 Plan complete</div><h2>${esc(o.finished.name)}</h2>${o.finished.time?`<div class="gl-res win"><b>${fmt(o.finished.time)}</b><span>${o.finished.line}</span></div>`:''}<p class="sub">${o.finished.sum}</p></div>`:''}
  <div class="card pgintro"><div class="big">🗓️</div><h2>${o.finished?'Your next race':'Train for your race'}</h2>
    <p>Tell Pacer your race and how you like to train. It starts with a fitness test, builds every week to race day, retests as you go, and listens to how each session felt.</p>
    <ol class="steps"><li><b>Your race</b><span>5K to marathon, the date, and the course if you have it</span></li><li><b>Your style</b><span>Higher mileage, balanced, lower-mileage quality, or Norwegian-style threshold</span></li><li><b>A fitness test</b><span>A time trial sets your paces; retests every fourth week</span></li><li><b>Run it with Pacer</b><span>Every session loads with its route, reps and target: just press Start</span></li></ol>
    <button class="btn go big" id="pgnew">Build my plan</button></div>${methods()}`;
  el.querySelector('#pgnew').onclick=h.onNew;
}

// ---------------------------------------------------------------------------------------------------
// The plan builder
// ---------------------------------------------------------------------------------------------------
// f: the draft {dist, date (yyyy-mm-dd), route, goal (text), days, longDay, km, longKm, style, start, rdist, rtime};
// o: {routes [{id, name, D}], runsVdot (or null), weeks (to the date), peak (km a week, by style), errors}
export function renderBuilder(el,f,o,set){
  const seg=(k,opts)=>`<div class="seg" data-k="${k}">${opts.map(([v,l])=>`<button data-v="${v}" class="${String(f[k])===String(v)?'on':''}">${l}</button>`).join('')}</div>`;
  el.innerHTML=`<div class="card"><div class="step"><span>1</span>Your race</div>
      ${seg('dist',Object.entries(DIST).map(([k,v])=>[k,k==='half'?'Half':v.name]))}
      <div class="set"><span><b>Race day</b><small>${o.weeks==null?'':o.weeks<4?'<span class="bad">At least 4 weeks away, please</span>':o.weeks>30?'<span class="bad">Up to 30 weeks away</span>':`${o.weeks} weeks away`}</small></span><input type="date" class="txt" id="pf-date" value="${f.date||''}"></div>
      <div class="set"><span><b>Race course</b><small>One of your routes: its hills shape race-day pacing and rehearsals</small></span><select id="pf-route" class="txt"><option value="">Not saved</option>${o.routes.map(r=>`<option value="${r.id}" ${+f.route===r.id?'selected':''}>${esc(r.name)} (${(r.D/1000).toFixed(1)} km)</option>`).join('')}</select></div>
      <div class="set"><span><b>Goal time</b><small>Optional: leave empty to just get as fit as you can</small></span><input id="pf-goal" class="txt" placeholder="e.g. 44:59" value="${esc(f.goal||'')}" inputmode="numeric"></div></div>
    <div class="card"><div class="step"><span>2</span>Your running now</div>
      <div class="set col"><span><b>Runs a week</b></span>${seg('days',[[3,'3'],[4,'4'],[5,'5'],[6,'6']])}</div>
      <div class="set col"><span><b>Long run day</b></span>${seg('longDay',[[5,'Saturday'],[6,'Sunday']])}</div>
      <div class="set"><span><b>Distance a week</b><small>Lately, roughly</small></span><div class="mini-step" id="pf-km"><button data-d="-1">−</button><b>${f.km} km</b><button data-d="1">+</button></div></div>
      <div class="set"><span><b>Longest run</b><small>In the last month</small></span><div class="mini-step" id="pf-long"><button data-d="-1">−</button><b>${f.longKm} km</b><button data-d="1">+</button></div></div></div>
    <div class="card"><div class="step"><span>3</span>How you like to train</div><div class="styles">${Object.entries(STYLES).map(([k,s])=>`<button class="stylec ${f.style===k?'on':''}" data-style="${k}"><b>${s.icon} ${s.name}<em>${s.sub}</em></b><small>${s.desc}</small><small class="pk">Peaks around ${o.peak[k]} km a week</small></button>`).join('')}</div></div>
    <div class="card"><div class="step"><span>4</span>Where you are now</div>
      ${seg('start',[['test','Fitness test'],['race','A recent race'],...(o.runsVdot?[['runs','My runs']]:[])])}
      <p class="note">${f.start==='test'?`Recommended. Your first session is a ${f.km<15?'3':'5'} km time trial on your flattest route: the pacer runs your estimated time${o.runsVdot?` (from your runs, about ${fmt(raceTime(o.runsVdot,f.km<15?3000:5000))})`:''} and you try to beat it. The result sets every pace.`
        :f.start==='runs'?`From your recent runs: about ${fmt(raceTime(o.runsVdot,10000))} for 10 km on the flat (VDOT ${o.runsVdot.toFixed(1)}). You'll still be retested every fourth week.`:'A race or time trial in the last six weeks, run all-out:'}</p>
      ${f.start==='race'?`${seg('rdist',[['5000','5K'],['10000','10K'],['21097.5','Half'],['42195','Marathon']])}<div class="set"><span><b>Your time</b></span><input id="pf-rtime" class="txt" placeholder="e.g. 22:30" value="${esc(f.rtime||'')}" inputmode="numeric"></div>`:''}</div>
    ${o.errors.length?`<div class="card warn">${o.errors.map(e=>`<p>${e}</p>`).join('')}</div>`:''}`;
  el.querySelectorAll('.seg[data-k] button').forEach(b=>b.onclick=()=>set({[b.parentElement.dataset.k]:isNaN(+b.dataset.v)?b.dataset.v:+b.dataset.v}));
  el.querySelectorAll('[data-style]').forEach(b=>b.onclick=()=>set({style:b.dataset.style}));
  el.querySelector('#pf-date').onchange=e=>set({date:e.target.value});
  el.querySelector('#pf-route').onchange=e=>set({route:e.target.value?+e.target.value:null});
  el.querySelector('#pf-goal').onchange=e=>set({goal:e.target.value.trim()},true);
  el.querySelector('#pf-rtime')?.addEventListener('change',e=>set({rtime:e.target.value.trim()},true));
  el.querySelectorAll('#pf-km button').forEach(b=>b.onclick=()=>set({km:Math.max(5,Math.min(150,f.km+ +b.dataset.d*(f.km>=40?5:2)))}));
  el.querySelectorAll('#pf-long button').forEach(b=>b.onclick=()=>set({longKm:Math.max(3,Math.min(40,f.longKm+ +b.dataset.d))}));
}

// ---------------------------------------------------------------------------------------------------
// How did it feel?
// ---------------------------------------------------------------------------------------------------
// o: {kind (session kind), title, feel (saved, or null), reply (the coach's answer after saving)}
export function renderFeel(el,o,save){
  const f={rpe:null,how:'plan',legs:'ok',energy:'ok',pain:false,where:'',note:'',...(o.feel||{})},e=KINDS[o.kind]?.rpe;
  const draw=()=>{
    const seg=(k,opts)=>`<div class="seg" data-k="${k}">${opts.map(([v,l])=>`<button data-v="${v}" class="${f[k]===v?'on':''}">${l}</button>`).join('')}</div>`;
    el.innerHTML=`<div class="h">How did it feel?</div>${o.title?`<div class="sub">${esc(o.title)}${e&&e[1]?` · aim: ${e[0]}–${e[1]} out of 10`:''}</div>`:''}
      <div class="rpes">${Array.from({length:10},(_,i)=>i+1).map(r=>`<button data-r="${r}" class="${f.rpe===r?'on':''}" style="--c:${rpeCol(r)}">${r}</button>`).join('')}</div>
      <div class="rpew">${f.rpe?`<b style="color:${rpeCol(f.rpe)}">${RPE_WORDS[f.rpe]}</b>`:'Effort, from 1 (very easy) to 10 (all-out)'}</div>
      <div class="fq"><span>The session</span>${seg('how',[['plan','As planned'],['easy','Too easy'],['hard','Had to slow'],['cut','Cut short']])}</div>
      <div class="fq"><span>Legs</span>${seg('legs',[['fresh','Fresh'],['ok','Normal'],['heavy','Heavy'],['sore','Sore']])}</div>
      <div class="fq"><span>Energy and sleep</span>${seg('energy',[['great','Great'],['ok','OK'],['low','Low']])}</div>
      <div class="set"><span><b>Any pain or niggle?</b><small>Not normal muscle tiredness</small></span><button id="fpain" class="switch ${f.pain?'on':''}" role="switch" aria-checked="${f.pain}"></button></div>
      ${f.pain?`<input id="fwhere" class="txt wide" placeholder="Where? e.g. left calf" value="${esc(f.where)}">`:''}
      <textarea id="fnote" class="txt wide" rows="2" placeholder="Notes (optional)">${esc(f.note)}</textarea>
      <button id="fsave" class="btn go" ${f.rpe?'':'disabled'}>${o.feel?'Update':'Save'}</button>${o.reply?`<div class="freply">${o.reply}</div>`:''}`;
    el.querySelectorAll('.rpes button').forEach(b=>b.onclick=()=>{f.rpe=+b.dataset.r;draw()});
    el.querySelectorAll('.seg[data-k] button').forEach(b=>b.onclick=()=>{f[b.parentElement.dataset.k]=b.dataset.v;draw()});
    el.querySelector('#fpain').onclick=()=>{f.pain=!f.pain;draw()};
    el.querySelector('#fwhere')?.addEventListener('input',e=>f.where=e.target.value);
    el.querySelector('#fnote').oninput=e=>f.note=e.target.value;
    el.querySelector('#fsave').onclick=()=>{if(f.rpe)save({...f,ts:Date.now()})};
  };
  // saved and not being edited: a one-line summary
  if(o.feel&&!o.editing){
    el.innerHTML=`<div class="h">How it felt</div><div class="fsum"><i class="rpe" style="background:${rpeCol(o.feel.rpe)}">${o.feel.rpe}</i><span><b>${RPE_WORDS[o.feel.rpe]}</b><small>${[{plan:'As planned',easy:'Too easy',hard:'Had to slow',cut:'Cut short'}[o.feel.how],`legs ${o.feel.legs}`,`energy ${o.feel.energy}`,o.feel.pain?`pain${o.feel.where?': '+esc(o.feel.where):''}`:''].filter(Boolean).join(' · ')}</small></span><button class="link" id="fedit">Edit</button></div>${o.feel.note?`<p class="fnote">${esc(o.feel.note)}</p>`:''}${o.reply?`<div class="freply">${o.reply}</div>`:''}`;
    el.querySelector('#fedit').onclick=()=>{o.editing=true;draw()};
    return;
  }
  draw();
}
