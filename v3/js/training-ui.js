// The Plan tab, the plan builder and the "how did it feel?" form. Pure rendering: app.js gives the data
// and handles the taps.
import {DIST,PHASES,KINDS,PACE_NAMES,RPE_WORDS,raceTime} from './training.js';

const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DOW=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const day=ms=>new Date(ms).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
const shortDay=ms=>new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short'});
export const FAMCOL={easy:'#4ade80',long:'#2dd4bf',tempo:'#facc15',int:'#c084fc',race:'#fb923c',rest:'#475569'};
export const ICON={easy:'🌿',recovery:'🌿',strides:'🌿',hillsprints:'⛰️',long:'🛤️',sub:'🌊',hills:'⛰️',rehearsal:'🎯',sharpener:'⚡',test:'🧪',race:'🏁',rest:'·'};
const rpeCol=r=>r<=3?'#4ade80':r<=5?'#a3e635':r<=7?'#facc15':r<=8?'#fb923c':'#f87171';

// The main set of a session, as lines
function mainSet(s){
  if(s.main)return s.main;
  if(s.reps){const L=s.len<1000?`${s.len} m`:`${(s.len/1000).toFixed(s.len%1000?1:0)} km`;
    return [`${s.reps} × ${L}${s.min?` (about ${s.min} min each)`:''} at ${fmt(s.pace)}/km on the flat${s.kind==='sub'?': comfortably hard, never straining':''}`,`${s.rest>=60?`${Math.round(s.rest/60*4)/4} min`:`${s.rest} s`} easy jog or walk between`]}
  if(s.dist)return [`${s.what} at ${fmt(s.pace)}/km${s.kind==='long'?' or a little slower':''}`];
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The Plan tab
// ---------------------------------------------------------------------------------------------------
// d: {pg, P, pc, vdot, v0, adj, wk, today, did (key → runs), feelOf(run), notes, load, tests, course
// ({name, D, climb, climbs:[{from,len,grade}]}) or null, open (key), openWeek (index), dayNum}
// h: {onRun(s), onOpenRun(id), onEdit(), onEnd(), onToggle(key), onWeek(i)}
export function renderPlanTab(el,d,h){
  const {pg,P,pc}=d,D=DIST[pg.dist],W=P.weeks,wk=Math.max(0,Math.min(W.length-1,d.wk)),x=W[wk];
  const days=d.dayNum(pg.raceDate)-d.today,pred=raceTime(d.vdot,D.d),dv=d.vdot-d.v0,cname=d.course?.name||D.name;
  let o=`<div class="card pgh"><div class="eyebrow">🌊 Norwegian method · ${esc(D.name)}</div>
    <h2>${esc(cname)}</h2><div class="sub">${day(pg.raceDate)} · ${days<=0?'race day':days===1?'tomorrow':`${days} days to go`}</div>
    <div class="pgn"><div><span>Fitness</span><b>${d.vdot.toFixed(1)}</b><small>VDOT${Math.abs(dv)>=0.1?` · ${dv>0?'+':''}${dv.toFixed(1)} since the start`:''}</small></div>
      <div><span>${esc(D.name)} today</span><b>${d.coursePred?fmt(d.coursePred):fmt(pred)}</b><small>${d.coursePred?'on the course':'on the flat'}${pg.goalTime?` · goal ${fmt(pg.goalTime)}`:''}</small></div></div>
    <div class="tl">${W.map((w,i)=>`<i class="${i===wk?'now':''} ${w.cut?'cut':''}" style="background:${PHASES[w.phase].col}">${w.test?'<em>🧪</em>':''}</i>`).join('')}</div>
    <div class="tll">${Object.keys(PHASES).filter(k=>W.some(w=>w.phase===k)).map(k=>`<span><i style="background:${PHASES[k].col}"></i>${PHASES[k].name}</span>`).join('')}<span>🧪 course test</span></div></div>`;
  if(d.notes.length)o+=`<div class="card pgnotes"><div class="h">Coach</div>${d.notes.map(n=>`<p>${n}</p>`).join('')}</div>`;
  // this week
  const done=x.days.reduce((a,s)=>a+(d.did[s.key]||[]).reduce((b,r)=>b+(r.yd??r.rd??0)/1000,0),0);
  o+=`<div class="card pgweek"><div class="pgwh"><div><div class="eyebrow" style="color:${PHASES[x.phase].col}">This week · ${wk+1} of ${W.length} · ${PHASES[x.phase].name}</div><b>${esc(x.focus)}</b></div><div class="pl-km"><b>${done.toFixed(0)}</b><span>of ${Math.round(x.days.reduce((a,s)=>a+(s.km||0),0))} km</span></div></div>`;
  o+=x.days.filter(s=>!s.pre).map(s=>sessionRow(s,d)).join('')+`</div>`;
  // the course
  if(d.course)o+=courseCard(d.course,W);
  // paces
  o+=`<div class="card pgpace"><div class="h">Your paces</div><div class="pcs">${PACE_NAMES.map(([k,n,ic])=>`<div><span>${ic} ${n}</span><b>${fmt(pc[k])}</b><small>/km</small></div>`).join('')}</div>
    <p class="note">From VDOT ${d.vdot.toFixed(1)}${d.tests.length?`: your course test on ${shortDay(d.tests.at(-1).t)}`:': an estimate from your runs until your first test'}${Math.abs(d.adj||0)>=0.1?`, ${d.adj>0?'+':''}${d.adj.toFixed(1)} from how sessions have felt`:''}. Paces on the flat: on your routes the pacer adds the hills, so the effort stays right. In the Norwegian method the effort matters more than the number: if a session feels harder than "comfortably hard", ease off.</p></div>`;
  // load
  if(d.load.weeks.some(w=>w.load>0)){
    const mx=Math.max(...d.load.weeks.map(w=>w.load),1),r=d.load.ramp;
    o+=`<div class="card pgload"><div class="h">Training load</div><div class="ldbars">${d.load.weeks.map((w,i)=>`<div class="${i===d.load.weeks.length-1?'now':''}"><i style="height:${Math.max(3,w.load/mx*100)}%"></i><small>${i===d.load.weeks.length-1?'now':''}</small></div>`).join('')}</div>
      <p class="note">Effort (1–10) × minutes, week by week. ${r==null?'':r>1.4?'<b>This week is a big jump on your last month</b>: keep the easy days truly easy.':r<0.7?'A light week so far.':'Steady: in line with your last month.'}</p></div>`;
  }
  // the whole programme, week by week
  o+=`<div class="card pgall"><div class="h">The whole plan · ${W.length} weeks</div><p class="note">Tap a week to see every session, where to run it and why it's there.</p>`+
    W.map((w,i)=>{const open=d.openWeek===i,km=Math.round(w.days.reduce((a,s)=>a+(s.km||0),0));
      return `<div class="pgw ${i===wk?'now':''} ${i<wk?'past':''} ${open?'open':''}" data-week="${i}"><span class="n" style="background:${PHASES[w.phase].col}">${i+1}</span><span class="t"><b>${shortDay(w.monday)} · ${PHASES[w.phase].name}${w.test?' · 🧪 test':''} · ${km} km</b><small>${w.days.filter(s=>s.hard||s.kind==='long'||s.kind==='hillsprints').map(s=>`${ICON[s.kind]} ${esc(s.title)}`).join(' · ')}</small></span><i class="chev"></i></div>`+
        (open?`<div class="pgwd"><p class="wf">${esc(w.focus)}</p>${w.days.filter(s=>!s.pre).map(s=>sessionRow(s,d)).join('')}</div>`:'')}).join('')+
    `<div class="bt2"><button class="btn ghost" id="pgedit">Change the plan</button><button class="btn ghost" id="pgend">End the plan</button></div></div>`;
  o+=methods();
  el.innerHTML=o;
  el.querySelectorAll('.ses').forEach(b=>b.onclick=e=>{if(e.target.closest('button'))return;h.onToggle(b.dataset.key)});
  el.querySelectorAll('.pgw').forEach(b=>b.onclick=()=>h.onWeek(+b.dataset.week));
  const all=W.flatMap(w=>w.days);
  el.querySelectorAll('.act[data-run]').forEach(b=>b.onclick=()=>h.onRun(all.find(s=>s.key===b.dataset.run)));
  el.querySelectorAll('.act[data-open]').forEach(b=>b.onclick=()=>h.onOpenRun(+b.dataset.open));
  el.querySelector('#pgedit').onclick=h.onEdit;el.querySelector('#pgend').onclick=h.onEnd;
}
function courseCard(c,W){
  const ses=W.flatMap(w=>w.days),on=k=>ses.filter(s=>s.where&&s.whereRoute===c.id&&k(s)).length;
  const used=[[on(s=>s.kind==='test'),'course tests'],[on(s=>s.kind==='rehearsal'),'race-pace rehearsals'],[on(s=>s.kind==='sub'),'sub-threshold sessions over its hills'],[on(s=>s.kind==='hills'),'hill sessions on its climb']].filter(x=>x[0]);
  return `<div class="card pgcourse"><div class="h">The course</div><div class="cprof">${c.svg}</div>
    <p class="sub"><b>${(c.D/1000).toFixed(2)} km</b> with <b>${Math.round(c.climb)} m</b> of climbing.${c.climbs.length?` Its climbs: ${c.climbs.slice(0,3).map(k=>`<b>${(k.from/1000).toFixed(1)} km</b> (${k.len} m at ${k.grade.toFixed(1)} %)`).join(', ')}.`:''}</p>
    ${used.length?`<p class="note">Your plan runs ${used.map(([n,t])=>`${n} ${t}`).join(', ')} on it, so race day holds no surprises.</p>`:''}</div>`;
}
function sessionRow(s,d){
  const runs=d.did[s.key]||[],dn=d.dayNum(s.date),past=dn<d.today,now=dn===d.today,open=d.open===s.key,col=FAMCOL[KINDS[s.kind].fam];
  const f=runs.map(d.feelOf).find(Boolean),state=runs.length?'done':past&&s.kind!=='rest'?'missed':now?'today':'';
  let x=`<div class="ses ${state} ${open?'open':''} ${s.kind==='rest'?'rest':''}" data-key="${s.key}" style="--k:${col}" role="button">
    <span class="sd"><small>${DOW[s.i]}</small><b>${new Date(s.date).getDate()}</b></span>
    <span class="si">${runs.length?'✓':ICON[s.kind]}</span>
    <span class="st"><b>${esc(s.title)}${s.adapted?' <em class="adp">adjusted</em>':''}</b><small>${s.kind==='rest'?(s.extras.length?'+ strength and mobility':''):esc(s.what||'')}${s.km&&s.kind!=='rest'?` · ${Math.round(s.km)} km in all`:''}</small></span>
    <span class="sr">${f?`<i class="rpe" style="background:${rpeCol(f.rpe)}">${f.rpe}</i>`:runs.length?'<i class="rpe q">?</i>':''}</span></div>`;
  if(!open)return x;
  const sec=(t,lines)=>lines?.length?`<div class="sec"><b>${t}</b>${lines.map(l=>`<div class="stp">${esc(l)}</div>`).join('')}</div>`:'';
  x+=`<div class="sesd" style="--k:${col}">`;
  if(s.kind!=='rest'){
    if(s.where)x+=`<div class="sec where"><b>📍 Where</b><p>${esc(s.where)}</p></div>`;
    x+=sec('Warm-up',s.warm)+sec('Main set',mainSet(s))+sec('Cool-down',s.cool);
    x+=`<div class="sec"><b>Why</b><p>${esc(s.why)}</p></div>${s.now?`<div class="sec"><b>Why now</b><p>${esc(s.now)}</p></div>`:''}`;
  }else x+=`<p>${esc(s.why)}</p>`;
  for(const e of s.extras||[])x+=`<div class="sec extra"><b>💪 ${esc(e.title)}</b>${e.steps.map(l=>`<div class="stp">${esc(l)}</div>`).join('')}<p>${esc(e.why)}</p></div>`;
  if(s.kind!=='rest')x+=`<div class="sesr">Should feel: <b>${s.rpe[0]}–${s.rpe[1]} out of 10</b> (${RPE_WORDS[s.rpe[0]].toLowerCase()} to ${RPE_WORDS[s.rpe[1]].toLowerCase()})</div>`;
  if(runs.length)x+=runs.map(r=>`<button class="act btn ghost" data-open="${r.id}">${d.feelOf(r)?'See the run':'See the run · log how it felt'}</button>`).join('');
  else if(!past&&s.kind!=='rest'&&s.where)x+=`<button class="act btn go" data-run="${s.key}">${now?'Run it with Pacer':`Run it with Pacer (${DOW[s.i]})`}</button>`;
  return x+`</div>`;
}
function methods(){
  return `<details class="card fold"><summary><span><b>The Norwegian method</b><small>What it is, and how your plan uses it</small></span><i class="chev"></i></summary><div class="meth">
    <p><b>Sub-threshold is the engine.</b> The Norwegian model (Bakken, the Ingebrigtsens) builds fitness with lots of controlled work just below threshold: comfortably hard, short rests, never straining. It raises your threshold, the pace you can hold for an hour, while leaving you fresh enough to do it again two days later. Runners who train once a day ("singles") do two or three sessions a week.</p>
    <p><b>Three gears.</b> Short reps (about 3 min) run a touch quicker; long reps (about 10 min) a touch slower. The effort is what matters: the elites measure blood lactate; you go by feel, and the pacer adds the hills.</p>
    <p><b>One session above threshold: hills.</b> The Ingebrigtsens' weekly 20 × 200 m uphill builds strength and form without the pounding of flat-out speedwork. Your plan starts with hill sprints of a few seconds, then hill reps on the hill most like your race's main climb.</p>
    <p><b>Everything else easy.</b> Easy runs, strides and an easy long run, so the sessions work. Twice a week, 20 minutes of strength and mobility.</p>
    <p><b>Built for your race.</b> Tests on the full course every four weeks show your progress on its exact hills and reset your paces. Thursday's sessions run over the course's hilliest stretch, and at the peak you rehearse the race at race pace. The taper cuts about 40 % of the running and keeps the quality.</p>
    <p><b>Listens to you.</b> After each run, say how it felt: too easy and your paces move up; too hard and they ease. Heavy legs turn the next session easy; pain rests you.</p></div></details>`;
}

// No plan yet, or it's finished
export function renderPlanIntro(el,o,h){
  el.innerHTML=`${o.finished?`<div class="card pgh"><div class="eyebrow">🏁 Plan complete</div><h2>${esc(o.finished.name)}</h2>${o.finished.time?`<div class="gl-res win"><b>${fmt(o.finished.time)}</b><span>${o.finished.line}</span></div>`:''}<p class="sub">${o.finished.sum}</p></div>`:''}
  <div class="card pgintro"><div class="big">🌊</div><h2>${o.finished?'Your next race':'Train the Norwegian way'}</h2>
    <p>Controlled sub-threshold sessions, a weekly hill session, and easy running, built around your race and its course. It starts with a test on the course, retests every four weeks, and listens to how each session felt.</p>
    <ol class="steps"><li><b>Your race</b><span>The distance, the date and the course</span></li><li><b>A course test</b><span>Run the course all-out: your paces come from it</span></li><li><b>Week by week</b><span>Every session says where to run it, how to warm up, and why it's there</span></li><li><b>Run it with Pacer</b><span>Each session loads with its route, reps and target: press Start</span></li></ol>
    <button class="btn go big" id="pgnew">Build my plan</button></div>${methods()}`;
  el.querySelector('#pgnew').onclick=h.onNew;
}

// ---------------------------------------------------------------------------------------------------
// The plan builder
// ---------------------------------------------------------------------------------------------------
// f: the draft {dist, date, route, goal, days, km, longKm, test (yyyy-mm-dd)}; o: {routes, weeks, peak,
// testNote, errors}
export function renderBuilder(el,f,o,set){
  const seg=(k,opts)=>`<div class="seg" data-k="${k}">${opts.map(([v,l])=>`<button data-v="${v}" class="${String(f[k])===String(v)?'on':''}">${l}</button>`).join('')}</div>`;
  el.innerHTML=`<div class="card"><div class="step"><span>1</span>Your race</div>
      <div class="set"><span><b>Race course</b><small>One of your routes: tests, rehearsals and hill sessions use its hills</small></span><select id="pf-route" class="txt"><option value="">Not saved</option>${o.routes.map(r=>`<option value="${r.id}" ${+f.route===r.id?'selected':''}>${esc(r.name)} (${(r.D/1000).toFixed(1)} km)</option>`).join('')}</select></div>
      ${seg('dist',Object.entries(DIST).map(([k,v])=>[k,k==='half'?'Half':v.name]))}
      <div class="set"><span><b>Race day</b><small>${o.weeks==null?'':o.weeks<4?'<span class="bad">At least 4 weeks away, please</span>':o.weeks>30?'<span class="bad">Up to 30 weeks away</span>':`${o.weeks} weeks away`}</small></span><input type="date" class="txt" id="pf-date" value="${f.date||''}"></div>
      <div class="set"><span><b>Goal time</b><small>Optional: leave empty to get as fit as you can</small></span><input id="pf-goal" class="txt" placeholder="e.g. 44:59" value="${esc(f.goal||'')}" inputmode="numeric"></div></div>
    <div class="card"><div class="step"><span>2</span>Your running now</div>
      <div class="set col"><span><b>Runs a week</b><small>${f.days>=5?'Three sub-threshold sessions a week, the full Norwegian singles week':'Two sub-threshold sessions and a hill session a week'}</small></span>${seg('days',[[3,'3'],[4,'4'],[5,'5'],[6,'6']])}</div>
      <div class="set"><span><b>Distance a week</b><small>Lately, roughly</small></span><div class="mini-step" id="pf-km"><button data-d="-1">−</button><b>${f.km} km</b><button data-d="1">+</button></div></div>
      <div class="set"><span><b>Longest run</b><small>In the last month</small></span><div class="mini-step" id="pf-long"><button data-d="-1">−</button><b>${f.longKm} km</b><button data-d="1">+</button></div></div>
      <p class="note">The plan builds to about ${o.peak} km a week at its peak, never more than about 10 % more each week.</p></div>
    <div class="card"><div class="step"><span>3</span>Your first test</div>
      <div class="set"><span><b>Test day</b><small>${o.testNote}</small></span><input type="date" class="txt" id="pf-test" value="${f.test||''}"></div>
      <p class="note">Then every four weeks, on the same day of the week, each one lighter week's finale. Your fitness (and every pace) comes from them.</p></div>
    ${o.errors.length?`<div class="card warn">${o.errors.map(e=>`<p>${e}</p>`).join('')}</div>`:''}`;
  el.querySelectorAll('.seg[data-k] button').forEach(b=>b.onclick=()=>set({[b.parentElement.dataset.k]:isNaN(+b.dataset.v)?b.dataset.v:+b.dataset.v}));
  el.querySelector('#pf-date').onchange=e=>set({date:e.target.value});
  el.querySelector('#pf-test').onchange=e=>set({test:e.target.value});
  el.querySelector('#pf-route').onchange=e=>set({route:e.target.value?+e.target.value:null});
  el.querySelector('#pf-goal').onchange=e=>set({goal:e.target.value.trim()},true);
  el.querySelectorAll('#pf-km button').forEach(b=>b.onclick=()=>set({km:Math.max(5,Math.min(150,f.km+ +b.dataset.d*(f.km>=40?5:2)))}));
  el.querySelectorAll('#pf-long button').forEach(b=>b.onclick=()=>set({longKm:Math.max(3,Math.min(40,f.longKm+ +b.dataset.d))}));
}

// ---------------------------------------------------------------------------------------------------
// How did it feel?
// ---------------------------------------------------------------------------------------------------
// o: {kind, title, feel (saved, or null), reply}
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
  if(o.feel&&!o.editing){
    el.innerHTML=`<div class="h">How it felt</div><div class="fsum"><i class="rpe" style="background:${rpeCol(o.feel.rpe)}">${o.feel.rpe}</i><span><b>${RPE_WORDS[o.feel.rpe]}</b><small>${[{plan:'As planned',easy:'Too easy',hard:'Had to slow',cut:'Cut short'}[o.feel.how],`legs ${o.feel.legs}`,`energy ${o.feel.energy}`,o.feel.pain?`pain${o.feel.where?': '+esc(o.feel.where):''}`:''].filter(Boolean).join(' · ')}</small></span><button class="link" id="fedit">Edit</button></div>${o.feel.note?`<p class="fnote">${esc(o.feel.note)}</p>`:''}${o.reply?`<div class="freply">${o.reply}</div>`:''}`;
    el.querySelector('#fedit').onclick=()=>{o.editing=true;draw()};
    return;
  }
  draw();
}
