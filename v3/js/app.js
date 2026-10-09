// Pacer (v3): race a virtual pacer who runs the route at a gradient-aware pace.
// Screens: Home (tabs: Today, Routes, Insights, Runs; sheets: Race setup, Settings) → Run (full-screen
// view, you vs pacer) → Result.
import {createTrack,watch,fitPace,speedPace,createSmoother} from './gps.js';
import {parseGPX,resample,fillElevation} from './route.js';
import {createMatcher} from './match.js';
import {createCourse} from './course.js';
import {importRun,hasTimes,sameRoute} from './import.js';
import {slice,isLoop,laps,session,cuesWithin} from './courses.js';
import {turnsFor,nextTurn,turnText,inDist} from './nav.js';
import {createStartGate,compass} from './start.js';
import {effortTime,buildPacer,timeAt,distAt,paceAt,avgBetween,extremes,gradeColor,projectFinish,paceMarks,ghostFromRun,ghostFromTimes,adjustPacer,PROFILES,TRAIT_NAMES} from './pacer.js';
import {createView,gapText} from './view.js';
import {saveRoute,listRoutes,deleteRoute,saveRun,listRuns,deleteRun,opt,importV1Routes} from './store.js';
import {SIM,SPEED,now,every,sim,simWatch,SCENARIOS} from './sim.js';
import {createCoach,createSpeaker,gapPhrase,STYLES} from './coach.js';
import {createMotion,cadenceAt,strideOf,kmMotion,motionInsight,UPDATE_MS,STRIDE_MS,cadenceBaseline,cadencePlan,planAt,cadenceSigns,cadenceTip} from './motion.js';
import {fetchWeather,at as wxAt,windStretches,compass16,mph,SHELTER} from './weather.js';
import {analyse as analyseRuns,learnedProfile,courseTime,mine,bests as bestsOf,KINDS,sessionProgress,formAt} from './analysis.js';
import {weekPlan,DOW,pickRoute} from './plan.js';
import {programme,adapt,load as loadOf,vdotOf,raceTime as vdotTime,DIST,KINDS as TKINDS,PHASES,dayNum,mondayOf,addDays} from './training.js';
import {venueFor,climbs} from './venues.js';
import {renderPlanTab,renderPlanIntro,renderBuilder,renderFeel,ICON as TICON} from './training-ui.js';
import {renderInsights,runFacts,KCOL} from './insights-ui.js';
import {encodeChallenge,decodeChallenge,challengeRoute,challengeRun,drawCard} from './share.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const fmtP=p=>p&&p<1800?fmt(p):'--:--';
const gapFmt=s=>s<59.5?`${Math.round(s)} s`:fmt(s);
const kmStr=m=>(m/1000).toFixed(2);
const show=id=>{for(const s of ['home','run','result'])$(s).hidden=s!==id;if(id!=='home')closeSheets();if(id!=='run')scrollTo(0,0);syncNav()};

// =====================================================================================
// Home
// =====================================================================================
// base: the saved route you picked; route: the course to run on it (all of it, or the first part)
let routes=[],base=null,route=null,P=null,turns=[],allRuns=[],ghostRun=null,rival=null,vsMode='profile'; // rival: a past run raced alongside the pacer
const when=ms=>new Date(ms).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const shortDate=ms=>new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short'});
// Your finished runs on a route that went (nearly) the whole way: these can be raced as a ghost, best first
const cutShort=x=>(x.course?.skips||[]).reduce((s,k)=>s+k.to-k.from,0)>30; // missed part of the course (not a fair best or ghost, even if the distance was made up)
// Your time (s) at route distance d in a run, from its fixes (null if it never got there)
function timeAtD(run,d){
  const f=run.fixes||[];let i=f.findIndex(x=>x[6]>=d);if(i<0)return null;if(i===0)return f[0][1]/1000;
  const a=f[i-1],b=f[i];return (a[1]+(b[1]-a[1])*(d-a[6])/((b[6]-a[6])||1))/1000;
}
// Past runs you can race on this course, quickest first: [{run, time (s), part (true: the start of a longer run)}]
function pastRuns(r){
  const own=runsOn(r).map(x=>({run:x,time:x.elapsed/1000,part:false}));
  if(!r.part)return own;
  const L=r.part.len,more=allRuns.filter(x=>x.status==='done'&&x.mode!=='intervals'&&x.route?.id===r.part.of&&!cutShort(x)&&!x.freestyle&&(x.rd||0)>=L)
    .map(x=>({run:x,time:timeAtD(x,L),part:true})).filter(x=>x.time);
  return [...own,...more].sort((a,b)=>a.time-b.time);
}
const rivalLabel=run=>run.imported?.who?run.imported.who.toUpperCase().slice(0,12):shortDate(run.started).toUpperCase();
// What to call a past run out loud: yours by date, or an imported one (which may be someone else's)
const rvWho=run=>run.imported?.who?`${run.imported.who}'s run`:run.imported?'the imported run':`your ${shortDate(run.started)} run`,cap=x=>x[0].toUpperCase()+x.slice(1);
const runsOn=r=>allRuns.filter(x=>x.status==='done'&&x.mode!=='intervals'&&x.route?.id===r.id&&x.fixes?.length>10&&!cutShort(x)&&!x.freestyle&&(x.complete||(x.rd||0)>=r.pts.at(-1).d*0.97)).sort((a,b)=>a.elapsed-b.elapsed);
let prof=opt.get('profile',{id:'even',climb:'average',descent:'average',strategy:'even'});
// speed: live pace from GPS (Doppler) speed, falling back to position; live: how quickly live pace reacts
const o={speed:opt.get('speedSrc',true),live:opt.get('live','balanced'),band:opt.get('band',5),auto:opt.get('auto',true),zone:opt.get('zone',25),view:opt.get('view','map'),
  voice:opt.get('voice','full'),tones:opt.get('tones',true),rate:opt.get('rate','normal'),muted:opt.get('muted',false)};
o.coachStyle=opt.get('coachStyle','moderate');o.showSplits=opt.get('showSplits',true);o.showCad=opt.get('showCad',true);o.showStrip=opt.get('showStrip',true);o.showWind=opt.get('showWind',true);o.cad=opt.get('cadGuide',true);o.wxOn=opt.get('wxOn',true);o.wxMode=opt.get('wxMode','keep');o.shelter=opt.get('shelter','some');
const RATES={slow:0.9,normal:1,fast:1.12};
const speaker=createSpeaker();speaker.setOpts({tones:o.tones,rate:RATES[o.rate]});speaker.setMuted(o.muted);
const voiceOn=()=>o.voice!=='off'&&!o.muted;
// What today's run is for: a race (or time trial), a tempo run, or an easy run. Each keeps its own target
// on each course; until you set one, it comes from your form (or 5:00/km before there's any)
const PURPOSES={race:{f:1,name:'Race',pacer:'Pacer'},tempo:{f:1.08,name:'Tempo',pacer:'Tempo pacer'},easy:{f:1.28,name:'Easy',pacer:'Easy pacer'}};
const purposeOf=(r=route)=>r?opt.get('purpose:'+r.id,'race'):'race';
const finKey=(id,pu)=>'finish:'+id+(pu&&pu!=='race'?':'+pu:'');
let sugC={};
function suggest(r,pu=purposeOf(r)){
  const A=getA();if(!A.ready)return null;
  if(sugC.A!==A)sugC={A};const k=r.id+':'+pu;if(k in sugC)return sugC[k];
  const ct=courseTime(A,buildPacer(r.pts,1000,prof));
  return sugC[k]=ct?Math.round(ct.t*PURPOSES[pu].f/5)*5:null;
}
const finishFor=(r,pu=purposeOf(r))=>opt.get(finKey(r.id,pu),null)??suggest(r,pu)??Math.round(r.pts.at(-1).d/1000*300/15)*15; // default 5:00/km
const msg=(t,err)=>{$('msg').textContent=t;$('msg').className=err?'err':''};
if(SIM){
  $('hello').textContent='Pacer · SIM mode';
  sim.scenario=opt.get('simStory','race');$('simcard').hidden=false;
  const renderSim=()=>{
    $('simsc').innerHTML=SCENARIOS.map(x=>`<button class="stylec ${x.id===sim.scenario?'on':''}" data-v="${x.id}"><b>${x.name}</b><small>${x.desc}</small></button>`).join('');
    $('simsc').querySelectorAll('.stylec').forEach(b=>b.onclick=()=>{sim.scenario=b.dataset.v;opt.set('simStory',sim.scenario);renderSim()});
  };
  renderSim();
}

async function initHome(){
  try{const n=await importV1Routes();if(n)msg(`Brought over ${n} route${n>1?'s':''} from Pace v1.`)}catch(e){}
  routes=(await listRoutes()).sort((a,b)=>b.created-a.created);
  allRuns=await listRuns();
  selectRoute(routes.find(r=>r.id===opt.get('route',null))||routes[0]||null);
  refreshHistory();storageStatus();fixRecordedElevation();tab(curTab);checkChallenge();
}

$('gpx').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    tab('routes');msg('Reading '+f.name+'…');
    const g=parseGPX(await f.text());
    if(g.pts.length<2)throw new Error('No track or route points found in this file');
    let s=resample(g.pts),src='GPX';
    const timed=hasTimes(g.timed),name=g.name||f.name.replace(/\.[^.]+$/,'');
    // A run (the file has times): if it was on a route you already have, add the run to that route
    let r=timed?sameRoute(routes,s):null;
    if(r&&!confirm(`This looks like your saved route "${r.name}". Add this run to it?\n\n(Cancel saves it as a new route.)`))r=null;
    if(!r){
      if(s.some(p=>p.ele==null)){s=await fillElevation(s,fetch,5,(i,n)=>msg(`Fetching elevation ${i}/${n}…`));src='Open-Meteo'}
      r={name,created:Date.now(),src,pts:s,cues:g.cues};
      r.id=await saveRoute(r);routes.unshift(r);
    }
    msg('');
    if(timed&&await importTimed(g,r,name,f.name))return;
    selectRoute(r);
  }catch(err){msg(err.message,true)}
};

// Save the run in a GPX with times, to race: every point's time gives its pace all the way round. Route
// planners add times too (at an even made-up pace), so it asks first. Returns true if saved (and shown).
async function importTimed(g,r,name,file){
  const run=importRun(g.timed,r.pts),km=run.dist/1000,pace=run.elapsed/1000/(km||1);
  if(pace<150||pace>900||run.fixes.length<10)return false; // not running pace
  if(!confirm(`This file has times: a run of ${kmStr(run.dist)} km in ${fmt(run.elapsed/1000)} (${fmt(pace)}/km)${run.paused>5000?`, not counting ${fmt(run.paused/1000)} stopped`:''}.\n\nSave it as a run you can race, on its own or alongside a pacer?`))return false;
  const rec={started:run.started,status:'done',mode:'record',imported:{name,file,paused:run.paused},sim:false,
    route:{id:r.id,name:r.name,src:r.src,pts:r.pts,cues:r.cues||[]},fixes:run.fixes,elapsed:run.elapsed,rd:run.rd,yd:run.dist,
    dist:run.dist,rsplits:run.rsplits,complete:run.complete,saved:Date.now()};
  rec.id=await saveRun(rec);allRuns=await listRuns();
  selectRoute(r);showResult(rec);resultFresh=true;
  return true;
}

// Climb (m) of a route, and a small map of it coloured by gradient (svg markup)
const climbOf=r=>r.pts.reduce((a,p,i)=>a+(i&&p.ele!=null&&r.pts[i-1].ele!=null?Math.max(0,p.ele-r.pts[i-1].ele):0),0);
function thumb(pts,cls='thumb'){
  const k=Math.cos(pts[0].lat*Math.PI/180),xs=pts.map(p=>p.lon*k*111195),ys=pts.map(p=>-p.lat*111195);
  const x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0||1,h=Math.max(...ys)-y0||1,pad=Math.max(w,h)*0.12,st=Math.max(1,Math.floor(pts.length/90));
  let s='';for(let i=st;i<pts.length;i+=st){const a=i-st,g=pts[a].ele!=null&&pts[i].ele!=null?(pts[i].ele-pts[a].ele)/((pts[i].d-pts[a].d)||1)*100:0;
    s+=`<line x1="${(xs[a]-x0).toFixed(0)}" y1="${(ys[a]-y0).toFixed(0)}" x2="${(xs[i]-x0).toFixed(0)}" y2="${(ys[i]-y0).toFixed(0)}" stroke="${gradeColor(g)}" stroke-width="4" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`}
  return `<svg class="${cls}" viewBox="${-pad} ${-pad} ${w+2*pad} ${h+2*pad}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${s}<circle cx="${xs[0]-x0}" cy="${ys[0]-y0}" r="${Math.max(w,h)*0.035}" fill="#22c55e"/></svg>`;
}
function renderRoutes(){
  $('noroutes').hidden=routes.length>0;
  $('routes').innerHTML=routes.map(r=>{const runs=runsOn(r).filter(mine),best=runs[0];
    return `<li class="${base?.id===r.id?'on':''}"><button class="sel" data-id="${r.id}">${thumb(r.pts)}<span class="rt"><b>${esc(r.name)}</b><small>${kmStr(r.pts.at(-1).d)} km · ${Math.round(climbOf(r))} m climb${r.laps?` · ${r.laps.n} laps`:''}${r.recorded?' · recorded':''}</small><small>${best?`<span class="best">🏆 ${fmt(best.elapsed/1000)}</span> · ${runs.length} run${runs.length>1?'s':''}`:'Not raced yet'}</small></span></button><button class="del" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">✕</button></li>`}).join('');
  $('routes').querySelectorAll('.sel').forEach(b=>b.onclick=()=>{selectRoute(routes.find(r=>r.id===+b.dataset.id));openSetup()});
  $('routes').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    const r=routes.find(x=>x.id===+b.dataset.id);if(!confirm(`Delete route "${r.name}"?`))return;
    await deleteRoute(r.id);routes=routes.filter(x=>x!==r);if(base===r)selectRoute(routes[0]||null);else renderRoutes();
  });
}

function selectRoute(r){
  base=r;if(r)opt.set('route',r.id);
  renderRoutes();
  $('plan').hidden=!r;$('race').disabled=!r;
  if(r){deriveRoute();rebuild();loadWeather()}else renderToday();
}
// How you're running the chosen route: all of it, the first part of it, or as intervals
const howOf=()=>base?opt.get('how:'+base.id,'full'):'full';
const partLen=()=>{const D=base.pts.at(-1).d;return Math.max(500,Math.min(D-100,opt.get('part:'+base.id,Math.max(1000,Math.round(D/2000)*1000))))};
function deriveRoute(){
  if(howOf()==='part'){
    const L=partLen();
    route={...base,id:`${base.id}:p${L}`,name:`${base.name} · first ${kmStr(L)} km`,pts:slice(base.pts,0,L),cues:cuesWithin(base.cues,0,L),part:{of:base.id,len:L}};
  }else route=base;
  turns=turnsFor(route);
}

// =====================================================================================
// Conditions: forecast for the race start, folded into the pacer's plan
// =====================================================================================
let raceStart=Math.ceil(Date.now()/900e3)*900e3,wx={w:null,key:null,err:null,loading:false};
const cond=()=>o.wxOn&&wx.w?{w:wx.w,start:raceStart,shelter:o.shelter,mode:o.wxMode}:null;
const localInput=ms=>{const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`};
async function loadWeather(force){
  if(!route)return;
  const mid=route.pts[Math.floor(route.pts.length/2)],key=`${route.id}@${Math.floor(raceStart/3600e3)}`;
  if(!force&&wx.key===key&&wx.w&&Date.now()-wx.w.fetched<3600e3)return;
  wx={...wx,key,loading:true,err:null};renderWx();
  try{wx.w=await fetchWeather(mid.lat,mid.lon,raceStart)}catch(e){wx.w=null;wx.err=e.message||'Weather unavailable'}
  wx.loading=false;if(route)rebuild();
}
$('wx-start').onchange=e=>{const v=Date.parse(e.target.value);if(!isNaN(v)){raceStart=v;loadWeather()}};
$('wx-now').onclick=()=>{raceStart=Math.ceil(Date.now()/900e3)*900e3;loadWeather()};
$('wx-on').onclick=()=>{o.wxOn=!o.wxOn;opt.set('wxOn',o.wxOn);rebuild()};
$('wx-mode').querySelectorAll('button').forEach(b=>b.onclick=()=>{o.wxMode=b.dataset.v;opt.set('wxMode',o.wxMode);rebuild()});
$('wx-shelter').querySelectorAll('button').forEach(b=>b.onclick=()=>{o.shelter=b.dataset.v;opt.set('shelter',o.shelter);rebuild()});

function renderWx(){
  $('wx-start').value=localInput(raceStart);
  const mins=Math.round((raceStart-Date.now())/60000);
  $('wx-when').textContent=Math.abs(mins)<20?'Now':new Date(raceStart).toLocaleString(undefined,{weekday:'long',hour:'2-digit',minute:'2-digit'});
  $('wx-on').classList.toggle('on',o.wxOn);$('wx-on').setAttribute('aria-checked',o.wxOn);
  $('wx-opts').hidden=!o.wxOn||!wx.w;
  $('wx-mode').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===o.wxMode));
  $('wx-shelter').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===o.shelter));
  if(wx.loading){$('wx-now-line').innerHTML='<span>Getting the forecast…</span>';$('wx-impact').textContent='';return}
  if(!wx.w){$('wx-now-line').innerHTML=`<span>${esc(wx.err||'No forecast yet')}</span>`;$('wx-impact').textContent='';return}
  const c=wxAt(wx.w,raceStart);
  $('wx-now-line').innerHTML=[`🌡 <b>${Math.round(c.temp)}°C</b>`,`dew point <b>${Math.round(c.dew)}°</b>`,
    `💨 <b>${Math.round(mph(c.wind))} mph</b> from ${compass16(c.dir)}`,c.rain>=0.3?`🌧 <b>${c.rain.toFixed(1)} mm/h</b>`:'dry',c.rad>400?'☀️ sunny':''].filter(Boolean).map(x=>`<span>${x}</span>`).join('');
  if(!P?.wx){$('wx-impact').textContent=o.wxOn?'':'Not used: the pacer runs for still, cool conditions.';$('wx-modenote').textContent='';return}
  const w=P.wx,windPct=w.costPct-w.heatPct,all=windStretches(P.d,w.head),longest=k=>all.filter(s=>s.kind===k).sort((a,b)=>(b.to-b.from)-(a.to-a.from))[0];
  const st=[longest('head'),longest('tail')].filter(Boolean);
  const pct=x=>`${x>=0?'+':'−'}${Math.abs(x).toFixed(1)} %`,diff=w.suggested-P.target;
  $('wx-impact').innerHTML=`Heat &amp; humidity <b>${pct(w.heatPct)}</b> · wind${w.wet?' &amp; rain':''} <b>${pct(windPct)}</b>`+
    (st.length?`<br>${st.map(s=>`${s.kind==='head'?'Headwind':'Tailwind'} ${kmStr(s.from)}–${kmStr(s.to)} km`).join(' · ')}`:'')+
    `<span class="tot ${diff>0.5?'up':diff<-0.5?'down':''}">Conditions ${diff>=0?'cost':'save'} about <b>${gapFmt(Math.abs(diff))}</b> on ${fmt(P.target)}</span>`;
  $('wx-modenote').textContent=o.wxMode==='keep'?`The pacer still finishes in ${fmt(P.finish)}, spending more effort where the conditions are kind and less where they're tough.`
    :`The pacer finishes in ${fmt(P.finish)}: your target plus what today's conditions cost.`;
}

// Rebuild the pacer after any change of route, target or profile
function rebuild(){rebuild0();afterRebuild()}
function rebuild0(){
  renderHow();if(prof.id==='me'){const me=learnedProfile(getA());if(me)prof={...prof,fit:me.fit}}
  const fin=finishFor(route),ghosts=pastRuns(route);
  // Race the pacer, one of your past runs (a ghost that runs exactly as you did), or both at once
  vsMode=ghosts.length?opt.get('pcmode:'+route.id,'profile'):'profile';
  const pick=vsMode!=='profile'?ghosts.find(x=>x.run.id===opt.get('ghost:'+route.id,null))||ghosts[0]:null;
  const G=pick&&ghostFromRun(route.pts,pick.run.fixes,pick.time);
  ghostRun=vsMode==='ghost'?pick.run:null;
  rival=vsMode==='both'?{P:G,run:pick.run,time:pick.time,label:rivalLabel(pick.run)}:null;
  P=vsMode==='ghost'?G:buildPacer(route.pts,fin,prof,{cond:cond()});
  renderPcMode(ghosts,pick);
  $('tgtcard').hidden=$('wxcard').hidden=$('dstyle').hidden=vsMode==='ghost';$('krival').hidden=!rival;
  renderWx();
  const D=P.total,up=P.es.reduce((a,e,i)=>a+(i&&e>P.es[i-1]?e-P.es[i-1]:0),0);
  $('rname').textContent=route.name;
  $('rchips').innerHTML=[`${kmStr(D)} km`,`${Math.round(up)} m climb`,`${turns.length} turn${turns.length===1?'':'s'}`].map(t=>`<span>${esc(t)}</span>`).join('');
  $('v-finish').textContent=fmt(fin);$('v-pace').textContent=fmt(fin/(D/1000));
  renderProfiles();drawPlanMap();drawPlanChart();renderCadPlan();
  const e=extremes(P),g=x=>`${x>0?'+':''}${x.toFixed(1)} %`;
  const pr=profList().find(p=>p.id===prof.id);
  if(ghostRun){$('pinsight').innerHTML=`Racing ${ghostRun.imported?.who?`<b>${esc(ghostRun.imported.who)}'s run</b> from`:'your run from'} <b>${when(ghostRun.started)}</b>: <b>${fmt(P.finish)}</b> (${fmt(P.finish/(D/1000))}/km)${ghostRun===ghosts[0].run?', your best here 🏆':''}. It was slowest at <b>${fmt(e.slow.pace)}</b>/km around ${kmStr(e.slow.d)} km and quickest at <b>${fmt(e.fast.pace)}</b>/km around ${kmStr(e.fast.d)} km.`;return}
  if(rival)$('pinsight').innerHTML=`Racing the pacer <b>(${fmt(P.finish)})</b> and ${rival.run.imported?`the imported run <b>${esc(rival.run.imported.name)}</b>`:`your run from <b>${when(rival.run.started)}</b>`} <b>(${fmt(rival.time)})</b>${rival.run===ghosts[0].run?', your best here 🏆':''}. The pacer sets your target pace; your past run is the purple runner, running exactly as you did that day. `;
  else $('pinsight').innerHTML='';
  $('pinsight').innerHTML+=`${pr?esc(pr.desc)+'<br>':''}${P.wx?`Paced for the ${o.wxMode==='adjust'?'conditions':'conditions, same finish'}. `:''}Slowest <b>${fmt(e.slow.pace)}</b>/km on the ${g(e.slow.grade)} at ${kmStr(e.slow.d)} km · quickest <b>${fmt(e.fast.pace)}</b>/km on the ${g(e.fast.grade)} at ${kmStr(e.fast.d)} km. Finishes in <b>${fmt(P.finish)}</b>.`;
}

function drawPlanMap(el=$('pmap')){
  const pts=route.pts,k=Math.cos(pts[0].lat*Math.PI/180)*111195,xy=pts.map(p=>[p.lon*k,-p.lat*111195]);
  const xs=xy.map(q=>q[0]),ys=xy.map(q=>q[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0,pad=Math.max(w,h)*0.06+10;
  const X=q=>(q[0]-x0).toFixed(1)+','+(q[1]-y0).toFixed(1);
  let s=`<polyline points="${xy.map(X).join(' ')}" fill="none" stroke="#020617" stroke-width="10" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  for(let i=0;i<pts.length-1;i++)s+=`<line x1="${X(xy[i]).replace(',','" y1="')}" x2="${X(xy[i+1]).replace(',','" y2="')}" stroke="${gradeColor(P.grade[i])}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const r=Math.max(w,h)*0.014+4,dot=(q,c)=>{const [x,y]=X(q).split(',');return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`};
  s+=dot(xy.at(-1),'#fff')+dot(xy[0],'#22c55e');
  const c=P.wx&&wx.w?wxAt(wx.w,raceStart):null;
  if(c&&c.wind>0.5){ // wind arrow (pointing where the wind blows) in the top-right corner
    const S=Math.max(w,h)+2*pad,R=S*0.07,cx=w+pad-R*1.2,cy=-pad+R*1.4;
    s+=`<g transform="translate(${cx} ${cy}) rotate(${(c.dir+180)%360})"><circle r="${R}" fill="#0f172a" stroke="#334155" vector-effect="non-scaling-stroke"/><path d="M0 ${-R*0.7}L${R*0.4} ${R*0.35}L0 ${R*0.15}L${-R*0.4} ${R*0.35}Z" fill="#7dd3fc"/></g>`+
      `<text x="${cx}" y="${cy+R*1.9}" fill="#7dd3fc" font-size="${R*0.65}" text-anchor="middle" font-weight="700">${Math.round(mph(c.wind))} mph</text>`;
  }
  el.setAttribute('viewBox',`${-pad} ${-pad} ${w+2*pad} ${h+2*pad}`);el.innerHTML=s;
}

// Elevation coloured by gradient along the bottom, the pacer's pace along the top (higher = faster)
function drawPlanChart(){
  const W=1000,D=P.total,X=d=>(d/D*W).toFixed(1);
  const lo=Math.min(...P.es),hi=Math.max(...P.es),span=Math.max(hi-lo,20),Ye=e=>(215-(e-lo)/span*95).toFixed(1);
  const pmin=Math.min(...P.pace),pmax=Math.max(...P.pace),ps=Math.max(pmax-pmin,10),Yp=p=>(12+(p-pmin)/ps*88).toFixed(1);
  let s='';
  for(let i=0;i<P.d.length-1;i++)s+=`<polygon points="${X(P.d[i])},220 ${X(P.d[i])},${Ye(P.es[i])} ${X(P.d[i+1])},${Ye(P.es[i+1])} ${X(P.d[i+1])},220" fill="${gradeColor(P.grade[i])}" stroke="${gradeColor(P.grade[i])}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  const avg=P.finish/(D/1000);
  s+=`<line x1="0" x2="${W}" y1="${Yp(avg)}" y2="${Yp(avg)}" stroke="#fff" stroke-opacity=".35" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>`;
  if(rival)s+=`<polyline points="${rival.P.d.map((d,i)=>X(d)+','+Yp(Math.max(pmin,Math.min(pmax,rival.P.pace[i])))).join(' ')}" fill="none" stroke="#c084fc" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  s+=`<polyline points="${P.d.map((d,i)=>X(d)+','+Yp(P.pace[i])).join(' ')}" fill="none" stroke="#fb923c" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  $('pchart').innerHTML=s;
  const pct=y=>(y/220*100).toFixed(1)+'%';
  $('pylab').innerHTML=`<span style="top:${pct(Yp(pmin))}">${fmt(pmin)}</span><span style="top:${pct(Yp(avg))}">${fmt(avg)}</span><span style="top:${pct(Yp(pmax))}">${fmt(pmax)}</span>`;
  $('paxis').innerHTML=`<span>0 km</span><span>${kmStr(D/2)}</span><span>${kmStr(D)} km</span>`;
}

// Cadence and stride guide for this route and pacer: your flat baseline, then the targets on its biggest
// climb and descent
let cadBase=null;
function renderCadPlan(){
  $('cadplan').hidden=!o.cad;if(!o.cad)return;
  cadBase=cadenceBaseline(allRuns.filter(r=>r.status==='done'));
  const C=cadencePlan(P,cadBase.base),S=cadenceSigns(P,C);
  const flatPace=P.finish/(P.total/1000),flat={cad:Math.round(cadBase.base+6*1000/flatPace),stride:(1000/flatPace)/((cadBase.base+6*1000/flatPace)/60)};
  const up=S.filter(x=>x.kind==='up').sort((a,b)=>b.grade-a.grade)[0],dn=S.filter(x=>x.kind==='down').sort((a,b)=>a.grade-b.grade)[0]; // steepest of each
  $('cadplan').innerHTML=`<b>Cadence and stride guide</b><div class="row"><span>→ Flat <b>${flat.cad}</b> spm · <b>${flat.stride.toFixed(2)}</b> m</span>`+
    (up?`<span>↑ Steepest climb (${up.grade} %) at ${kmStr(up.d)} km <b>${up.cad}</b> · <b>${up.stride.toFixed(2)}</b> m</span>`:'')+
    (dn?`<span>↓ Steepest descent (${dn.grade} %) at ${kmStr(dn.d)} km <b>${dn.cad}</b> · <b>${dn.stride.toFixed(2)}</b> m</span>`:'')+`</div>`+
    `Climbs: keep your rhythm (a touch quicker if anything) and let the stride shorten. Descents: don't let your cadence drop; let the stride open up, with quick, light steps on steep ones. Back on the flat, the stride lengthens again. `+
    (cadBase.personal?'<span class="dim">Based on your own cadence on flat ground in past runs.</span>':'<span class="dim">Typical-runner values until you\'ve done a run with cadence; then it uses yours.</span>');
}

// ---- How to run it: full / part / intervals; laps for a loop ----
// A small − value + control: get() the value, show(v) its text, set(v, direction) on a tap
function mini(id,get,show,set){
  const el=$(id);el.querySelector('b').textContent=show(get());
  el.querySelectorAll('button').forEach(b=>b.onclick=()=>set(get(),+b.dataset.d));
}
function renderHow(){
  const how=howOf(),D=base.pts.at(-1).d,loop=isLoop(base.pts);
  $('how').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===how);b.onclick=()=>{opt.set('how:'+base.id,b.dataset.v);deriveRoute();rebuild()}});
  $('howpart').hidden=how!=='part';$('intcard').hidden=how!=='int';$('plan').classList.toggle('int-mode',how==='int');
  $('howlaps').hidden=how!=='full'||!loop||!!base.laps;
  $('race').textContent=how==='int'?'Start the session':'Start race';$('qgo').textContent=how==='int'?'Start the session':'Start';
  if(how==='part'){
    $('partnote').textContent=`From the start: the first ${kmStr(partLen())} of ${kmStr(D)} km`;
    mini('partlen',partLen,v=>`${kmStr(v)} km`,(v,dir)=>{opt.set('part:'+base.id,Math.max(500,Math.min(D-100,Math.round((v+dir*500)/100)*100)));deriveRoute();rebuild()});
  }
  if(!$('howlaps').hidden){
    const n=()=>opt.get('laps:'+base.id,3);
    $('lapsnote').textContent=`${n()} laps = ${kmStr(D*n())} km. Saved as its own route, so you can set its target and pacer.`;
    mini('lapsn',n,v=>`× ${v}`,(v,dir)=>{opt.set('laps:'+base.id,Math.max(2,Math.min(20,v+dir)));renderHow()});
    $('lapsave').onclick=async()=>{
      const k=n(),r={name:`${base.name} × ${k}`,created:Date.now(),src:base.src,pts:laps(base.pts,k),cues:[],laps:{of:base.id,n:k}};
      r.id=await saveRoute(r);routes.unshift(r);selectRoute(r);msg(`Saved "${r.name}" (${kmStr(r.pts.at(-1).d)} km)`);
    };
  }
  if(how==='int')renderInt();
}

// ---- Interval sessions ----
const intCfg=()=>{
  const D=base.pts.at(-1).d,c={kind:D<=3000?'repeat':'split',from:0,len:Math.min(D,1000),reps:6,dir:'same',slen:1000,rest:90,pace:Math.round(finishFor(base)/(D/1000)),step:0,...opt.get('int:'+base.id,{})};
  c.from=Math.max(0,Math.min(D-100,c.from));c.len=Math.max(100,Math.min(D-c.from,c.len));c.slen=Math.max(100,Math.min(D,c.slen));
  return c;
};
const setInt=patch=>{opt.set('int:'+base.id,{...intCfg(),...patch});renderInt()};
const restWords=s=>s<60?`${s} seconds`:`${Math.floor(s/60)} minute${s>=120?'s':''}${s%60?` ${s%60}`:''}`;
const restTxt=s=>s<60?`${s} s`:s%60?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:`${s/60} min`;
const restStep=(v,d)=>{const L=[15,30,45,60,75,90,120,150,180,240,300,360,480,600,720,900];let i=L.findIndex(x=>x>=v);if(i<0)i=L.length-1;return L[Math.max(0,Math.min(L.length-1,i+d))]};
const intReps=c=>session(base.pts,{...c,len:c.kind==='split'?c.slen:c.len});
// Finished sessions on this route with the same set-up (same stretch or split, reps and direction)
const sameSession=(a,b)=>a.kind===b.kind&&(a.kind==='split'?a.slen===b.slen:a.from===b.from&&a.len===b.len&&a.dir===b.dir);
const pastSessions=c=>allRuns.filter(x=>x.mode==='intervals'&&x.status==='done'&&x.route?.id===base.id&&x.session&&sameSession(x.session,c)&&(x.reps||[]).length).sort((a,b)=>b.started-a.started);
let intRival=null;
// Rep i of a past session as a ghost on this rep's course
function repRival(i,pts){
  const run=sess?.rival,rep=run?.reps?.[i];if(!rep||!rep.done)return null;
  const fx=run.fixes.filter(f=>f[11]===i);if(fx.length<5)return null;
  return {P:ghostFromRun(pts,fx,rep.time),run,label:'LAST TIME',time:rep.time};
}
function renderInt(){
  const c=intCfg(),D=base.pts.at(-1).d;
  $('i-kind').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===c.kind);b.onclick=()=>setInt({kind:b.dataset.v})});
  $('i-repeat').hidden=c.kind!=='repeat';$('i-split').hidden=c.kind!=='split';
  mini('i-from',()=>c.from,v=>`${kmStr(v)} km`,(v,d)=>setInt({from:Math.max(0,Math.min(D-100,v+d*100))}));
  mini('i-len',()=>c.len,v=>v<1000?`${v} m`:`${kmStr(v)} km`,(v,d)=>setInt({len:Math.max(100,Math.min(D-c.from,v+d*(v<1000?100:250)))}));
  mini('i-reps',()=>c.reps,v=>`${v}`,(v,d)=>setInt({reps:Math.max(1,Math.min(30,v+d))}));
  mini('i-slen',()=>c.slen,v=>v<1000?`${v} m`:`${kmStr(v)} km`,(v,d)=>setInt({slen:Math.max(200,Math.min(D,v+d*(v<1000?100:250)))}));
  mini('i-rest',()=>c.rest,restTxt,(v,d)=>setInt({rest:restStep(v,d)}));
  mini('i-pace',()=>c.pace,v=>`${fmt(v)} /km flat`,(v,d)=>setInt({pace:Math.max(150,Math.min(600,v+d))}));
  $('i-dir').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===c.dir);b.onclick=()=>setInt({dir:b.dataset.v})});
  $('i-dirnote').textContent=c.dir==='same'?'Get back to the start during the rest; each rep starts as you cross the line':'Every other rep runs the stretch back the other way, from where the last one finished';
  $('i-step').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',+b.dataset.v===c.step);b.onclick=()=>setInt({step:+b.dataset.v})});
  // A past session with the same set-up to race, rep by rep (alongside each rep's pacer)
  const same=pastSessions(c),rvOn=same.length&&opt.get('introv:'+base.id,null)!==false,rv=rvOn?same.find(x=>x.id===opt.get('introv:'+base.id,null))||same[0]:null;
  $('i-rvrow').hidden=!same.length;
  if(same.length){
    $('i-rv').classList.toggle('on',!!rv);$('i-rv').setAttribute('aria-checked',!!rv);
    $('i-rvnote').textContent=rv?`Your session from ${when(rv.started)}: every rep against how you ran it then`:`You've done this session ${same.length} time${same.length>1?'s':''}`;
    $('i-rv').onclick=()=>{opt.set('introv:'+base.id,rv?false:same[0].id);renderInt()};
  }
  intRival=rv;
  const R=intReps(c);
  $('i-splitnote').textContent=`${R.length} reps along the ${kmStr(D)} km route`;
  for(const r of R)r.time=repTime(r);
  const row=r=>`<tr><td>${r.i+1}</td><td>${kmStr(r.reverse?r.to:r.from)}→${kmStr(r.reverse?r.from:r.to)} km${r.reverse?' <small>back</small>':''}</td><td>${r.grade>0.4?'↑':r.grade<-0.4?'↓':'→'} ${r.grade>0?'+':''}${r.grade}%</td><td>${fmt(r.time)}</td><td>${fmt(r.time/(r.len/1000))}</td></tr>`;
  $('i-list').innerHTML='<tr><th>Rep</th><th>Where</th><th>Gradient</th><th>Target</th><th>Pace</th></tr>'+(R.length>12?R.slice(0,10).map(row).join('')+`<tr><td colspan="5"><small>… ${R.length-11} more …</small></td></tr>`+row(R.at(-1)):R.map(row).join(''));
  const run=R.reduce((a,r)=>a+r.time,0),dist=R.reduce((a,r)=>a+r.len,0);
  $('i-sum').innerHTML=`<b>${R.length} × ${c.kind==='split'?kmStr(c.slen):kmStr(c.len)} km</b>, ${restTxt(c.rest)} rest: ${kmStr(dist)} km of reps in about <b>${fmt(run)}</b>, ${fmt(run+c.rest*(R.length-1))} with the rests. Rep pace is your effort on the flat: uphill reps get a slower target and downhill ones a quicker one, and each rep's pacer follows the hills within it.`;
}

// Target steppers: hold to repeat, speeding up
function stepper(el,fn){
  el.querySelectorAll('button').forEach(b=>{
    let t=null,n=0;
    const tick=()=>{fn(+b.dataset.d,n++);t=setTimeout(tick,n<6?260:n<20?90:45)};
    b.onpointerdown=e=>{e.preventDefault();n=0;clearTimeout(t);tick()};
    b.onpointerup=b.onpointerleave=b.onpointercancel=()=>{clearTimeout(t);t=null};
  });
}
const setFinish=f=>{const D=route.pts.at(-1).d/1000;f=Math.max(150*D,Math.min(720*D,f));opt.set(finKey(route.id,purposeOf()),Math.round(f));rebuild()};
function setPurpose(pu){if(!route)return;opt.set('purpose:'+route.id,pu);rebuild()}
stepper($('st-finish'),(d,n)=>setFinish(finishFor(route)+d*(n<8?5:n<20?15:60)));
stepper($('st-pace'),(d,n)=>{const D=route.pts.at(-1).d/1000,p=Math.round(finishFor(route)/D)+d*(n<15?1:5);setFinish(p*D)});

// The pacer profiles, with one learned from your own runs first once there's enough to learn from
const profList=()=>{const me=learnedProfile(getA());return me?[me,...PROFILES]:PROFILES};
const profOf=p=>({id:p.id,climb:p.climb,descent:p.descent,strategy:p.strategy,...(p.fit?{fit:p.fit}:{})});
function renderProfiles(){
  $('profiles').innerHTML=profList().map(p=>`<button class="prof ${p.id==='me'?'me':''} ${prof.id===p.id?'on':''}" data-id="${p.id}"><span class="ic">${p.icon}</span><b>${p.name}</b><small>${esc(p.desc)}</small></button>`).join('');
  $('profiles').querySelectorAll('.prof').forEach(b=>b.onclick=()=>setProf(profOf(profList().find(x=>x.id===b.dataset.id))));
  for(const k of ['climb','descent','strategy']){
    const keys=k==='strategy'?['even','negative','positive']:k==='climb'?['weak','average','strong']:['cautious','average','strong'];
    $('t-'+k).innerHTML=keys.map(v=>`<button data-v="${v}" class="${prof[k]===v?'on':''}">${TRAIT_NAMES[k][v]}</button>`).join('');
    $('t-'+k).querySelectorAll('button').forEach(b=>b.onclick=()=>{
      const {fit,...plain}=prof,next={...plain,[k]:b.dataset.v},match=PROFILES.find(p=>p.climb===next.climb&&p.descent===next.descent&&p.strategy===next.strategy);
      setProf({...next,id:match?match.id:'custom'});
    });
  }
}
function setProf(p){prof=p;opt.set('profile',p);if(route)rebuild()}
const setProfQuiet=p=>{prof={...p};opt.set('profile',prof)};

// Choose between a pacer profile and one of your past runs on this route (best first, 🏆)
function renderPcMode(ghosts,pick){
  $('pc-mode').querySelectorAll('button').forEach(b=>{
    b.classList.toggle('on',b.dataset.v===vsMode);b.disabled=b.dataset.v!=='profile'&&!ghosts.length;
    b.onclick=()=>{opt.set('pcmode:'+route.id,b.dataset.v);rebuild()};
  });
  $('pcnote').textContent=ghosts.length?'':'Run this course once and you can race yourself on it, on its own or alongside the pacer.';
  $('ghosts').hidden=vsMode==='profile';
  const D=route.pts.at(-1).d/1000;
  // a leaderboard: everyone who's run this course (you, imported runs, friends' challenges), quickest first
  $('ghosts').innerHTML=`<div class="h">Leaderboard · tap to race</div>`+ghosts.map((g,i)=>`<button class="stylec ${g===pick?'on':''}" data-id="${g.run.id}"><span class="rk ${i===0?'gold':''}">${i+1}</span><span class="bt"><b>${g.run.imported?.who?esc(g.run.imported.who):g.run.imported?esc(g.run.imported.name):'You'}</b><small>${when(g.run.started)}${g.part?` · first ${kmStr(D*1000)} km of ${kmStr(g.run.rd)}`:''}${g.run.imported&&!g.run.imported.who?' · imported':''}${g.run.sim?' · sim':''}</small></span><span class="bv"><b>${fmt(g.time)}</b><small>${fmt(g.time/D)}/km</small></span></button>`).join('');
  $('ghosts').querySelectorAll('.stylec').forEach(b=>b.onclick=()=>{opt.set('ghost:'+route.id,+b.dataset.id);rebuild()});
}

function renderOptions(){
  $('o-speed').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',(b.dataset.v==='1')===o.speed);b.onclick=()=>{o.speed=b.dataset.v==='1';opt.set('speedSrc',o.speed);renderOptions()}});
  $('o-band').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',+b.dataset.v===o.band);b.onclick=()=>{o.band=+b.dataset.v;opt.set('band',o.band);renderOptions()}});
  $('o-live').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===o.live);b.onclick=()=>{o.live=b.dataset.v;opt.set('live',o.live);smoother=createSmoother(LIVE[o.live].tau);renderOptions()}});
  $('o-cad').classList.toggle('on',o.cad);$('o-cad').setAttribute('aria-checked',o.cad);
  $('o-cad').onclick=()=>{o.cad=!o.cad;opt.set('cadGuide',o.cad);renderOptions();if(route)rebuild()};
  $('o-auto').classList.toggle('on',o.auto);$('o-auto').setAttribute('aria-checked',o.auto);
  $('o-auto').onclick=()=>{o.auto=!o.auto;opt.set('auto',o.auto);renderOptions()};
  $('o-voice').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===o.voice);b.onclick=()=>{o.voice=b.dataset.v;opt.set('voice',o.voice);renderOptions()}});
  $('o-tones').classList.toggle('on',o.tones);$('o-tones').setAttribute('aria-checked',o.tones);
  $('o-tones').onclick=()=>{o.tones=!o.tones;opt.set('tones',o.tones);speaker.setOpts({tones:o.tones});renderOptions()};
  $('o-rate').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===o.rate);b.onclick=()=>{o.rate=b.dataset.v;opt.set('rate',o.rate);speaker.setOpts({rate:RATES[o.rate]});renderOptions()}});
  $('o-style').innerHTML=STYLES.map(x=>`<button class="stylec ${x.id===o.coachStyle?'on':''}" data-v="${x.id}"><b>${x.name}<em>${x.who}</em></b><small>${esc(x.desc)}</small><q>${esc(x.example)}</q></button>`).join('');
  $('o-style').querySelectorAll('.stylec').forEach(b=>b.onclick=()=>{o.coachStyle=b.dataset.v;opt.set('coachStyle',o.coachStyle);renderOptions()});
  $('o-style-row').hidden=o.voice==='off';
  $('o-test').onclick=()=>{speaker.unlock();speaker.setMuted(false);o.muted=false;opt.set('muted',false);
    const st=STYLES.find(x=>x.id===o.coachStyle)||STYLES[1];
    speaker.play([{text:'Descent in 50 metres, gradually getting steeper. Pacer picking up to 4:44 at the steepest point.',pri:3,tone:'up'},{text:st.example,pri:2}])};
  $('o-name').value=opt.get('me:name','');$('o-name').onchange=e=>opt.set('me:name',e.target.value.trim());
  for(const [id,k] of [['o-splits','showSplits'],['o-cadrow','showCad'],['o-strip','showStrip'],['o-wind','showWind']]){
    $(id).classList.toggle('on',o[k]);$(id).setAttribute('aria-checked',o[k]);$(id).onclick=()=>{o[k]=!o[k];opt.set(k,o[k]);renderOptions()};
  }
  $('run').classList.toggle('nosplits',!o.showSplits);$('run').classList.toggle('nocad',!o.showCad);$('run').classList.toggle('nostrip',!o.showStrip);$('run').classList.toggle('nowind',!o.showWind);
  $('o-zone').querySelector('b').textContent=`${o.zone} m`;
  $('o-zone').querySelectorAll('button').forEach(b=>b.onclick=()=>{o.zone=Math.max(10,Math.min(100,o.zone+ +b.dataset.d));opt.set('zone',o.zone);renderOptions()});
}
renderOptions();

$('race').onclick=()=>{if(howOf()==='int')return enterSession();if(route&&P)enterRun(route,P,turns,ghostRun?null:cond(),prof,ghostRun,rival)};
$('recbtn').onclick=()=>enterRecord();

// =====================================================================================
// Run
// =====================================================================================
const view=createView($('cv'));
const track=createTrack();
// phase: idle → armed (heading to the start) → running ⇄ paused → done
let phase='idle',acc=0,t0=0,wid=null,lock=null;
let matcher=null,rd=0,rsplits=[],rpts=[],spts=[],curPace=null,vNow=0,lastFixAt=0,lastLL=null,offRoute=false;
let gate=null,rec=null,dirty=false,saving=Promise.resolve(),runP=null,runRoute=null,runTurns=[];
let shownD=0,raf=0,lastFrame=0,lastFrameAt=0,gapNow=null;
// Live pace: GPS speed averaged over spd s (or a fit on position over pos s if the phone gives no speed),
// then smoothed with time constant tau s. Lone wild readings barely count (see createSmoother).
const LIVE={responsive:{spd:2,pos:8,tau:1.2},balanced:{spd:4,pos:10,tau:3},smooth:{spd:7,pos:14,tau:4}}; // ~5 s / ~7 s / ~13 s to show a change
let smoother=createSmoother(LIVE[o.live].tau); // gapNow: s, + = you ahead of the pacer
const el=()=>acc+(phase==='running'?now()-t0:0); // pause-aware elapsed ms
const AUTOSAVE=10000,RESUME_GAP=15*60000;

let coach=null,armSaid=null,runCond=null,runGhost=null,mode='race',trail=[],spokenSplits=0;
// Cadence and stride: step times (s of run time, last minute only), steps this run, steps at each km,
// [t, route distance] for the last minute, the shown values and when they were worked out
const motion=createMotion();
let steps=[],stepN=0,stepSplits=[],dhist=[],cadNow=null,strNow=null,motionT=-1e9,motionFrom=0;
// The cadence/stride guide for this run, its signs, which sign was last spoken, and drift tracking
let runCad=null,runSigns=[],signI=0,tipAt=-1e9,lowCount=0,driftAt=-1e9;
// The course as you're running it (parts cut off, extra run off it), the distance you've actually run,
// whether the off-course card has been shown for this excursion, finish line / full distance times, and
// freestyle (no route: from where you chose it)
let course=null,yd=0,offWarned=false,lineAt=null,fullAt=null,freeYd0=0,freeG0=0,offNote=0,line=null;
// An interval session in progress: {cfg, base, reps, i (current rep), results, restEnd, said}
let sess=null;
// A past run raced alongside the pacer: {P, run, label}; its course as you're running it; who leads it
let runRival=null,rivalCourse=null,rvLead=null,rvLeadAt=-1e9,rvCand=null,rvCandAt=0,rvSplits=0; // line: {yd, g} at the finish line
const who=()=>runGhost?'ghost':'pacer',Who=()=>runGhost?'Ghost':'Pacer';
// Show the parts of the run screen that only make sense when racing a route
function raceUI(on){
  for(const id of ['turn','views'])$(id).hidden=!on;
  $('course').style.display=on?'':'none'; // (an svg: no .hidden)
  $('togow').hidden=!on;$('projl').textContent=on?'Est':'Avg';
  $('plab').textContent=on?Who():'Average';$('lhp').textContent=on?Who():'';
}
// A rep's target time: its pace is the flat-equivalent effort, so an uphill rep takes longer and a
// downhill one less, by your pacer profile's hill handling
function repTime(r,pts){return effortTime(pts||slice((sess?.base||base).pts,r.from,r.to,r.reverse),r.pace,prof)}
// Each rep is its own little course (a stretch of the route, maybe run backwards) with its own pacer
function repCourse(r){
  const pts=slice(sess.base.pts,r.from,r.to,r.reverse);
  const rr={id:`${sess.base.id}:rep`,name:`${sess.base.name} · rep ${r.i+1}`,src:sess.base.src,pts,cues:r.reverse?[]:cuesWithin(sess.base.cues,r.from,r.to)};
  return {route:rr,P:buildPacer(pts,repTime(r,pts),{...prof,strategy:'even'})};
}
// Put rep i on the run screen (keeping the session's record)
function loadRep(i){
  const keep=rec,c=repCourse(sess.reps[i]);sess.i=i;
  enterRun(c.route,c.P,turnsFor(c.route),null,{...prof,strategy:'even'},null,repRival(i,c.route.pts));
  rec=keep;
}
function enterSession(){
  const c=intCfg();
  sess={cfg:c,base,reps:intReps(c),i:0,results:[],restEnd:0,said:new Set(),rival:intRival};
  rec=null;loadRep(0);
}
function enterRun(r=route,p=P,tr=turns,rc=cond(),pf=prof,ghost=null,rv=null){
  runRival=rv;
  mode='race';runCond=rc;runGhost=ghost?{runId:ghost.id,started:ghost.started,who:ghost.imported?.who??null}:null;raceUI(true);
  runRoute=r;runP=p;runTurns=tr;
  const easy=!ghost&&!sess&&purposeOf()==='easy'; // an easy run: the coach never pushes you to catch up
  coach=createCoach({P:p,prof:pf,level:o.voice==='key'?'key':'full',style:easy?'relaxed':o.coachStyle,band:o.band,who:who()});armSaid=null;
  setMuteUI();
  resetRun();
  view.setRoute(r.pts,p,tr);
  runCad=o.cad?cadencePlan(p,(cadBase||cadenceBaseline(allRuns.filter(x=>x.status==='done'))).base):null;
  runSigns=runCad?cadenceSigns(p,runCad):[];view.setSigns(runSigns);
  drawCourse(p);
  show('run');layout();setView(o.view);
  cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
// Recording a new route: no pacer, your trail on the map, and the route is built when you save
function enterRecord(){
  mode='record';runRival=null;runCond=null;runRoute=null;runP=null;runTurns=[];runGhost=null;coach=null;raceUI(false);
  runCad=null;runSigns=[];view.setSigns([]);
  setMuteUI();resetRun();view.clearRoute();
  show('run');layout();
  cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
function resetRun(){
  phase='idle';acc=0;track.reset();smoother.reset();rd=0;rsplits=[];rpts=[];spts=[];curPace=null;vNow=0;shownD=0;offRoute=false;
  $('rvbar').hidden=true;rec=null;dirty=false;gate=null;sim.restart=true;sim.moving=false;trail=[];spokenSplits=0;
  steps=[];stepN=0;stepSplits=[];dhist=[];cadNow=strNow=null;motionT=-1e9;motionFrom=0;signI=0;tipAt=-1e9;lowCount=0;driftAt=-1e9;
  course=runP?createCourse(runP):null;rivalCourse=runRival?createCourse(runRival.P):null;rvLead=null;rvLeadAt=-1e9;rvCand=null;rvSplits=0;yd=0;offWarned=false;lineAt=fullAt=null;line=null;$('offcard').hidden=true;
  matcher=runRoute?createMatcher(runRoute.pts):null;
  $('off').hidden=true;$('arm').hidden=true;
  setPhaseUI();hud();
}
// The map stops at the top of the control bar; the side panel runs from below the top cards to it
// The view stops at the top of the bottom panel; the splits column runs down the left between them
function layout(){
  const bar=$('bottom').getBoundingClientRect().height,top=document.querySelector('.ovtop .row2').getBoundingClientRect().bottom;
  $('cv').style.height=`${Math.max(100,$('run').clientHeight-bar)}px`;
  $('lside').style.top=`${top+8}px`;$('lside').style.bottom='auto';$('lside').style.maxHeight=`${Math.max(80,$('run').clientHeight-bar-top-16)}px`;
  view.resize();
  view.setInsets(top+6,8,8,$('lside').offsetParent===null?0:$('lside').getBoundingClientRect().width+12);
}
addEventListener('resize',()=>{if(!$('run').hidden)layout()});
function setView(m){o.view=m;opt.set('view',m);$('views').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===m))}
$('views').querySelectorAll('button').forEach(b=>b.onclick=()=>setView(b.dataset.v));

function setPhaseUI(){
  const go=$('go');go.className='btn go';
  go.textContent={idle:'Start',armed:'Cancel',running:'Pause',paused:'Continue',done:'Start',rest:''}[phase];
  $('restcard').hidden=phase!=='rest';
  if(phase==='armed')go.classList.add('cancel');
  $('finbtn').hidden=$('discbtn').hidden=phase!=='paused';
  $('ctrls').hidden=phase==='running'||phase==='rest';               // running: your pace, the pacer's, and a big Pause
  $('tiles').hidden=phase!=='running';               // paused: Continue / Save / Discard instead
  $('lside').hidden=phase==='idle'||phase==='armed'||phase==='rest'; // nothing to show yet, and the start card needs the width
  if(!$('run').hidden)requestAnimationFrame(layout);
  $('back').hidden=phase==='running'||phase==='armed'||phase==='rest';
}

// ---- GPS ----
const gpsErr=e=>{$('gpsline').textContent='GPS error: '+e.message};
// (In the sim, recording a route replays the route selected on Home)
function ensureWatch(){if(wid===null)wid=SIM?simWatch(()=>mode==='record'?(route&&P?{route,P}:null):runRoute&&runP?{route:runRoute,P:runP}:null,onPos,gpsErr):watch(onPos,gpsErr)}

function onPos(p){
  const c=p.coords;
  $('gpsline').textContent=`GPS ±${Math.round(c.accuracy)} m`+(SIM?` · SIM ${SPEED}×`:'');
  if(c.accuracy<=50)lastLL={lat:c.latitude,lon:c.longitude};
  if(phase==='armed')armFix(p);
  if(phase!=='running')return;
  const t=el(),used=track.add(c,p.timestamp,t);
  if(used){
    if(mode==='free'){yd=freeYd0+(track.dist-freeG0);rd=yd}
    else if(matcher){
      const m=matcher.update(c.latitude,c.longitude,track.dist);
      // A cut or extra of 60 m or more (less is GPS cutting a corner or a turnaround tip); nothing after the finish line
      if(m.event&&m.event.len>=MIN_EVENT&&lineAt==null){course.add(m.event);rivalCourse?.add(m.event);rec.course=course.toJSON();courseEvent(m.event)}
      rd=m.d;offRoute=m.off;
      yd=line?line.yd+(track.dist-line.g):m.matched?course.ran(rd,m.offDist):track.dist; // past the finish line: GPS distance from there
      offUI(m);
    }else rd=yd=track.dist; // recording: your own distance
    while(yd>=(rsplits.length+1)*1000){rsplits.push(t);stepSplits.push(stepN)}
    rpts.push({t,d:yd});dhist.push([t/1000,yd]);while(dhist.length&&dhist[0][0]<t/1000-60)dhist.shift();
  }
  // GPS speed from every decent fix, even ones too close together to count for distance
  if(c.accuracy<=25&&c.speed!=null&&c.speed>=0)spts.push({t,v:c.speed});
  updatePace(t);
  if(!used)return;
  if(mode!=='race')trail.push({lat:c.latitude,lon:c.longitude,p:curPace});
  rec.fixes.push([p.timestamp,t,c.latitude,c.longitude,c.accuracy,track.dist,rd,curPace,cadNow&&Math.round(cadNow),strNow&&+strNow.toFixed(2),Math.round(yd),sess?sess.i:null]);dirty=true;
  if(mode==='race'&&runP)finishLine(t);
}

// ---- The past run alongside the pacer: its gap in the pacer tile; calls when the lead changes and at
// each km ----
function rivalHud(t){
  // The past run (or friend) gets its own bar above the tiles: who, the gap, and how far apart you are
  const on=!!runRival&&mode==='race'&&phase!=='idle'&&phase!=='armed';
  if($('rvbar').hidden===on){$('rvbar').hidden=!on;requestAnimationFrame(layout)}
  if(!on)return;
  const D=runP.total,g=fullAt!=null?runRival.P.finish-fullAt/1000:lineAt!=null?rivalCourse.pacerT(D)-lineAt/1000:rivalCourse.pacerT(rd)-t;
  const m=Math.round(rivalCourse.pacerD(t)-rd),nm=runRival.label;
  $('rvname').textContent=nm;$('rvbar').className='rvbar '+(Math.abs(g)<0.5?'level':g>0?'lead':'trail');
  $('rvgap').textContent=Math.abs(g)<0.5?'Level':g>0?`You lead by ${gapFmt(g)}`:`${gapFmt(-g)} ahead of you`;
  $('rvm').textContent=lineAt==null&&Math.abs(m)>=5?`${Math.abs(m)} m ${m>0?'up the road':'back'}`:'';
  if(phase!=='running'||lineAt!=null)return;
  // lead changes (held 3 s, at most one a minute)
  const lead=g>0.5?'you':g<-0.5?'them':rvLead,n=Date.now();
  if(lead!==rvCand){rvCand=lead;rvCandAt=n}
  if(lead&&lead!==rvLead&&n-rvCandAt>3000&&t-rvLeadAt>60){
    const first=rvLead==null;rvLead=lead;rvLeadAt=t;
    if(!first&&voiceOn())speaker.say(lead==='you'?`You've passed ${rvWho(runRival.run)}.`:`${cap(rvWho(runRival.run))} has gone ahead.`,2,lead==='you'?'pass':'passed');
  }
  // after each km: where you are against it
  if(rsplits.length>rvSplits){rvSplits=rsplits.length;if(voiceOn()&&Math.abs(g)>=1){const w=`${rvWho(runRival.run)}`,by=gapPhrase(g).replace(/ (ahead|behind)$/,'');speaker.say(g>0?`You're ${by} up on ${w}.`:`${w[0].toUpperCase()+w.slice(1)} is ${by} ahead.`,1)}}
}

// ---- Interval sessions: end of a rep, the rest, the next rep ----
async function endRep(complete){
  const t=el()/1000,r=sess.reps[sess.i],D=runP.total,done=complete||rd>=D-8;
  const res={i:sess.i,from:r.from,to:r.to,reverse:r.reverse,len:r.len,pace:r.pace,grade:r.grade,time:+t.toFixed(1),dist:Math.round(yd),done,
    pacer:+course.pacerT(Math.min(rd,D)).toFixed(1),cad:cadNow&&Math.round(cadNow),last:runRival?.time??null};
  sess.results.push(res);rec.reps=sess.results;
  const last=sess.i>=sess.reps.length-1,g=res.pacer-t;
  const lt=res.last!=null?res.last-t:null;
  if(voiceOn()&&done)speaker.say(`Rep ${sess.i+1} done in ${fmt(t)}. ${Math.abs(g)<1?'Spot on.':g>0?`${gapPhrase(g).replace(' ahead','')} under target.`:`${gapPhrase(g).replace(' behind','')} over target.`}${lt==null?'':Math.abs(lt)<1?' Same as last time.':lt>0?` ${gapPhrase(lt).replace(' ahead','')} quicker than last time.`:` ${gapPhrase(lt).replace(' behind','')} slower than last time.`}`,3,'pass');
  if(!done||last)return finishSession();
  startRest();
}
function startRest(){
  const nx=sess.i+1,prev=sess.results.at(-1);
  sess.restEnd=now()+sess.cfg.rest*1000;sess.said=new Set();
  loadRep(nx);phase='rest';sim.moving=false;wake();setPhaseUI();save();
  $('rlast').textContent=`Rep ${prev.i+1}: ${fmt(prev.time)} (target ${fmt(prev.pacer)}${prev.last!=null?`, last time ${fmt(prev.last)}`:''}) · ${fmt(prev.time/(prev.dist/1000||1))}/km`;
  renderNext();
  const r=sess.reps[nx];
  if(voiceOn())speaker.say(`Rest, ${restWords(sess.cfg.rest)}. Next, rep ${nx+1}: ${r.len<1000?`${r.len} metres`:`${kmStr(r.len)} kilometres`}, ${r.grade>1?'uphill':r.grade<-1?'downhill':'flat'}, target ${fmt(runP.finish)}.`,2);
}
function renderNext(){
  const r=sess.reps[sess.i];
  $('rnext').textContent=`Next: rep ${r.i+1} of ${sess.reps.length}`;
  $('rnextd').textContent=`${r.len<1000?`${r.len} m`:`${kmStr(r.len)} km`} ${r.reverse?'back the other way':''} · ${r.grade>0?'+':''}${r.grade}% · target ${fmt(runP.finish)} (${fmt(runP.finish/(r.len/1000))}/km)`;
  $('rpacenote').textContent=sess.i<sess.reps.length-1?'Changes this and the reps after it':'';
  // Change the pace for the next rep (and the rest of the session by the same amount)
  mini('r-pace',()=>sess.reps[sess.i].pace,v=>`${fmt(v)} /km flat`,(v,d)=>{
    for(let j=sess.i;j<sess.reps.length;j++)sess.reps[j].pace=Math.max(150,Math.min(600,sess.reps[j].pace+d));
    const keepEnd=sess.restEnd;loadRep(sess.i);phase='rest';sess.restEnd=keepEnd;setPhaseUI();renderNext();
  });
}
function restHud(){
  const left=Math.max(0,(sess.restEnd-now())/1000),s=Math.ceil(left);
  $('rclock').textContent=fmt(s);
  // How far to the start of the next rep (from the same start, you get back there during the rest)
  const st=runRoute.pts[0],k=lastLL?Math.cos(st.lat*Math.PI/180)*111195:0,away=lastLL?Math.hypot((lastLL.lon-st.lon)*k,(lastLL.lat-st.lat)*111195):null;
  $('rgo').textContent=away==null?'':away>o.zone?`Start of the next rep: ${away<1000?Math.round(away)+' m':kmStr(away)+' km'} away`:'You\'re at the start';
  for(const at of [60,30,10])if(s===at&&!sess.said.has(at)&&sess.cfg.rest>at+5){sess.said.add(at);if(voiceOn())speaker.say(`${at} seconds`,2)}
  if(left<=0)restDone();
}
function restDone(){
  if(phase!=='rest')return;
  $('restcard').hidden=true;phase='idle';speaker.clear(); // drop anything still queued from the rest
  if(o.auto){if(voiceOn())speaker.say('Rest over. The rep starts as you cross the start.',3,'start');arm()}else start(now());
}
$('rskip').onclick=()=>{speaker.unlock();restDone()};
$('rend').onclick=()=>{if(confirm('End the session here?'))finishSession()};
async function finishSession(){
  phase='done';sim.moving=false;lock?.release();lock=null;$('restcard').hidden=true;
  const R=sess.results;
  Object.assign(rec,{status:'done',running:false,complete:R.length===sess.reps.length&&R.every(x=>x.done),reps:R,elapsed:R.reduce((a,x)=>a+x.time,0)*1000,
    rd:R.reduce((a,x)=>a+x.dist,0),saved:Date.now()});
  sess=null;
  await saving;rec.id=await saveRun(rec);allRuns=await listRuns();
  cancelAnimationFrame(raf);showResult(rec);resultFresh=true;
}

// ---- When the course and what you run don't match ----
// At the finish line: done, unless part of the course was cut off; then you're told how far short you
// are and keep going until you stop (the full distance is noted when you reach it)
function finishLine(t){
  const D=runP.total;
  if(sess){if(rd>=D-8)finishRun(true);return} // end of a rep
  if(lineAt==null&&rd>=D-8){
    if(course.skipped<30)return finishRun(true);
    lineAt=t;rec.lineAt=t;line=rec.line={yd,g:track.dist};dirty=true;
    const short=Math.round((D-yd)/10)*10,g=course.pacerT(D)-t/1000,w=runGhost?'your past run':'the pacer';
    if(voiceOn())speaker.say(`That's the finish line, but part of the course was missed, so you've run ${kmStr(yd)} kilometres, ${short} metres short. Over the same course, ${Math.abs(g)<1?`you're level with ${w}`:g>0?`you beat ${w} by ${gapPhrase(g).replace(' ahead','')}`:`${w} was ${gapPhrase(g).replace(' behind','')} quicker`}. Keep going to make up the full distance, and stop when you're done.`,3,'pass');
  }
  if(lineAt!=null&&fullAt==null&&yd>=D){
    fullAt=t;rec.fullAt=t;dirty=true;
    const g=runP.finish-t/1000,w=runGhost?'your past run':'the pacer';
    if(voiceOn())speaker.say(`That's the full ${kmStr(D)} kilometres in ${fmt(t/1000)}. ${Math.abs(g)<1?`Level with ${w}`:g>0?`You beat ${w} by ${gapPhrase(g).replace(' ahead','')}`:`${w[0].toUpperCase()+w.slice(1)} was ${gapPhrase(g).replace(' behind','')} quicker`}. Pause and save when you're ready.`,3,'pass');
  }
}
// Cut a bit off, or came back from an overshoot or detour: say so, and that it's been allowed for
function courseEvent(ev){
  const m=Math.round(ev.len/10)*10;
  const text=ev.kind==='skip'?`Looks like about ${m} metres of the course was cut off. I've allowed for it: the ${who()} skips it too, and your distance is what you've run.`
    :`Back on the course. That was about ${m} metres extra.`;
  if(voiceOn())speaker.say(text,2);
  offNote=Date.now()+6000;$('off').hidden=false;$('off').textContent=ev.kind==='skip'?`Course cut by ${m} m · allowed for`:`${m} m extra · back on the course`;
}
// Off the course: which way back; after 100 m, the choice of heading back or freestyling
const ARROWS=['↑','↗','→','↘','↓','↙','←','↖'],MIN_EVENT=60;
function offUI(m){
  if(lineAt!=null){$('off').hidden=false;$('off').textContent=fullAt!=null?'Full distance done · pause and save when you\'re ready':`Past the finish · ${Math.max(0,Math.round(runP.total-yd))} m to the full distance`;return}
  if(!m.off){offWarned=false;$('offcard').hidden=true;if(Date.now()>offNote)$('off').hidden=true;return}
  const rel=m.rejoin?ARROWS[Math.round(((m.rejoin.bearing-view.headings().view+360)%360)/45)%8]:'';
  $('off').hidden=!$('offcard').hidden; // (the card says it all while it's up)
  $('off').textContent=m.matched?`Off course · ${Math.round(m.offDist)} m${m.rejoin?` · course ${Math.round(m.rejoin.dist)} m ${rel}`:''}`:'Not on the route yet · using GPS distance';
  if(m.matched&&m.offDist>100&&!offWarned){
    offWarned=true;
    $('offtext').textContent=`You've run ${Math.round(m.offDist)} m away from the course${m.rejoin?`, which is ${Math.round(m.rejoin.dist)} m ${rel}`:''}. Head back and it picks up where you rejoin; anything extra is allowed for. Or freestyle: no target pace or ${who()}, just your time, distance and splits.`;
    $('offcard').hidden=false;
    if(voiceOn())speaker.say(`You're off the course. Head back to it, or tap freestyle.`,3,'down');
  }
}
$('offback').onclick=()=>{$('offcard').hidden=true;$('off').hidden=false;if(voiceOn())speaker.say('OK. Head back to the course.',2)};
$('offfree').onclick=()=>goFree();
// Freestyle: the run carries on like a recording (your trail, live and average pace, splits), no pacer
function goFree(silent){
  $('offcard').hidden=true;$('off').hidden=true;
  mode='free';freeYd0=yd;freeG0=track.dist;offRoute=false;
  if(rec&&!rec.freestyle){rec.freestyle={rd:Math.round(rd),yd:Math.round(yd),t:el()};dirty=true}
  coach=null;runCad=null;runSigns=[];view.setSigns([]);view.clearRoute();raceUI(false);
  trail=lastLL?[{lat:lastLL.lat,lon:lastLL.lon,p:curPace}]:[];
  if(!silent&&voiceOn())speaker.say('Freestyle. No target pace now: just your time, distance and splits. Pause and save when you\'re done.',2);
}

function updatePace(t){
  const L=LIVE[o.live]||LIVE.balanced;
  rpts=rpts.filter(q=>t-q.t<=L.pos*1000);spts=spts.filter(q=>t-q.t<=L.spd*1000);
  const raw=(o.speed&&speedPace(spts,L.spd*500))||fitPace(rpts,L.pos*600),v=smoother.update(raw?1000/raw:null,t);
  curPace=v&&v>1000/1800?1000/v:null;vNow=v||0;lastFixAt=now();
}

// ---- Start gate (as v1): the clock starts as you cross the start line ----
function arm(){
  phase='armed';gate=createStartGate(runRoute.pts,{zone:o.zone});
  if(SIM){sim.jump=-150;sim.moving=true}
  ensureWatch();wake();
  $('arm').className='far';$('armh').textContent='Finding your position…';$('armdist').textContent='';$('arms').textContent='';$('armarrow').style.visibility='hidden';
  $('arm').hidden=false;setPhaseUI();
}
function disarm(){phase='idle';gate=null;sim.moving=false;$('arm').hidden=true;setPhaseUI()}
function armFix(p){
  const c=p.coords,g=gate.update(c.latitude,c.longitude,c.accuracy,p.timestamp);
  if(g.state==='go'){$('arm').hidden=true;const t=now();start(Math.min(t,Math.max(g.crossTs,t-60000)));return}
  if(g.state==='ready'&&armSaid!=='ready'&&voiceOn())speaker.say('At the start. The clock starts as you cross the line.',2,'start');
  if(g.state!=='crossing')armSaid=g.state;
  const head=c.heading!=null&&!isNaN(c.heading)&&c.speed>0.8?c.heading:null,rel=head==null?null:(g.bearing-head+360)%360;
  const T={weak:['Waiting for GPS',`Accuracy ±${Math.round(g.acc)} m · needs ±20 m or better`],far:['Head to the start',''],
    ready:['At the start ✓','Your pacer is waiting. Clock starts as you cross the line'],crossing:['At the start ✓','Go!'],
    past:["You're over the start line",'Step back behind it, or tap Start now']}[g.state];
  $('arm').className=g.state==='crossing'?'ready':g.state;$('armh').textContent=T[0];
  $('armdist').textContent=g.state==='weak'?'':`${Math.round(g.dist)} m`;
  $('arms').textContent=g.state==='far'?(rel==null?`Start is ${compass(g.bearing)} of you`:rel<30||rel>330?'Straight ahead':rel<150?'Ahead to your right':rel<=210?'Behind you':'Ahead to your left'):T[1];
  $('armarrow').style.visibility=g.state==='far'&&rel!=null?'visible':'hidden';
  if(rel!=null)$('armarrow').style.transform=`rotate(${rel}deg)`;
}
$('armgo').onclick=()=>{$('arm').hidden=true;start()};

// ---- Run controls ----
async function wake(){try{lock=await navigator.wakeLock?.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if((phase==='running'||phase==='armed')&&document.visibilityState==='visible')wake()});

function start(at){
  if(sess&&voiceOn()){speaker.say(`Rep ${sess.i+1}${sess.i?'':` of ${sess.reps.length}`}. Go! Target ${fmt(runP.finish)}.`,3,'start')}
  else if(voiceOn())speaker.say(rec?'Resumed':mode==='record'?'Recording. Off you go.':`Go! Your ${who()}'s away.`,3,'start');
  if(!rec&&sess)rec={rival:sess.rival?{runId:sess.rival.id,started:sess.rival.started}:null,started:Date.now(),status:'active',mode:'intervals',sim:SIM,route:{id:sess.base.id,name:sess.base.name,src:sess.base.src},
    session:{...sess.cfg,n:sess.reps.length},reps:[],prof:{...prof},speed:o.speed,fixes:[]};
  if(!rec&&mode==='record')rec={started:Date.now(),status:'active',mode:'record',sim:SIM,route:null,speed:o.speed,fixes:[]};
  if(!rec){rec={started:Date.now(),status:'active',mode:'race',sim:SIM,route:{id:runRoute.id,name:runRoute.name,src:runRoute.src,pts:runRoute.pts,cues:runRoute.cues||[]},
    finish:runP.target??runP.finish,prof:{...prof},speed:o.speed,cond:runCond,fixes:[],purpose:runGhost?'race':purposeOf(),
    ghost:runGhost?{...runGhost,time:runP.time.map(x=>+x.toFixed(1))}:null,
    rival:runRival?{runId:runRival.run.id,started:runRival.run.started,label:runRival.label,imported:runRival.run.imported?.name??null,who:runRival.run.imported?.who??null,time:runRival.P.time.map(x=>+x.toFixed(1))}:null}}
  // a session from your training plan, loaded today on this route: the run is that session
  const pp=opt.get('prog:pending',null);
  if(rec&&!rec.prog&&mode!=='record'&&pp&&pp.day===new Date().toDateString()&&String((sess?.base||runRoute)?.id??'').split(':')[0]===String(pp.routeId))rec.prog={key:pp.key,kind:pp.kind,test:!!pp.test};
  phase='running';t0=at??now();track.last=null;rpts=[];spts=[];sim.moving=true;
  ensureWatch();wake();setPhaseUI();
}
function pause(){acc=el();phase='paused';sim.moving=false;lock?.release();lock=null;setPhaseUI();save();if(voiceOn())speaker.say('Paused',2)}
$('pausebig').onclick=()=>{if(phase==='running')pause()};
$('go').onclick=()=>{
  speaker.unlock(); // iOS: audio must be started from a tap
  motionOn();       // …and so must motion permission
  if(phase==='running')pause();
  else if(phase==='armed')disarm();
  else if(phase==='idle')o.auto&&mode==='race'?arm():start();
  else if(phase==='paused')start(now());
};
$('finbtn').onclick=async()=>{
  if(phase!=='paused')return;
  if(!worth(rec)){alert('Nothing much recorded yet, so there is nothing to save.');return}
  finishRun(false);
};
$('discbtn').onclick=async()=>{
  if(phase!=='paused'||!confirm("Discard this run? It won't be saved."))return;
  await saving;if(rec?.id)await deleteRun(rec.id);
  rec=null;if(sess){sess.results=[];loadRep(0);rec=null}else resetRun();
};
$('back').onclick=async()=>{
  if(phase==='paused'&&rec){if(!confirm('Leave this run? It stays saved, and you can resume it from the home screen.'))return;await save()}
  else if(phase==='idle'&&rec?.id&&!worth(rec))await deleteRun(rec.id);
  cancelAnimationFrame(raf);phase='idle';sim.moving=false;rec=null;sess=null;$('restcard').hidden=true;show('home');refreshHistory();
};

// ---- Recording ----
const worth=r=>!!r&&r.fixes.length>=2&&(r.rd||rd)>=50;
function snapshot(){Object.assign(rec,{elapsed:el(),running:phase==='running',rd,yd,dist:track.dist,rsplits:[...rsplits],steps:stepN,stepSplits:[...stepSplits],course:course?.toJSON(),saved:Date.now()})}
function save(){
  if(!rec)return saving;
  snapshot();dirty=false;const r=rec;
  return saving=saving.then(()=>saveRun(r)).then(id=>{r.id=id}).catch(e=>{dirty=true;$('gpsline').textContent='Autosave failed: '+e.message});
}
every(AUTOSAVE,()=>{if(dirty&&rec)save()});
addEventListener('pagehide',()=>{if(rec&&phase!=='done')save()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&rec&&phase!=='done')save()});

async function finishRun(complete){
  if(mode==='record')return finishRecord();
  if(sess)return endRep(complete);
  acc=el();phase='done';sim.moving=false;lock?.release();lock=null;$('offcard').hidden=true;
  const said=lineAt!=null;complete=complete||lineAt!=null; // reached the finish line of a shortened course
  if(complete&&mode==='race')rd=runP.total;
  snapshot();Object.assign(rec,{status:'done',running:false,complete});
  if(complete&&!said&&mode==='race'&&voiceOn()){const g=timeAt(runP,runP.total)-acc/1000,w=runGhost?'your past run':'the pacer';speaker.say(`Finished in ${fmt(acc/1000)}. ${Math.abs(g)<0.5?`A dead heat with ${w}!`:g>0?`You beat ${w} by ${gapPhrase(g).replace(' ahead','')}!`:`${w[0].toUpperCase()+w.slice(1)} won by ${gapPhrase(g).replace(' behind','')}.`}`,3,'pass')}
  await saving;rec.id=await saveRun(rec);allRuns=await listRuns();
  cancelAnimationFrame(raf);showResult(rec);resultFresh=true;
}

// Save a recording as a new route plus the run on it: drop poor fixes, resample every 10 m, smooth out
// GPS zigzag, fetch elevation (phone GPS height is too rough for gradients), name it, then place the run
// on its own route so it can be raced as a ghost
async function finishRecord(){
  acc=el();snapshot();
  const good=rec.fixes.filter(f=>f[4]<=25);
  if(track.dist<200||good.length<10){alert("That's too short to save as a route. Keep going, or discard it.");return}
  phase='done';sim.moving=false;lock?.release();lock=null;cancelAnimationFrame(raf);
  $('rbadge').textContent='⏳';$('rtitle').textContent='Saving your route…';$('rsub').textContent='Cleaning up the track and fetching elevation';$('rkm').innerHTML='';show('result');
  let s=resample(good.map(f=>({lat:f[2],lon:f[3],ele:null})));
  const sm=s.map((p,i)=>{const a=Math.max(0,i-2),b=Math.min(s.length-1,i+2),n=b-a+1;let la=0,lo=0;for(let j=a;j<=b;j++){la+=s[j].lat;lo+=s[j].lon}return {lat:i&&i<s.length-1?la/n:p.lat,lon:i&&i<s.length-1?lo/n:p.lon,ele:null}});
  s=resample(sm);
  let flat=false;
  try{s=await fillElevation(s,fetch,5)}catch(e){s=s.map(p=>({...p,ele:0}));flat=true}
  const D=s.at(-1).d,def=`Run from ${shortDate(rec.started)}, ${kmStr(D)} km`;
  const name=(prompt('Name this route',def)||def).trim()||def;
  const r={name,created:Date.now(),src:flat?'Recorded (elevation pending)':'Recorded',pts:s,cues:[],recorded:true,needsEle:flat};
  r.id=await saveRoute(r);routes.unshift(r);
  const m=createMatcher(s),fx=rec.fixes.map(f=>[...f.slice(0,6),m.update(f[2],f[3],f[5]).d,...f.slice(7)]),spl=[];
  for(const f of fx)while(f[6]>=(spl.length+1)*1000)spl.push(f[1]);
  Object.assign(rec,{status:'done',running:false,complete:true,route:{id:r.id,name,src:r.src,pts:s,cues:[]},fixes:fx,rd:D,rsplits:spl,finish:rec.elapsed/1000,prof:null});
  await saving;rec.id=await saveRun(rec);allRuns=await listRuns();
  if(voiceOn())speaker.say(`Route saved. ${kmStr(D)} kilometres in ${fmt(rec.elapsed/1000)}.`,2);
  showResult(rec);resultFresh=true;
}
// Recorded routes saved offline get their elevation when there's signal again
async function fixRecordedElevation(){
  for(const r of routes.filter(x=>x.needsEle)){
    try{r.pts=await fillElevation(r.pts.map(p=>({...p,ele:null})),fetch,5);r.needsEle=false;r.src='Recorded';await saveRoute(r);if(base===r){deriveRoute();rebuild()}}catch(e){return}
  }
}

// ---- Frame loop: smooth movement between GPS fixes ----
function loop(ts){
  raf=requestAnimationFrame(loop);
  if(ts-lastFrame<33)return;lastFrame=ts;
  // You glide at your smoothed speed; each GPS position eases the arrow in over ~1.5 s rather than jumping
  const tn=now(),dt=lastFrameAt?Math.min(0.5,(tn-lastFrameAt)/1000):0;lastFrameAt=tn;
  if(mode!=='race'){view.draw({trail,avg:rd>50?el()/1000/(rd/1000):null,dist:rd});return}
  if(phase==='running'){
    shownD+=vNow*dt;const err=rd-shownD;
    shownD=Math.abs(err)>80?rd:shownD+err*Math.min(1,dt/1.5);
    shownD=Math.min(runP.total,Math.max(0,shownD));
  }else shownD+=(rd-shownD)*0.3;
  const started=phase==='running'||phase==='paused'||phase==='done';
  const pd=started?course.pacerD(el()/1000):0,rvd=runRival?(started?rivalCourse.pacerD(el()/1000):0):null;
  courseMarks(started?shownD:0,pd,rvd);
  view.draw({mode:o.view,label:runGhost?(runGhost.who?runGhost.who.toUpperCase().slice(0,12):'GHOST'):'PACER',you:started?shownD:0,pacer:pd,gap:started?gapNow:null,youCol:STATUS_COL[stat]||null,gps:(!started||offRoute)?lastLL:null,rival:runRival&&mode==='race'?{d:rvd,label:runRival.label}:null});
}

// Are you physically within 25 m of this turn's point? (GPS, not just route distance)
function uturnHere(tn){
  if(!tn||!lastLL)return false;
  const tp=runRoute.pts[Math.min(runRoute.pts.length-1,Math.round(tn.d/10))],k=Math.cos(tp.lat*Math.PI/180)*111195;
  return Math.hypot((lastLL.lon-tp.lon)*k,(lastLL.lat-tp.lat)*111195)<=25;
}

// Mute button on the run screen
function setMuteUI(){$('mute').textContent=o.muted||o.voice==='off'?'🔇':'🔊';$('mute').setAttribute('aria-label',o.muted?'Unmute voice coach':'Mute voice coach')}
$('mute').onclick=()=>{
  speaker.unlock();
  if(o.voice==='off'){o.voice='full';opt.set('voice','full');coach?.setLevel('full')}else{o.muted=!o.muted;opt.set('muted',o.muted)}
  speaker.setMuted(o.muted);setMuteUI();if(voiceOn())speaker.say('Voice coach on',2);
};

// Your elapsed time (s) when you were 1 km back from where you are now, from the recorded fixes
// The pacer's time over the last km you ran (on the course as you're running it)
const planBack=()=>yd>=1000?course.pacerT(rd)-course.pacerAtRan(yd-1000):null;
function timeOneKmBack(){
  const f=rec?.fixes,want=yd-1000,D=x=>x[10]??x[6];if(!f?.length||want<0)return null;
  let lo=0,hi=f.length-1;if(D(f[lo])>want)return null;
  while(hi-lo>1){const m=(lo+hi)>>1;if(D(f[m])<=want)lo=m;else hi=m}
  const a=f[lo],b=f[hi],k=D(b)>D(a)?(want-D(a))/(D(b)-D(a)):0;
  return (a[1]+(b[1]-a[1])*Math.max(0,Math.min(1,k)))/1000;
}

// Wind in the strip: the wind you feel (arrow shows where it blows, as you see the screen) and
// head/tail/cross for your direction of running
function stripWeather(t){
  $('wxs').hidden=!runCond;
  if(!runCond)return;
  const c=wxAt(runCond.w,runCond.start+t*1000),felt=c.wind*(SHELTER[runCond.shelter]??0.55),h=view.headings();
  const rel=Math.cos((c.dir-h.travel)*Math.PI/180),kind=felt<0.4?'calm':rel>0.4?'head':rel<-0.4?'tail':'cross';
  $('wxarr').style.transform=`rotate(${(c.dir+180-h.view+360)%360}deg)`;$('wxarr').style.visibility=kind==='calm'?'hidden':'visible';
  $('wxspd').textContent=`${Math.round(mph(felt))} mph`;
  $('wxkind').textContent={calm:'calm',head:'head',tail:'tail',cross:'cross'}[kind];$('wxkind').className=kind;
}

// Your pace tile and line: red slower / green on / gold faster than the pacer's pace where you are,
// by more than the band; a change has to hold for 1.2 s so it doesn't flicker
const STATUS_COL={slow:'#ef4444',on:'#22c55e',fast:'#facc15'};
let stat=null,statCand=null,statSince=0;
function setStatus(s){
  const n=Date.now();
  if(s!==statCand){statCand=s;statSince=n}
  if(statCand!==stat&&(stat==null||s==null||n-statSince>=1200))stat=statCand;
  $('youtile').className='tile you '+(stat||'');
}

// Course strip: the whole route's elevation coloured by gradient, the part run dimmed, you (white)
// and the pacer (orange)
function drawCourse(p){
  const W=1000,D=p.total,lo=Math.min(...p.es),span=Math.max(Math.max(...p.es)-lo,15);
  const X=d=>(d/D*W).toFixed(1),Y=e=>(39-(e-lo)/span*33).toFixed(1);
  let s='';
  for(let i=0;i<p.d.length-1;i++){const c=gradeColor(p.grade[i]);s+=`<polygon points="${X(p.d[i])},40 ${X(p.d[i])},${Y(p.es[i])} ${X(p.d[i+1])},${Y(p.es[i+1])} ${X(p.d[i+1])},40" fill="${c}" stroke="${c}" stroke-width="1" vector-effect="non-scaling-stroke"/>`}
  s+=`<rect id="cdone" x="0" y="0" height="40" width="0" fill="#020617" fill-opacity=".6"/>`+
    `<line id="cpacer" y1="0" y2="40" stroke="#fb923c" stroke-width="3" vector-effect="non-scaling-stroke"/>`+
    `<line id="crival" y1="0" y2="40" stroke="#c084fc" stroke-width="3" vector-effect="non-scaling-stroke"/>`+
    `<line id="cyou" y1="0" y2="40" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  $('course').innerHTML=s;
}
function courseMarks(you,pacer,rv=null){
  const x=d=>(Math.max(0,Math.min(runP.total,d))/runP.total*1000).toFixed(1);
  $('cdone').setAttribute('width',x(you));$('crival').style.display=rv==null?'none':'';
  for(const [id,d] of [['cyou',you],['cpacer',pacer],['crival',rv??0]]){$(id).setAttribute('x1',x(d));$(id).setAttribute('x2',x(d))}
}

// Recording: your time, distance, live and average pace, and splits; the voice reads each km
function hudRecord(){
  const t=el()/1000,avg=rd>50?t/(rd/1000):null;
  $('tm').textContent=fmt(t);$('km').textContent=kmStr(rd);$('proj').textContent=fmtP(avg);$('projd').textContent='';$('wxs').hidden=true;
  splits(t);
  $('ypace').textContent=fmtP(curPace);$('ystate').textContent='live';$('youtile').className='tile you rec';
  $('ppace').textContent=fmtP(avg);$('pstate').textContent=`${kmStr(rd)} km so far`;
  $('gap').hidden=phase!=='idle';$('gap').className='gap';$('gap').textContent=mode==='free'?'Freestyle':'Recording a new route';
  if(rsplits.length>spokenSplits){
    spokenSplits=rsplits.length;const k=spokenSplits,sp=(rsplits[k-1]-(rsplits[k-2]||0))/1000;
    if(voiceOn())speaker.say(`Kilometre ${k}. ${fmt(sp)}. Average ${fmtP(avg)}.`,2,'split');
  }
}

// Splits table: every completed km for you and the pacer, then the km in progress (live, faint)
let splitsShown=-1;
function splits(t){
  const n=rsplits.length,k0=n*1000,live=yd-k0>50&&phase!=='idle',racing=mode==='race'&&runP&&course;
  const pcAt=a=>racing&&(lineAt==null||a<=course.ran(runP.total))?course.pacerAtRan(a):null;
  const rows=[];
  for(let k=0;k<n;k++){
    const you=(rsplits[k]-(rsplits[k-1]||0))/1000,p1=pcAt((k+1)*1000),pc=p1!=null?p1-pcAt(k*1000):null;
    rows.push(`<tr><td>${k+1}</td><td class="y ${pc&&you<pc-1?'faster':pc&&you>pc+1?'slower':''}">${fmt(you)}</td><td class="p">${pc?fmt(pc):''}</td></tr>`);
  }
  // The km in progress: average pace so far for you and the pacer over the same stretch; it becomes the
  // km's split time (the same number for a full km) when the km is done
  if(live){
    const p1=pcAt(yd),you=(t-(rsplits.at(-1)||0)/1000)/((yd-k0)/1000),pc=p1!=null?(p1-pcAt(k0))/((yd-k0)/1000):null;
    rows.push(`<tr class="live"><td>${n+1}</td><td class="y ${pc&&you<pc-1?'faster':pc&&you>pc+1?'slower':''}">${fmtP(you)}</td><td class="p">${pc?fmtP(pc):''}</td></tr>`);
  }
  $('spl').innerHTML=rows.join('')||'<tr class="wait"><td colspan="3">Splits appear as you go</td></tr>';
  if(n!==splitsShown){splitsShown=n;const w=document.querySelector('.splw');w.scrollTop=w.scrollHeight}
}

// ---- Heads-up numbers, turn card, gap ----
// ---- Cadence and stride ----
// Ask for motion (from a tap) and start counting steps; if refused or not available, the row stays hidden
function motionOn(){
  const go=()=>{motion.start(onStep);$('mstrip').hidden=false;if(!$('run').hidden)layout()};
  if(motion.available===true)go();
  else if(motion.available==null)motion.request().then(ok=>{if(ok)go()});
}
function onStep(ago=0){
  if(phase!=='running')return; // steps while paused don't count
  const t=(el()-ago)/1000;if(t<0)return;if(!steps.length)motionFrom=t;
  let i=steps.length;while(i&&steps[i-1]>t)i--;steps.splice(i,0,t); // in time order, even if late
  stepN++;while(steps.length&&steps[0]<t-60)steps.shift();
}
// Every 5 s: cadence over the last 15 s; stride = distance ÷ steps over the last 30 s
function motionHud(){
  if($('mstrip').hidden)return;
  const t=el()/1000;
  if(phase!=='running'){if(phase==='idle'){cadNow=strNow=null;$('cad').textContent=$('strd').textContent='--'}return}
  if(t-motionT<UPDATE_MS/1000)return;motionT=t;
  // Windows end 2 s back, so steps still being detected (or delivered late) don't count short
  const e=t-2;cadNow=cadenceAt(steps,e,motionFrom);
  const w=STRIDE_MS/1000,from=e-w,n=steps.filter(x=>x>from&&x<=e).length;
  strNow=dhist.length&&dhist[0][0]<=from+2?strideOf(n,distBack(e)-distBack(from)):null;
  $('cad').textContent=cadNow?Math.round(cadNow):'--';$('strd').textContent=strNow?strNow.toFixed(2):'--';
  // Against the guide here: your cadence low (amber) / high (blue); stride long when cadence is low
  const tg=runCad&&rd>20?planAt(runCad,rd):null;
  $('cadt').textContent=tg?` / ${Math.round(tg.cad)}`:'';$('strdt').textContent=tg?` / ${tg.stride.toFixed(2)}`:'';
  const off=tg&&cadNow?cadNow/tg.cad-1:0;
  $('cad').className=off<-0.03?'low':off>0.04?'high':'';$('strd').className=off<-0.03&&strNow&&strNow>tg.stride*1.03?'long':'';
  // Cadence well below the guide for 15 s: a nudge, at most every 3 minutes
  lowCount=off<-0.05?lowCount+1:0;
  if(lowCount>=3&&t-driftAt>180&&voiceOn()){driftAt=t;lowCount=0;const sg=runSigns.filter(x=>x.d<=rd).at(-1);
    speaker.say(`Cadence ${Math.round(cadNow)}. ${sg?.kind==='up'?'Shorter, quicker steps up here.':sg?.kind==='down'?'Quicker, lighter steps. Don\'t reach out in front.':'Quicken your steps a little, keep them light.'}`,1)}
}
// Route distance at run time ts (s), from the last minute of fixes
function distBack(ts){
  let a=dhist[0];for(const b of dhist){if(b[0]>=ts)return a[0]===b[0]?b[1]:a[1]+(b[1]-a[1])*(ts-a[0])/(b[0]-a[0]);a=b}
  return a[1];
}

// Spoken technique tip as you reach each climb and descent, and the flat after a steep one (at most one a
// minute); the opening one as you set off
function cadTips(){
  if(!runSigns.length||phase!=='running'||!voiceOn())return;
  while(signI<runSigns.length&&runSigns[signI].d1<rd)signI++;
  const sg=runSigns[signI];if(!sg||rd<Math.max(sg.d,40))return;
  const first=signI===0,prev=runSigns[signI-1];signI++;
  if(!first&&sg.kind==='flat'&&!prev?.steep)return;
  const t=el()/1000;if(t-tipAt<60)return;tipAt=t;speaker.say(cadenceTip(sg,first),1);
}

function hud(){
  motionHud();cadTips();
  if(phase==='rest'&&sess)return restHud();
  if(mode!=='race'&&!$('run').hidden)return hudRecord();
  if($('run').hidden||!runP)return;
  const t=el()/1000,D=runP.total,started=phase==='running'||phase==='paused';
  $('tm').textContent=fmt(t);$('km').textContent=kmStr(yd);$('togo').textContent=kmStr(Math.max(0,lineAt!=null?D-yd:D-rd));
  splits(t);
  if(started&&rd>20){
    gapNow=fullAt!=null?runP.finish-fullAt/1000:lineAt!=null?course.pacerT(D)-lineAt/1000:course.pacerT(rd)-t;$('gap').hidden=true;
    stripWeather(t);
    // The glance tiles: your live pace (coloured against the pacer's pace where you are), the pacer's
    // live pace, and the gap (+ you're ahead)
    const target=paceAt(runP,rd);
    $('ypace').textContent=fmtP(curPace);$('ystate').textContent=`target ${fmtP(target)}`;
    const pdNow=course.pacerD(t);$('ppace').textContent=fmtP(paceAt(runP,pdNow));
    $('pstate').textContent=`${Math.round(Math.abs(pdNow-rd))} m ${pdNow>=rd?'ahead':'behind'}`;
    rivalHud(t);
    setStatus(curPace?(curPace>target+o.band?'slow':curPace<target-o.band?'fast':'on'):null);

    // Projected finish: how you're doing against the pacer's hill-aware plan, applied to what's left
    const proj=projectFinish(runP,rd,t,timeOneKmBack(),course.pacerT,planBack());
    if(sess){$('projl').textContent=`Rep ${sess.i+1}/${sess.reps.length}`}
    if(lineAt!=null){$('proj').textContent=fullAt!=null?fmt(fullAt/1000):'–';$('projd').textContent=fullAt!=null?'full distance':'';$('projd').className=''}
    if(proj&&lineAt==null){const dlt=proj-course.pacerT(D);$('proj').textContent=fmt(proj);$('projd').textContent=Math.abs(dlt)<0.5?'on target':`${dlt<0?'−':'+'}${gapFmt(Math.abs(dlt))}`;$('projd').className=dlt<-0.5?'ahead':dlt>0.5?'behind':''}
    $('cv').setAttribute('aria-label',`Gap to the pacer ${gapText(gapNow)} seconds`);
  }else{
    gapNow=started?0:null;$('gap').hidden=false;
    $('ypace').textContent=$('ppace').textContent='--:--';$('ystate').textContent=$('pstate').textContent='';setStatus(null);
    $('proj').textContent=fmt(runP.finish);$('projd').textContent='target';$('projd').className='';
    $('gap').className='gap';$('gap').textContent=phase==='armed'?`${Who()} waiting at the start`:started?'And you\'re off…':`${Who()} ready at the start`;
  }
  // Next turn
  const nt=nextTurn(runTurns,rd),left=(nt?nt.d:D)-rd;
  $('ticon').innerHTML=turnIcon(nt);$('ttext').textContent=nt?turnText(nt):'Finish';
  let dist=inDist(Math.max(0,left));
  if(nt?.kind==='uturn'&&dist==='now'&&!uturnHere(nt))dist='in 20 m'; // "now" only when you're physically at the turnaround
  $('tdist').textContent=dist;$('turn').className=left<=60?'soon':'';
  if(phase==='running'&&voiceOn()&&coach&&rd>0&&lineAt==null&&!offRoute)speaker.play(coach.update({rd,t,gap:gapNow??0,cur:curPace,splits:rsplits.map(x=>x/1000),
    proj:projectFinish(runP,rd,t,timeOneKmBack(),course.pacerT,planBack())}));
}
setInterval(hud,250);

function turnIcon(t){
  const S='fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
  if(!t)return `<path d="M15 44V6" ${S}/><path d="M15 8h22l-5 7 5 7H15" fill="currentColor"/>`;
  if(t.kind==='uturn'){const s=t.dir==='left'?1:-1,x1=24+7*s,x2=24-7*s;return `<path d="M${x1} 44V20a7 7 0 0 ${s===1?0:1} ${-14*s} 0v6" ${S}/><path d="M${x2-7} 25l7 10 7-10z" fill="currentColor"/>`}
  const r=t.angle*Math.PI/180,sx=Math.sin(r),cy=Math.cos(r),ex=24+13*sx,ey=24-13*cy,tx=24+23*sx,ty=24-23*cy,px=7*cy,py=7*sx;
  return `<path d="M24 45V24L${ex.toFixed(1)} ${ey.toFixed(1)}" ${S}/><path d="M${tx.toFixed(1)} ${ty.toFixed(1)}L${(ex+px).toFixed(1)} ${(ey+py).toFixed(1)}L${(ex-px).toFixed(1)} ${(ey-py).toFixed(1)}z" fill="currentColor"/>`;
}

// =====================================================================================
// Result and history
// =====================================================================================
let shownRun=null;
// The pacer a saved run raced: a profile pacer (with its conditions) or the ghost of a past run
// (r.adjust: plan changes made during a run, from an earlier version)
const pacerFor=r=>(r.adjust||[]).reduce((p,a)=>adjustPacer(p,a.rd,a.k),r.ghost?ghostFromTimes(r.route.pts,[...r.ghost.time]):buildPacer(r.route.pts,r.finish,r.prof,{cond:r.cond}));
// You against the pacer over the same ground: the full distance if you made it up after a shortened
// course, the finish line of the shortened course, where you went freestyle, or where you stopped
function compare(r){
  if(r.mode==='intervals'){const R=r.reps||[],you=R.reduce((a,x)=>a+x.time,0),pacer=R.reduce((a,x)=>a+x.pacer,0);return {Pr:null,you,pacer,d:R.reduce((a,x)=>a+x.dist,0),diff:you-pacer,intervals:true}}
  if(r.mode==='record')return {Pr:null,you:r.elapsed/1000,pacer:null,d:r.rd||r.dist||0,diff:0,record:true};
  const Pr=pacerFor(r),C=createCourse(Pr,r.course||{});let you,d,pacer,kind;
  if(r.freestyle){kind='free';d=r.freestyle.rd;you=r.freestyle.t/1000;pacer=C.pacerT(d)}
  else if(r.fullAt){kind='full';d=Pr.total;you=r.fullAt/1000;pacer=Pr.finish}
  else if(r.lineAt){kind='short';d=Pr.total;you=r.lineAt/1000;pacer=C.pacerT(d)}
  else{d=r.complete?Pr.total:r.rd;you=r.elapsed/1000;pacer=C.pacerT(d)}
  // …and the past run raced alongside the pacer, over the same ground
  let rv=null;
  if(r.rival){const Rp=ghostFromTimes(r.route.pts,[...r.rival.time]),C2=createCourse(Rp,r.course||{});rv=kind==='full'?Rp.finish:C2.pacerT(d)}
  return {Pr,C,you,pacer,d,diff:you-pacer,kind,ran:r.yd??C.ran(r.rd||0),rv};
}
// Was this your quickest complete run on its route?
const raceTime=x=>x.fullAt?x.fullAt:x.lineAt??x.elapsed;
const fairRun=x=>x.status==='done'&&x.mode!=='intervals'&&x.complete&&!cutShort(x)&&!x.freestyle&&mine(x);
const isBest=r=>fairRun(r)&&!!r.route&&!allRuns.some(x=>x!==r&&x.id!==r.id&&fairRun(x)&&x.route?.id===r.route.id&&raceTime(x)<=raceTime(r));
// …and not your first time on it
const beatBefore=r=>isBest(r)&&allRuns.some(x=>x.id!==r.id&&fairRun(x)&&x.route?.id===r.route.id&&x.started<r.started);
// How a finished race-mode run went, by what it was for: {icon, title, short, cls}
function verdict(r,c=compare(r)){
  const a=Math.abs(c.diff),by=gapFmt(a),w=r.ghost?(r.ghost.who?`${r.ghost.who}'s run`:`your ${shortDate(r.ghost.started)} run`):'the pacer',pu=!r.ghost&&r.purpose,pct=c.pacer?c.diff/c.pacer*100:0;
  // a run from before purposes: an easy or long one by how hard it was isn't a defeat by the pacer
  if(!pu&&!r.ghost&&['easy','long'].includes(kindOf(r)))return {icon:'🌿',title:`${KINDS[kindOf(r)].name} run`,short:`${KINDS[kindOf(r)].name} run · ${fmt(c.you/(c.d/1000||1))}/km`,cls:''};
  if(pu==='easy')return pct>=-2?{icon:'🌿',title:'Easy run, nicely controlled',short:`Easy · ${a<0.5?'level with':c.diff<0?`${by} up on`:`${by} behind`} the easy pacer`,cls:'win'}
    :{icon:'🌿',title:'Too quick for an easy day',short:`Easy · ${by} quicker than planned`,cls:'lose',tip:'Easy days are what make the hard days count: next time, let the easy pacer set the pace.'};
  if(pu==='tempo')return Math.abs(pct)<=1.5?{icon:'🔥',title:'Tempo nailed',short:`Tempo · within ${by} of the plan`,cls:'win'}
    :c.diff<0?{icon:'🔥',title:`Tempo: ${by} quicker than planned`,short:`Tempo · ${by} quicker than planned`,cls:'win'}:{icon:'🔥',title:`Tempo: ${by} off the plan`,short:`Tempo · ${by} off the plan`,cls:'lose'};
  if(a<0.5)return {icon:'🤝',title:'Dead heat!',short:`Dead heat with ${w}`,cls:'win'};
  return c.diff<0?{icon:isBest(r)?'🏆':'✅',title:`You beat ${w} by ${by}`,short:`Beat ${w} by ${by}`,cls:'win'}:{icon:'🏃',title:`${cap(w)} won by ${by}`,short:`${cap(w)} won by ${by}`,cls:'lose'};
}
function showResult(r){
  resultFresh=false;
  shownRun=r;document.querySelector('.rbig').classList.remove('three');$('ragain').hidden=false;$('ragain').textContent='Run this again';$('rrvbox').hidden=true;if(r.mode==='intervals')return showIntervalResult(r);$('rrace').hidden=r.mode!=='record';$('rpcbox').hidden=r.mode==='record';
  if(r.mode==='record')return showRecordResult(r);
  const c=compare(r),pr=r.prof?.id==='me'?{name:'Like you'}:PROFILES.find(p=>p.id===r.prof?.id),w=r.ghost?(r.ghost.who?`${r.ghost.who}'s run`:`your ${shortDate(r.ghost.started)} run`):'the pacer',W=w[0].toUpperCase()+w.slice(1);
  $('rpclab').textContent=r.ghost?'Past run':'Pacer';
  const a=Math.abs(c.diff),by=gapFmt(a);
  if(!r.complete){$('rbadge').textContent='📍';$('rtitle').textContent='Run saved';$('rsub').textContent=c.kind==='free'?`Freestyle from ${kmStr(r.freestyle.yd)} km · ${c.diff<=0?`${by} ahead of`:`${by} behind`} ${w} up to then`:`${kmStr(c.ran)} of ${kmStr(c.Pr.total)} km · ${c.diff<=0?`${by} ahead of`:`${by} behind`} ${w} there`}
  else{const v=verdict(r,c);$('rbadge').textContent=v.icon;$('rtitle').textContent=v.title;$('rsub').textContent=v.tip||'';
    // a new best on a course you've run before comes first
    if(beatBefore(r)){$('rbadge').textContent='🏆';$('rtitle').textContent=`New best here: ${fmt(c.you)}`;$('rsub').textContent=v.title+($('rsub').textContent?' · '+$('rsub').textContent:'')}}
  // What happened on the course
  const notes=[];
  if(c.C.skipped>30)notes.push(`${Math.round(c.C.skipped/10)*10} m of the course was cut off, and the ${r.ghost?'past run':'pacer'} skipped it too`);
  if(c.C.extra>30)notes.push(`${Math.round(c.C.extra/10)*10} m extra off the course`);
  if(c.kind==='short')notes.push(`finish line at ${kmStr(c.C.ran(c.Pr.total))} km`);
  if(c.kind==='full')notes.push(`full ${kmStr(c.Pr.total)} km in ${fmt(c.you)}, ${kmStr(c.ran)} km in all`);
  if(notes.length)$('rsub').textContent=notes.join(' · ')+($('rsub').textContent?' · '+$('rsub').textContent:'');
  $('rsub').textContent+=`${$('rsub').textContent?' · ':''}${r.route.name} · ${r.ghost?'raced a past run':`${r.purpose&&r.purpose!=='race'?PURPOSES[r.purpose].name.toLowerCase()+' · ':''}${pr?pr.name:'Custom'} pacer`}${r.sim?' · simulated':''}`;
  $('ryou').textContent=fmt(c.you);$('rpacer').textContent=fmt(c.pacer);
  $('rrvbox').hidden=c.rv==null;document.querySelector('.rbig').classList.toggle('three',c.rv!=null);
  if(c.rv!=null){const g=c.you-c.rv,w=r.rival.who?`${r.rival.who}'s run`:r.rival.imported?'the imported run':`your ${shortDate(r.rival.started)} run`;$('rrival').textContent=fmt(c.rv);$('rrvlab').textContent=r.rival.who||r.rival.imported||cap(w);
    $('rsub').textContent=`${Math.abs(g)<0.5?`Level with ${w}`:g<0?`${gapFmt(-g)} quicker than ${w}`:`${gapFmt(g)} slower than ${w}`} · `+$('rsub').textContent}
  // Km by km: your split vs the pacer's for the same km
  // Km by km of what you ran; the pacer's time for the same stretch of course, while there is one
  const last=c.ran||c.d,km=kmMotionOf(r,last),mv=km.some(k=>k.cad);
  const cmpTo=c.kind==='free'?r.freestyle.yd:c.kind==='full'||c.kind==='short'?c.C.ran(c.Pr.total):last;
  let rows=`<tr><th>Km</th><th>You</th><th>Pacer</th><th>±</th>${mv?'<th>Cad</th><th>Stride</th>':''}</tr>`;
  const sp=r.rsplits||[];
  for(let k=0;k*1000<last-1;k++){
    const a0=k*1000,a1=Math.min((k+1)*1000,last),you=k<sp.length?(sp[k]-(sp[k-1]||0))/1000:(r.elapsed-(sp.at(-1)||0))/1000;
    const pc=a1<=cmpTo+5?c.C.pacerAtRan(a1)-c.C.pacerAtRan(a0):null,dd=pc!=null?you-pc:0;
    rows+=`<tr><td>${k+1}${a1-a0<999?` <small>(${kmStr(a1-a0)})</small>`:''}</td><td>${fmt(you)}</td><td>${pc!=null?fmt(pc):'–'}</td><td class="${pc==null?'':dd<-0.5?'faster':dd>0.5?'slower':''}">${pc==null?'':`${dd<-0.5?'−':dd>0.5?'+':''}${gapFmt(Math.abs(dd))}`}</td>${mv?motionCells(km[k]):''}</tr>`;
  }
  $('rkm').innerHTML=rows;
  motionReport(r,km,last);resultExtras(r);
  show('result');
}
function showIntervalResult(r){
  $('rrace').hidden=true;$('rpcbox').hidden=false;$('rmcard').hidden=true;$('rpclab').textContent='Target';
  const c=compare(r),R=r.reps||[],S=r.session||{},a=Math.abs(c.diff);
  resultExtras(r);$('rbadge').textContent=r.complete?'⏱️':'📍';
  $('rtitle').textContent=r.complete?`${R.length} × ${S.kind==='split'?kmStr(S.slen):kmStr(S.len)} km done`:`${R.length} of ${S.n} reps`;
  $('rsub').textContent=`${a<1?'On target':c.diff<0?`${gapFmt(a)} under target`:`${gapFmt(a)} over target`} over all the reps · ${restTxt(S.rest||0)} rest · ${r.route.name}${r.sim?' · simulated':''}`;
  $('ryou').textContent=fmt(c.you);$('rpacer').textContent=fmt(c.pacer);
  const hasLast=R.some(x=>x.last!=null);
  if(r.rival)$('rsub').textContent+=` · raced your ${shortDate(r.rival.started)} session`;
  $('rkm').innerHTML=`<tr><th>Rep</th><th></th><th>Time</th><th>Target</th><th>±</th>${hasLast?'<th>Last</th>':''}<th>Pace</th></tr>`+R.map(x=>{const dd=x.time-x.pacer;
    return `<tr><td>${x.i+1}</td><td><small>${x.grade>0.4?'↑':x.grade<-0.4?'↓':'→'}${x.grade>0?'+':''}${x.grade}%</small></td><td>${fmt(x.time)}${x.done?'':' <small>(stopped)</small>'}</td><td>${fmt(x.pacer)}</td><td class="${dd<-0.5?'faster':dd>0.5?'slower':''}">${dd<-0.5?'−':dd>0.5?'+':''}${gapFmt(Math.abs(dd))}</td>${hasLast?`<td>${x.last!=null?fmt(x.last):'–'}</td>`:''}<td>${fmt(x.time/(x.dist/1000||1))}</td></tr>`}).join('');
  show('result');
}
function showRecordResult(r){
  $('ragain').hidden=!r.imported;$('rrace').hidden=!!r.imported;$('ragain').textContent='Race this run';
  const D=r.rd||0,t=r.elapsed/1000;
  if(r.imported){
    $('rbadge').textContent='📥';$('rtitle').textContent='Run imported';
    $('rsub').textContent=`${r.imported.name} · ${when(r.started)} · ${kmStr(r.yd||D)} km · ${fmt(t)} · ${fmt(t/((r.yd||D)/1000))}/km${r.imported.paused>5000?` · ${fmt(r.imported.paused/1000)} stopped, not counted`:''}. Race it on its own, or alongside a pacer.`;
  }else{
  $('rbadge').textContent='🗺️';$('rtitle').textContent='Route saved';
  $('rsub').textContent=`${r.route.name} · ${kmStr(D)} km · ${fmt(t)} · ${fmt(t/(D/1000))}/km${r.sim?' · simulated':''}. Race it any time, against a pacer or this run.`;
  }
  $('ryou').textContent=fmt(t);
  const km=kmMotionOf(r,D),mv=km.some(k=>k.cad);
  let rows=`<tr><th>Km</th><th>You</th><th>Pace</th>${mv?'<th>Cad</th><th>Stride</th>':''}</tr>`;const sp=r.rsplits||[];
  for(let k=0;k*1000<D-1;k++){const a1=Math.min((k+1)*1000,D),len=a1-k*1000,you=k<sp.length?(sp[k]-(sp[k-1]||0))/1000:(r.elapsed-(sp.at(-1)||0))/1000;
    rows+=`<tr><td>${k+1}${len<999?` <small>(${kmStr(len)})</small>`:''}</td><td>${fmt(you)}</td><td>${fmt(you/(len/1000))}</td>${mv?motionCells(km[k]):''}</tr>`}
  $('rkm').innerHTML=rows;motionReport(r,km,D);resultExtras(r);show('result');
}
// Per km: pace, cadence, stride and climb, for the table, chart and insight
function kmMotionOf(r,D){
  const sp=(r.rsplits||[]).map(x=>x/1000),km=kmMotion(sp,r.stepSplits||[],r.elapsed/1000,r.steps||0,D),pts=r.route?.pts;
  const Pr=r.mode==='record'||!r.route?null:pacerFor(r),C=Pr&&createCourse(Pr,r.course||{}); // the plan (over the course as run), to allow for terrain
  // (an imported run has cadence at each point instead of step counts: average those per km)
  if(!km.some(k=>k.cad)&&r.fixes?.some(f=>f[8]))km.forEach((k,i)=>{
    const fs=r.fixes.filter(f=>f[6]>=i*1000&&f[6]<(i+1)*1000&&f[8]),st=fs.filter(f=>f[9]),avg=(a,j)=>a.reduce((x,f)=>x+f[j],0)/a.length;
    if(fs.length){k.cad=avg(fs,8);k.stride=st.length?avg(st,9):null}
  });
  return km.map((k,i)=>{
    const t0=i?sp[i-1]:0,t1=i<sp.length?sp[i]:r.elapsed/1000,len=Math.min(1000,D-i*1000);
    const ref=C&&!(r.freestyle&&i*1000>=r.freestyle.yd)?(C.pacerAtRan(i*1000+len)-C.pacerAtRan(i*1000))/(len/1000):null;
    let climb=0;if(pts)for(let j=i*100+1;j<=Math.min(pts.length-1,i*100+len/10);j++)climb+=Math.max(0,(pts[j].ele??0)-(pts[j-1].ele??0));
    return {...k,pace:(t1-t0)/(len/1000),climb,ref};
  });
}
const motionCells=k=>`<td>${k?.cad?Math.round(k.cad):'–'}</td><td>${k?.stride?k.stride.toFixed(2):'–'}</td>`;
// Report: your pace, cadence and stride along the run (sharing the distance axis), and what they say
function motionReport(r,km,D){
  const F=(r.fixes||[]).filter(f=>f[8]!=null||f[9]!=null);
  $('rmcard').hidden=F.length<5;if($('rmcard').hidden)return;
  // Average each 100 m
  const bins=[];for(const f of r.fixes){const b=Math.floor(f[6]/100);(bins[b]??=[]).push(f)}
  const avg=(fs,i)=>{const v=fs.map(f=>f[i]).filter(x=>x!=null&&x>0);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null};
  const pts=bins.map((fs,b)=>fs&&{d:b*100+50,pace:avg(fs,7),cad:avg(fs,8),str:avg(fs,9)}).filter(Boolean);
  const W=1000,L=70,R=980,X=d=>(L+(d/D)*(R-L)).toFixed(1);
  const lanes=[
    {key:'pace',name:'Pace',col:'#60a5fa',y0:20,fmtv:v=>fmt(v),inv:true},
    {key:'cad',name:'Cadence',col:'#a78bfa',y0:190,fmtv:v=>Math.round(v)},
    {key:'str',name:'Stride',col:'#34d399',y0:360,fmtv:v=>v.toFixed(2)},
  ];
  let g='';
  for(const ln of lanes){
    const v=pts.map(p=>p[ln.key]).filter(x=>x!=null);
    g+=`<text x="${L}" y="${ln.y0-4}" fill="${ln.col}" font-size="26" font-weight="800">${ln.name}</text>`;
    if(v.length<2){g+=`<text x="${L+150}" y="${ln.y0-4}" fill="#64748b" font-size="22">no data</text>`;continue}
    let lo=Math.min(...v),hi=Math.max(...v);const pad=Math.max((hi-lo)*0.1,ln.key==='str'?0.03:ln.key==='cad'?2:5);lo-=pad;hi+=pad;
    const Y=x=>(ln.y0+12+(ln.inv?(x-lo)/(hi-lo):(hi-x)/(hi-lo))*120).toFixed(1);
    g+=`<rect x="${L}" y="${ln.y0+8}" width="${R-L}" height="128" fill="#0f172a" rx="8"/>`;
    for(const x of [lo+pad,hi-pad])g+=`<text x="${L-8}" y="${(+Y(x)+8).toFixed(1)}" fill="#94a3b8" font-size="20" text-anchor="end">${ln.fmtv(x)}</text>`;
    let path='',on=false;
    for(const p of pts){const x=p[ln.key];if(x==null){on=false;continue}path+=`${on?'L':'M'}${X(p.d)} ${Y(x)} `;on=true}
    g+=`<path d="${path}" fill="none" stroke="${ln.col}" stroke-width="3.5" stroke-linejoin="round"/>`;
  }
  for(let k=1000;k<D;k+=1000)g+=`<line x1="${X(k)}" x2="${X(k)}" y1="20" y2="500" stroke="#fff" stroke-opacity=".08"/>`;
  const step=D>15000?5000:D>6000?2000:1000;
  for(let k=0;k<=D;k+=step)g+=`<text x="${X(k)}" y="530" fill="#94a3b8" font-size="22" text-anchor="middle">${k/1000} km</text>`;
  $('rchart').innerHTML=g;
  const notes=motionInsight(km);
  $('rmotion').innerHTML=notes?notes.map(n=>`<p>${esc(n.text)}</p>`).join(''):'';
}
// CSV: every recorded point
$('rcsv').onclick=()=>{
  const r=shownRun,name=`pacer-${new Date(r.started).toISOString().slice(0,16).replace(/[:T]/g,'-')}.csv`,iso=ms=>new Date(ms).toISOString();
  const csv='time,elapsed_s,lat,lon,accuracy_m,gps_distance_m,route_distance_m,pace_s_per_km,cadence_spm,stride_m,distance_run_m\n'+
    r.fixes.map(f=>[iso(f[0]),(f[1]/1000).toFixed(1),f[2].toFixed(7),f[3].toFixed(7),Math.round(f[4]),Math.round(f[5]),Math.round(f[6]),f[7]!=null?Math.round(f[7]):'',f[8]??'',f[9]??'',f[10]??Math.round(f[6])].join(',')).join('\n')+'\n';
  deliver(name,'text/csv',csv);
};
// Run this again: the same course (all of it, the same part, or the same interval session), with this run
// as the past run to race, alongside the pacer you had (its target and profile)
$('ragain').onclick=()=>{
  const r=shownRun,id=String(r.route?.id??''),m=id.match(/^(\d+)(?::p(\d+))?$/),b=m&&routes.find(x=>x.id===+m[1]);
  if(!b)return alert('That route is no longer saved.');
  if(r.mode==='intervals'){opt.set('how:'+b.id,'int');opt.set('int:'+b.id,{...r.session});opt.set('introv:'+b.id,r.id)}
  else{
    const course=m[2]?`${b.id}:p${m[2]}`:String(b.id);
    opt.set('how:'+b.id,m[2]?'part':'full');if(m[2])opt.set('part:'+b.id,+m[2]);
    const pu=r.mode!=='record'&&!r.ghost&&r.purpose?r.purpose:'race';opt.set('purpose:'+course,pu);
    if(r.mode!=='record'&&!r.ghost&&r.finish){opt.set(finKey(course,pu),Math.round(r.finish));if(r.prof)setProfQuiet(r.prof)}
    if(r.imported)opt.set(finKey(course,'race'),Math.round(r.elapsed/1000)); // an imported run: a pacer on the same time, alongside it
    opt.set('pcmode:'+course,r.imported?'both':r.mode==='record'||r.ghost?'ghost':'both');opt.set('ghost:'+course,r.id);
  }
  show('home');selectRoute(b);openSetup(r.mode==='intervals'?'intcard':'vscard');
};
$('rrace').onclick=()=>{const r=routes.find(x=>x.id===shownRun.route.id);show('home');if(r){selectRoute(r);openSetup()}refreshHistory()};
// Done: a run you've just finished goes back to Today, where this week's plan ticks it off; one you were
// looking back at returns to where you were
let resultFresh=false,planJust=false;
function doneResult(){const fresh=resultFresh;resultFresh=false;show('home');if(fresh){planJust=true;tab('today');setTimeout(()=>{planJust=false},2500)}
  refreshHistory().then(()=>{if(fresh&&!$('plancard').hidden)setTimeout(()=>$('plancard').scrollIntoView({behavior:'smooth',block:'center'}),150)})}
$('rdone').onclick=()=>doneResult();
$('rgpx').onclick=()=>{
  const r=shownRun,name=`pacer-${new Date(r.started).toISOString().slice(0,16).replace(/[:T]/g,'-')}.gpx`;
  if(!r.route)return;
  const iso=ms=>new Date(ms).toISOString();
  const gpx=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pacer" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(r.route.name)}</name><time>${iso(r.started)}</time></metadata>\n<trk><name>${esc(r.route.name)}</name><type>running</type><trkseg>\n`+
    r.fixes.map(f=>`<trkpt lat="${f[2].toFixed(7)}" lon="${f[3].toFixed(7)}"><time>${iso(f[0])}</time></trkpt>`).join('\n')+'\n</trkseg></trk>\n</gpx>\n';
  deliver(name,'application/gpx+xml',gpx);
};
async function deliver(name,type,text){
  const file=new File([text],name,{type});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return}catch(e){if(e.name==='AbortError')return}}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}

let pending=null;
async function refreshHistory(){
  const all=(await listRuns()).sort((a,b)=>b.started-a.started);allRuns=all;if(route&&!$('home').hidden)rebuild();storageStatus();
  pending=all.find(r=>r.status==='active'&&r!==rec&&r.id!==rec?.id)||null;
  const done=all.filter(r=>r.status==='done'),own=done.filter(mine);
  $('noruns').hidden=done.length>0;
  let mo='';
  $('runtotals').textContent=own.length?`${own.length} run${own.length>1?'s':''} · ${Math.round(own.reduce((a,r)=>a+(r.yd??r.rd??0),0)/1000)} km`:'';
  renderVolume(own);
  const list=done.filter(r=>{const k=kindOf(r);return runFilter==='all'||(runFilter==='race'?k==='race':runFilter==='work'?k==='tempo'||k==='int':k==='easy'||k==='long')});
  $('runs').innerHTML=list.map(r=>{
    const c=compare(r),k=kindOf(r);
    const res=c.intervals?`${(r.reps||[]).length} of ${r.session?.n??'?'} reps · ${Math.abs(c.diff)<1?'on target':c.diff<0?`${gapFmt(-c.diff)} under target`:`${gapFmt(c.diff)} over target`} in all`:c.record?`${r.imported?.who?`${esc(r.imported.who)}'s run`:r.imported?`imported: ${esc(r.imported.name)}`:'recorded this route'} · ${fmt(c.you/(c.d/1000||1))}/km`:r.complete?(beatBefore(r)?'🏆 New best · ':'')+verdict(r,c).short:`stopped at ${kmStr(c.d)} km`;
    const m=new Date(r.started).toLocaleDateString(undefined,{month:'long',year:'numeric'}),head=m!==mo?`<li class="mo">${mo=m}</li>`:'';
    const v=r.complete&&!c.record&&!c.intervals?verdict(r,c):null,win=v?v.cls:'';
    const ic=c.intervals?'⏱️':r.imported?.who?'⚔️':r.imported?'📥':c.record?'🗺️':!r.complete?'📍':beatBefore(r)||isBest(r)&&v.cls==='win'?'🏆':v.icon;
    const tag=k!=='friend'?`<span class="ktag" style="--k:${KCOL[k]}">${KINDS[k].name}</span>`:'';
    return `${head}<li class="run" data-k="${k}"><button class="sel" data-id="${r.id}"><span class="ric ${win}">${ic}</span><span class="rtx"><b>${tag}${r.sim?'SIM · ':''}${esc(r.route?.name||'Recording')}</b><span class="meta">${when(r.started)} · ${fmt(c.you)}${c.d?` · ${kmStr(c.d)} km`:''}</span><span class="meta ${win}">${res}</span></span></button><button class="del" data-id="${r.id}" aria-label="Delete run">✕</button></li>`;
  }).join('')||(done.length?'<li class="empty">No runs of this kind yet.</li>':'');
  $('runs').querySelectorAll('.sel').forEach(b=>b.onclick=()=>showResult(done.find(r=>r.id===+b.dataset.id)));
  $('runs').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this run?'))return;await deleteRun(+b.dataset.id);refreshHistory()});
  if(pending){const ago=Math.round((Date.now()-pending.saved)/60000);$('rsinfo').textContent=`${pending.route?.name||'Recording a new route'} · ${kmStr(pending.rd||0)} km · ${fmt((pending.elapsed||0)/1000)} · last saved ${ago<1?'just now':ago+' min ago'}`}
  $('resume').hidden=!pending;$('rsgo').hidden=pending?.mode==='intervals'; // (a session can be saved, not resumed)
  renderRoutes();renderToday();if(curTab==='insights')renderIns();
}
$('rssave').onclick=async()=>{const r=pending;if(!r)return;r.status='done';r.running=false;r.complete=false;await saveRun(r);refreshHistory()};
$('rsdel').onclick=async()=>{if(!pending||!confirm('Discard this unfinished run?'))return;await deleteRun(pending.id);refreshHistory()};
$('rsgo').onclick=()=>{
  speaker.unlock();motionOn();
  const r=pending;if(!r)return;$('resume').hidden=true;
  if(r.mode==='record'){
    enterRecord();
    trail=r.fixes.map(f=>({lat:f[2],lon:f[3],p:f[7]}));
  }else{
    enterRun(r.route,pacerFor(r),turnsFor(r.route),r.cond||null,r.prof,r.ghost?{id:r.ghost.runId,started:r.ghost.started,imported:r.ghost.who?{who:r.ghost.who}:null}:null);
  }
  rec=r;rd=r.rd||0;yd=r.yd??rd;rsplits=[...(r.rsplits||[])];stepN=r.steps||0;stepSplits=[...(r.stepSplits||[])];track.dist=r.dist||0;matcher?.seed(rd,track.dist);
  if(r.mode!=='record'&&runP){course=createCourse(runP,r.course||{});lineAt=r.lineAt??null;fullAt=r.fullAt??null;line=r.line??null;if(r.freestyle){goFree(true);freeYd0=yd;freeG0=track.dist;rd=yd}}shownD=rd;spokenSplits=rsplits.length;
  sim.jump=rd;
  const gap=(Date.now()-r.saved)*SPEED,last=r.fixes.at(-1);
  if(r.running&&gap<RESUME_GAP){acc=r.elapsed+gap;start(now());if(last)track.last={lat:last[2],lon:last[3],t:last[0]}}
  else{acc=r.elapsed;phase='paused';setPhaseUI()}
};

// =====================================================================================
// Keeping your routes and runs safe: ask iOS to keep storage, back up / restore, a reminder
// =====================================================================================
async function storageStatus(){
  let kept=false;
  try{kept=await navigator.storage?.persisted?.();if(!kept)kept=await navigator.storage?.persist?.()}catch(e){}
  const last=opt.get('lastBackup',null),n=allRuns.filter(r=>r.status==='done').length;
  $('st-status').textContent=`${kept?'Kept permanently on this phone ✓':'Stored on this phone; iOS could clear it if space runs low'} · ${last?`last backup ${new Date(last).toLocaleDateString()}`:'never backed up'}`;
  const due=n>0&&(!last||Date.now()-last>14*864e5);
  $('bkbanner').hidden=!due;
  if(due)$('bktext').textContent=`Your ${n} run${n>1?'s':''} and ${routes.length} route${routes.length>1?'s':''} are only on this phone. Save a backup to Files or iCloud Drive in case it's lost or reset.`;
}
async function backup(){
  const data={app:'pacer',version:1,exported:Date.now(),routes:await listRoutes(),runs:await listRuns(),options:{}};
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('pacer:')&&k!=='pacer:lastBackup')data.options[k]=localStorage.getItem(k)}}catch(e){}
  await deliver(`pacer-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json',JSON.stringify(data));
  opt.set('lastBackup',Date.now());storageStatus();
}
$('bk').onclick=$('bknow').onclick=()=>backup();
// Restore adds what isn't already here (matched by when it was created), so restoring twice is harmless
$('rsfile').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const d=JSON.parse(await f.text());if(d?.app!=='pacer')throw new Error("that isn't a Pacer backup");
    const haveR=await listRoutes(),haveRuns=await listRuns(),ids={};let nr=0,nu=0;
    for(const r of d.routes||[]){const same=haveR.find(x=>x.created===r.created&&x.name===r.name);if(same){ids[r.id]=same.id;continue}const {id,...rest}=r;ids[id]=await saveRoute(rest);nr++}
    for(const r of d.runs||[]){if(haveRuns.some(x=>x.started===r.started&&x.route?.name===r.route?.name&&!!x.imported?.who===!!r.imported?.who&&Math.abs((x.elapsed||0)-(r.elapsed||0))<2000))continue;const {id,...rest}=r;if(rest.route&&ids[rest.route.id]!=null)rest.route={...rest.route,id:ids[rest.route.id]};await saveRun(rest);nu++}
    if(d.options&&Object.keys(d.options).length&&confirm('Also restore your settings from the backup?'))for(const [k,v] of Object.entries(d.options))try{localStorage.setItem(k,v)}catch(err){}
    alert(`Restored ${nr} route${nr===1?'':'s'} and ${nu} run${nu===1?'':'s'}.`);location.reload();
  }catch(err){alert('Could not restore: '+err.message)}
};

// =====================================================================================
// v3: tabs, sheets, Today, Insights, sharing and challenges
// =====================================================================================
const TABS=['today','plan','routes','insights','runs'];
let curTab=opt.get('tab','today');
function tab(t){
  if(!TABS.includes(t))t='today';curTab=t;opt.set('tab',t);
  for(const x of TABS)$('tab-'+x).hidden=x!==t;
  document.querySelectorAll('#tabbar button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  scrollTo(0,0);if(t==='insights')renderIns();if(t==='plan')renderPlanView();
}
document.querySelectorAll('#tabbar button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
// Sheets slide over the tabs: race setup and settings
const sheetOpen=id=>{closeSheets();$(id).hidden=false;$(id).scrollTop=0;$(id).style.transform='';document.documentElement.style.overflow='hidden';syncNav()};
function openSetup(focus){if(!base)return tab('routes');sheetOpen('setup');if(focus)requestAnimationFrame(()=>{const e=$(focus);if(e&&!e.hidden)$('setup').scrollTo({top:e.offsetTop-70,behavior:'smooth'})})}
function closeSheets(){$('setup').hidden=$('settings').hidden=$('addmenu').hidden=$('progsheet').hidden=true;document.documentElement.style.overflow='';syncNav()}
// The + menu: the less everyday ways to run (race your best, intervals, another route, record, import)
function openMenu(){$('addmenu').hidden=false;$('addmenu').querySelector('.menubox').style.transform='';syncNav()}
function closeMenu(){$('addmenu').hidden=true;syncNav()}
$('addbtn').onclick=()=>openMenu();$('mclose').onclick=()=>closeMenu();
$('addmenu').onclick=e=>{if(e.target===$('addmenu'))closeMenu()};
// The phone's back (Android's back gesture, a browser's back button): everything over Today (a sheet, the
// menu, a result, the run screen) is one step in the history, so back closes it instead of leaving the
// app. A run in progress can't be backed out of: pause it first.
const layerOpen=()=>!$('addmenu').hidden||!$('settings').hidden||!$('setup').hidden||!$('progsheet').hidden||!$('result').hidden||!$('run').hidden;
let popSkip=false;
if(history.state?.pacer)history.replaceState(null,''); // (reloaded with a sheet open: nothing's open now)
function syncNav(){
  if(popSkip)return;
  const open=layerOpen(),mark=!!history.state?.pacer;
  if(open&&!mark)history.pushState({pacer:1},'');
  else if(!open&&mark){popSkip=true;history.back()}
}
addEventListener('popstate',()=>{
  if(popSkip){popSkip=false;syncNav();return}
  if(!$('addmenu').hidden)closeMenu();
  else if(!$('settings').hidden||!$('setup').hidden||!$('progsheet').hidden){closeSheets();renderToday()}
  else if(!$('result').hidden)doneResult();
  else if(!$('run').hidden&&(phase==='idle'||phase==='paused'||phase==='done'))$('back').onclick();
  setTimeout(syncNav,0);
});
// Swipe a sheet (from its top) or the menu down to close it
function swipeClose(el,box,close){
  let y0=null,dy=0;
  el.addEventListener('touchstart',e=>{y0=el.scrollTop<=0?e.touches[0].clientY:null;dy=0},{passive:true});
  el.addEventListener('touchmove',e=>{if(y0==null)return;dy=e.touches[0].clientY-y0;if(dy<=0){box.style.transform='';return}
    e.preventDefault();box.style.transition='none';box.style.transform=`translateY(${dy}px)`},{passive:false});
  el.addEventListener('touchend',()=>{if(y0==null)return;y0=null;box.style.transition='';
    if(dy>110){box.style.transform='translateY(100%)';setTimeout(()=>{box.style.transform='';close()},180)}else box.style.transform=''});
}
swipeClose($('setup'),$('setup'),()=>{closeSheets();renderToday()});swipeClose($('progsheet'),$('progsheet'),()=>closeSheets());swipeClose($('settings'),$('settings'),()=>closeSheets());
swipeClose($('addmenu'),$('addmenu').querySelector('.menubox'),()=>closeMenu());
$('setupback').onclick=()=>{closeSheets();renderToday()};
$('gear').onclick=()=>sheetOpen('settings');
$('setback').onclick=()=>closeSheets();
$('hchange').onclick=()=>tab('routes');
$('hsetup').onclick=()=>openSetup();
$('qgo').onclick=()=>{speaker.unlock();$('race').onclick()};
if(!SIM){const h=new Date().getHours(),n=opt.get('me:name','');$('hello').textContent=`${h<12?'Good morning':h<18?'Good afternoon':'Good evening'}${n?', '+n:''}`}

// Quick actions (Today, and the welcome card)
function act(a){
  if(!$('addmenu').hidden)closeMenu();
  if(a==='routes')return tab('routes');
  if(a==='gpx')return $('gpx').click();
  if(a==='rec')return enterRecord();
  if(!base)return tab('routes');
  if(a==='int'){opt.set('how:'+base.id,'int');deriveRoute();rebuild();return openSetup('intcard')}
  if(a==='best'){
    opt.set('how:'+base.id,'full');deriveRoute();const g=pastRuns(route);
    if(!g.length)return alert('Run this route once (or import a run of it) and you can race yourself on it.');
    const b=g.find(x=>mine(x.run))||g[0];opt.set('pcmode:'+route.id,'ghost');opt.set('ghost:'+route.id,b.run.id);rebuild();openSetup('vscard');
  }
}
document.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act));

// What you learned from your runs (worked out again only when the runs change)
let insA=null,insFor=null;
function getA(){
  if(insFor!==allRuns){insFor=allRuns;try{insA=analyseRuns(allRuns.filter(r=>SIM||!r.sim))}catch(e){console.error(e);insA={ready:false,runs:0,need:1,km:0}}}
  return insA;
}
let bestC=null,bestFor=null;
const getBests=()=>{if(bestFor!==allRuns){bestFor=allRuns;bestC=bestsOf(allRuns.filter(r=>SIM||!r.sim))}return bestC};
function renderIns(){
  renderInsights($('insights'),getA(),{meOn:prof.id==='me',onMe:on=>{const me=learnedProfile(getA());setProf(on&&me?profOf(me):profOf(PROFILES[0]));renderIns()},
    bests:getBests(),sessions:sessionProgress(allRuns.filter(r=>SIM||!r.sim)),onRun:id=>{const r=allRuns.find(x=>x.id===id);if(r)showResult(r)}});
}
// What kind of run: race, tempo, easy, long (learned from how hard it was, or what you set it as), intervals;
// a friend's run is theirs
const kindOf=r=>!mine(r)?'friend':r.mode==='intervals'?'int':getA().kindOf?.get(r.id)??(r.purpose==='race'||r.purpose==='tempo'?r.purpose:(r.yd??r.rd??0)>=14000?'long':'easy');
let runFilter='all';
$('rfilter').querySelectorAll('button').forEach(b=>b.onclick=()=>{runFilter=b.dataset.v;$('rfilter').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));refreshHistory()});
// The last 12 weeks: km a week, stacked by kind of run
function renderVolume(own){
  const W=7*864e5,d0=new Date();d0.setHours(0,0,0,0);d0.setDate(d0.getDate()-((d0.getDay()+6)%7)); // this Monday
  const start=d0.getTime()-11*W,wk=Array.from({length:12},()=>({}));
  for(const r of own.filter(r=>SIM||!r.sim)){const i=Math.floor((r.started-start)/W);if(i<0||i>11)continue;const k=kindOf(r);wk[i][k]=(wk[i][k]||0)+(r.yd??r.rd??0)/1000}
  const tot=wk.map(x=>Object.values(x).reduce((a,b)=>a+b,0)),mx=Math.max(1,...tot),act=tot.filter(x=>x>0);
  $('volcard').hidden=!act.length;if(!act.length)return;
  const order=['easy','long','tempo','int','race'],avg=act.reduce((a,b)=>a+b,0)/act.length,used=order.filter(k=>wk.some(x=>x[k]));
  $('volcard').innerHTML=`<div class="wk-top"><div class="h">Last 12 weeks</div></div><div class="wk-num"><div><b>${tot[11].toFixed(1)}</b><span>km this week</span></div><div><b>${avg.toFixed(1)}</b><span>km a week, average</span></div><div><b>${Math.round(tot.reduce((a,b)=>a+b,0))}</b><span>km in all</span></div></div>`+
    `<div class="vbars">${wk.map((x,i)=>`<div class="${i===11?'now':''}"><span class="stk" style="height:${tot[i]/mx*100}%">${order.filter(k=>x[k]).map(k=>`<i style="flex:${x[k]};background:${KCOL[k]}"></i>`).join('')}</span><small>${i===11?'now':i%3===2?new Date(start+i*W).toLocaleDateString(undefined,{day:'numeric',month:'short'}):''}</small></div>`).join('')}</div>`+
    `<div class="lg">${used.map(k=>`<span><i style="background:${KCOL[k]}"></i>${KINDS[k].name}</span>`).join('')}</div>`;
}

// After every change to the race: the folded sections' one-line summaries, a personal prediction, Today
function afterRebuild(){
  const pr=profList().find(p=>p.id===prof.id);
  $('sum-style').textContent=`${pr?`${pr.icon} ${pr.name}`:'Custom'} · climbs ${TRAIT_NAMES.climb[prof.climb]?.toLowerCase()??'–'}, descents ${TRAIT_NAMES.descent[prof.descent]?.toLowerCase()??'–'}`;
  const c=wx.w?wxAt(wx.w,raceStart):null,diff=P.wx?P.wx.suggested-P.target:null;
  $('sum-wx').textContent=wx.loading?'Getting the forecast…':!c?(wx.err||'No forecast'):`${Math.round(c.temp)}°C · wind ${Math.round(mph(c.wind))} mph ${compass16(c.dir)}${!o.wxOn?' · not used':diff!=null?` · ${diff>=0?'costs':'saves'} ${gapFmt(Math.abs(diff))}`:''}`;
  $('sum-plan').textContent=vsMode==='ghost'?`${fmt(P.finish)}, exactly as it was run`:`Finishes in ${fmt(P.finish)} · ${fmt(P.finish/(P.total/1000))}/km average`;
  const pu=purposeOf(),sg=vsMode==='ghost'||howOf()==='int'?null:suggest(route,pu);
  $('tgthint').innerHTML=sg?(Math.abs(sg-finishFor(route))<5?`🔮 Set from your form: about <b>${fmt(sg)}</b> ${pu==='race'?'is what you could race':pu==='tempo'?'is a tempo effort':'is easy for you'} here.`
    :`🔮 From your form, ${pu==='race'?'you could race this in':pu==='tempo'?'a tempo effort here is':'easy for you here is'} about <b>${fmt(sg)}</b>. <button class="link" id="tgtuse">Use it</button>`):'';
  if($('tgtuse'))$('tgtuse').onclick=()=>setFinish(sg);
  renderPurpose();renderGoalFold();
  renderToday();
}

// What a finished run's result was, in a few words: {text, icon, cls}
function outcome(r){
  const c=compare(r),a=Math.abs(c.diff),w=r.ghost?(r.ghost.who?`${r.ghost.who}'s run`:'your past run'):'the pacer';
  if(c.intervals)return {c,icon:'⏱️',cls:'',text:`${(r.reps||[]).length} reps · ${a<1?'on target':c.diff<0?`${gapFmt(a)} under target`:`${gapFmt(a)} over target`}`};
  if(c.record)return {c,icon:r.imported?.who?'⚔️':r.imported?'📥':'🗺️',cls:'',text:r.imported?.who?`${r.imported.who}'s challenge`:r.imported?'Imported run':'Recorded this route'};
  if(!r.complete)return {c,icon:'📍',cls:'',text:`Stopped at ${kmStr(c.d)} km`};
  const v=verdict(r,c);if(beatBefore(r))return {c,icon:'🏆',cls:'win',text:`New best here · ${v.short}`};
  return {c,icon:v.icon,cls:v.cls,text:v.short};
}

// ---- What today's run is for, on the hero and in the setup ----
function renderPurpose(){
  const pu=purposeOf(),hide=vsMode==='ghost'||howOf()==='int';
  for(const id of ['purpose','hpurpose']){$(id).hidden=hide;$(id).querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===pu);b.onclick=()=>setPurpose(b.dataset.v)})}
  $('purnote').textContent={race:'Race it: the pacer runs your target time, hills and all.',tempo:'Comfortably hard, about 8 % off race pace: the pacer keeps it honest, not a race.',
    easy:'Easy: the pacer runs your easy pace. Stay with it or let it go; the coach won\'t push you to catch it.'}[pu];
}

// ---- Your week: a suggested week of sessions (plan.js), each loaded into Pacer with a tap ----
let planSel=null;
function planInputs(){
  const d0=new Date();d0.setHours(0,0,0,0);d0.setDate(d0.getDate()-((d0.getDay()+6)%7));const monday=d0.getTime(),W=7*864e5;
  const own=allRuns.filter(r=>mine(r)&&r.status==='done'&&(SIM||!r.sim));
  // your usual week: the four weeks before this one (weeks you ran in, so a holiday doesn't drag it down)
  const prev=own.filter(r=>r.started<monday&&r.started>=monday-4*W),wks=new Set(prev.map(r=>Math.floor((monday-r.started)/W)));
  const weekKm=wks.size?prev.reduce((a,r)=>a+(r.yd??r.rd??0),0)/1000/wks.size:0;
  // runs a week: the middle of those four weeks (a light week doesn't drag it down either)
  const per=[0,1,2,3].map(k=>new Set(prev.filter(r=>Math.floor((monday-r.started)/W)===k).map(r=>new Date(r.started).toDateString())).size).filter(Boolean).sort((a,b)=>a-b);
  const n=opt.get('plan:n',null)??(per.length?Math.max(3,Math.min(6,per[Math.floor(per.length/2)])):4),longKm=Math.max(0,...prev.map(r=>(r.yd??r.rd??0)/1000));
  const A=getA(),form=A.ready?(formAt(A.per,monday)??A.form):null,g=goalOf(),gr=g&&routes.find(r=>r.id===g.route);
  return {monday,runsPerWeek:n,weekKm,longKm,form,goal:gr?{...g,D:gr.pts.at(-1).d}:null,raceFade:A.raceFade??null,own,
    routes:routes.filter(r=>!r.laps).map(r=>({id:r.id,name:r.name,D:r.pts.at(-1).d,climb:climbOf(r)}))};
}
const PICON={rest:'·',easy:'🌿',long:'🛤️',tempo:'🔥',int:'⏱️',race:'🏁'};
function planNow(){
  if(!routes.length)return null;
  const I=planInputs(),st=progState(),w=st&&st.P.weeks.find(x=>dayNum(x.monday)===dayNum(I.monday));
  const p=w&&dayNum(st.pg.raceDate)>=dayNum(Date.now())?{phase:w.phase,prog:true,km:w.days.reduce((a,s)=>a+(s.km||0),0),
      title:`${PHASES[w.phase].name} · week ${st.P.weeks.indexOf(w)+1} of ${st.P.weeks.length} · ${DIST[st.pg.dist].name}`,days:w.days.map(s=>progDay(s,st))}:weekPlan(I);
  const today=Math.floor((Date.now()-I.monday)/864e5);
  const ranToday=I.own.some(r=>dayNum(r.started)===dayNum(Date.now()));
  return {I,p,today,ranToday,did:p.prog?w.days.map(s=>st.did[s.key]||[]):p.days.map(d=>I.own.filter(r=>r.started>=d.date&&r.started<d.date+864e5))};
}
// Load today's planned session into the Today card, once a day and only if you haven't run yet
function autoLoad(pl){
  const td=pl.p.days[pl.today],key=new Date().toDateString();
  if(!td?.route||td.kind==='rest'||pl.ranToday||pl.did[pl.today].length||opt.get('plan:auto',null)===key)return false;
  opt.set('plan:auto',key);loadSession(td,true);return true;
}
function renderPlan(pl){
  $('plancard').hidden=!pl;if(!pl)return;
  const {I,p,today,did}=pl;
  if(planSel===today)planSel=null; // today is the big card above
  const doneKm=did.flat().reduce((a,r)=>a+(r.yd??r.rd??0),0)/1000,d=planSel!=null?p.days[planSel]:null,ran=d?did[planSel]:[];
  const col=x=>x.kind==='rest'?'#475569':x.rehearse?'#f472b6':KCOL[x.kind];
  const strip=p.days.map((x,i)=>{const st=did[i].length?'done':i<today?(x.kind!=='rest'?'missed':'past'):i===today?'today':'';
    return `<button class="pd ${st} ${i===planSel?'sel':''} ${i===today&&planJust&&did[i].length?'just':''}" data-i="${i}" style="--k:${col(x)}"><small>${DOW[i]}</small><i>${did[i].length?'✓':x.pkind?TICON[x.pkind]:x.rehearse?'🎯':PICON[x.kind]}</i><span>${x.km?Math.round(x.km)+'k':''}</span></button>`}).join('');
  let body='';
  if(d){
  const where=d.route?`${esc(d.route.name)}${d.how==='part'?` · first ${kmStr(d.len)} km`:''}`:'';
  body=`<div class="pl-h"><span class="ktag" style="--k:${col(d)}">${d.title}</span><small>${new Date(d.date).toLocaleDateString(undefined,{weekday:'long'})}</small><button class="link pl-x" id="plx">Close</button></div>`+
    (d.kind!=='rest'?`<b class="pl-what">${esc(d.what||d.title)}</b>${where&&!d.rehearse&&!d.goalRace?`<small class="pl-where">${where}</small>`:''}`:'')+`<p class="pl-why">${esc(d.why)}</p>`;
  if(ran.length){const r=ran[0],u=r.status==='done'?outcome(r):null;body+=`<button class="pl-done" id="pldone">✓ Done: ${esc(r.route?.name||'Run')} · ${kmStr(r.yd??r.rd??0)} km · ${fmt((r.elapsed||0)/1000)}${u?` · ${esc(u.text)}`:''}<i class="chev"></i></button>`}
  else if(d.route&&planSel>=today)body+=`<button class="btn go" id="plgo">Run it now instead</button>`;
  }
  $('plancard').innerHTML=`<div class="pl-top"><div><div class="eyebrow">Your week</div><b>${esc(p.title)}</b></div><div class="pl-km"><b>${doneKm.toFixed(0)}</b><span>of ${Math.round(p.km)} km</span></div></div>`+
    `<div class="pl-bar"><i style="width:${Math.min(100,doneKm/Math.max(1,p.km)*100)}%"></i></div><div class="pdays">${strip}</div>${body?`<div class="pl-d">${body}</div>`:''}`+
    (p.prog?`<button class="link pl-more" id="plopen">The whole plan →</button>`:`<div class="pl-n"><span>Runs a week</span><div class="seg">${[3,4,5,6].map(k=>`<button data-n="${k}" class="${k===I.runsPerWeek?'on':''}">${k}</button>`).join('')}</div></div><button class="link pl-more" id="plbuild">Training for a race? Build a plan →</button>`);
  $('plancard').querySelectorAll('.pd').forEach(b=>b.onclick=()=>{const i=+b.dataset.i;
    if(i===today&&!did[i].length){planSel=null;renderPlan(planNow());$('hero').scrollIntoView({behavior:'smooth',block:'start'});return}
    planSel=planSel===i?null:i;renderPlan(planNow())});
  if($('plx'))$('plx').onclick=()=>{planSel=null;renderPlan(planNow())};
  $('plancard').querySelectorAll('.pl-n button').forEach(b=>b.onclick=()=>{opt.set('plan:n',+b.dataset.n);renderToday()});
  if($('plgo'))$('plgo').onclick=()=>loadSession(d);
  if($('plopen'))$('plopen').onclick=()=>tab('plan');if($('plbuild'))$('plbuild').onclick=()=>openBuilder();
  if($('pldone'))$('pldone').onclick=()=>showResult(ran[0]);
}
// Load a planned session into Pacer: the route, how to run it, what it's for and its target
function loadSession(d,quiet){
  const b=routes.find(x=>x.id===d.route.id);if(!b)return;
  if(d.how==='int'){opt.set('how:'+b.id,'int');const {pace,...c}=d.int;opt.set('int:'+b.id,pace?{...c,pace}:c)}
  else{
    opt.set('how:'+b.id,d.how==='part'?'part':'full');if(d.how==='part')opt.set('part:'+b.id,d.len);
    const cid=d.how==='part'?`${b.id}:p${d.len}`:b.id,pu=d.purpose||'race',g=goalOf();
    opt.set('purpose:'+cid,pu);opt.set('pcmode:'+cid,'profile');
    // racing your best: your quickest own run there alongside the pacer
    if(d.vsBest){const best=runsOn(b).filter(mine)[0];if(best){opt.set('pcmode:'+cid,'both');opt.set('ghost:'+cid,best.id)}}
    // a course test races your last one alongside the pacer
    if(d.vsRun&&allRuns.some(x=>x.id===d.vsRun)){opt.set('pcmode:'+cid,'both');opt.set('ghost:'+cid,d.vsRun)}
    // a rehearsal runs the start of the goal race exactly as the goal-race pacer would; the race, the goal
    let t=null;if(d.rehearse&&g)t=Math.round(timeAt(buildPacer(b.pts,g.time,prof),d.len));if(d.goalRace&&g)t=g.time;if(d.target)t=d.target;
    opt.set(finKey(cid,pu),t);
  }
  opt.set('prog:pending',d.prog?{key:d.key,kind:d.pkind,test:d.pkind==='test',routeId:b.id,day:new Date().toDateString()}:null);
  // what Today's card now holds (a session from another day says which)
  const dn=d.date?new Date(d.date).toLocaleDateString(undefined,{weekday:'long'}):null;
  opt.set('hero:loaded',{routeId:b.id,day:new Date().toDateString(),title:d.title,why:d.why,dow:d.date&&new Date(d.date).toDateString()!==new Date().toDateString()?dn:null});
  planSel=null;selectRoute(b);if(quiet)return;renderToday();requestAnimationFrame(()=>$('hero').scrollIntoView({behavior:'smooth',block:'start'}));
}

// =====================================================================================
// Training plans, the Norwegian way (training.js builds them, venues.js says where, training-ui.js draws them)
// =====================================================================================
const progCfg=()=>opt.get('program',null);
let progC=null,progKey=null;
// The plan as it stands today: your fitness (the last course test, nudged by how sessions felt, or a race
// that says you're fitter), the programme with where to run each session, which run did which session,
// your load, the coach's notes
function progState(){
  const pg=progCfg();if(!pg)return null;
  const key=JSON.stringify(pg)+'|'+new Date().toDateString()+'|'+routes.length;
  if(progC&&progKey===key&&progC.runs===allRuns)return progC;
  const A=getA(),now=Date.now(),own=allRuns.filter(r=>mine(r)&&r.status==='done'&&r.started>=pg.start-6*3600e3&&(SIM||!r.sim));
  const course=pg.route?routes.find(r=>r.id===pg.route)||null:null;
  const cfg={...pg,course:!!course,courseD:course?.pts.at(-1).d,courseName:course?.name,firstTest:pg.firstTest??null};
  const tests=own.filter(r=>r.prog?.test&&(r.yd??r.rd??0)>=1500).map(r=>{const x=A.per?.find(y=>y.run.id===r.id),d=x?x.dist:(r.yd??r.rd),t=x?x.fp*x.dist/1000:r.elapsed/1000;return {t:r.started,v:vdotOf(d,t),run:r}}).sort((a,b)=>a.t-b.t);
  const lastT=tests.at(-1),since=lastT?.t??pg.start;let v=lastT?lastT.v:pg.base.v;
  // the schedule as planned says which session each run was
  const sesAt=new Map(programme(cfg,{vdot:v}).weeks.flatMap(w=>w.days).map(s=>[dayNum(s.date),s]));
  const kindOfRun=r=>r.prog?.kind??(()=>{const s=sesAt.get(dayNum(r.started));return s&&s.kind!=='rest'?s.kind:r.mode==='intervals'?'sub':({race:'race',tempo:'sub',long:'long',int:'hills'})[kindOf(r)]??'easy'})();
  const fb=own.filter(r=>r.feel).map(r=>({t:r.started,kind:kindOfRun(r),feel:r.feel})),ad=adapt(fb,{since,now});
  const raceV=Math.max(0,...(A.per||[]).filter(x=>x.kind==='race'&&x.run.started>since&&mine(x.run)&&!x.run.prog?.test).map(x=>vdotOf(10000,x.eq*10)));
  let raced=false;if(raceV>v+ad.dv+0.5){v=raceV;raced=true}else v+=ad.dv;
  const P=programme(cfg,{vdot:v,easyAdj:ad.easyAdj,fatigue:ad.fatigue,pain:ad.pain,now});
  // where to run each session
  const R=routes.filter(r=>!r.laps&&r!==course),RV=course?[...R,course]:R;
  // (a route you chose for a session wins: anything but the course tests can be run anywhere)
  for(const s of P.weeks.flatMap(w=>w.days))if(s.venue&&s.kind!=='rest'){
    const pick=opt.get('prog:route:'+s.key,null),pr=pick!=null&&s.kind!=='test'?routes.find(r=>r.id===pick):null;
    const vr=pr?venueFor(s.venue,s,[pr],pr===course?course:null):venueFor(s.venue,s,RV,course);
    if(vr){s.vres=vr;s.where=vr.note;s.anywhere=vr.anywhere;s.whereRoute=vr.route.id;s.chosen=!!pr;s.routeOpts=s.kind==='test'?null:RV.map(r=>({id:r.id,name:r.name}))}}
  // which run did which session: one started from a session is that session, whatever the day; others go by date
  const did={},keys=new Set(P.weeks.flatMap(w=>w.days.map(s=>s.key)));
  for(const r of own)if(r.prog?.key&&keys.has(r.prog.key))(did[r.prog.key]??=[]).push(r);
  for(const w of P.weeks)for(const s of w.days){const rs=own.filter(r=>!(r.prog?.key&&keys.has(r.prog.key))&&dayNum(r.started)===dayNum(s.date));if(rs.length)(did[s.key]??=[]).push(...rs)}
  const today=dayNum(now);let wk=P.weeks.findIndex(w=>dayNum(w.monday)<=today&&today<dayNum(w.monday)+7);
  if(wk<0)wk=today<dayNum(P.weeks[0].monday)?0:P.weeks.length-1;
  const loadRuns=allRuns.filter(r=>mine(r)&&r.status==='done'&&now-r.started<60*864e5&&(SIM||!r.sim)).map(r=>({t:r.started,min:(r.elapsed||0)/60000,rpe:r.feel?.rpe??(TKINDS[kindOfRun(r)]?.rpe?.[1]||4)}));
  // the course: its profile and climbs, and your predicted time on it
  const me=learnedProfile(getA()),hp=me?profOf(me):prof;
  let cinfo=null,coursePred=null;
  if(course){
    const pts=course.pts,D=pts.at(-1).d,es=pts.map(p=>p.ele??0),lo=Math.min(...es),span=Math.max(Math.max(...es)-lo,15),X=d=>(d/D*300).toFixed(1),Y=e=>(44-(e-lo)/span*38).toFixed(1);
    let svg='';for(let i=0;i<pts.length-1;i+=2){const j=Math.min(pts.length-1,i+2),g=pts[j].d>pts[i].d?((pts[j].ele??0)-(pts[i].ele??0))/(pts[j].d-pts[i].d)*100:0,c=gradeColor(g);svg+=`<polygon points="${X(pts[i].d)},44 ${X(pts[i].d)},${Y(es[i])} ${X(pts[j].d)},${Y(es[j])} ${X(pts[j].d)},44" fill="${c}" stroke="${c}" stroke-width=".6"/>`}
    cinfo={id:course.id,name:course.name,D,climb:climbOf(course),climbs:climbs(course),svg:`<svg viewBox="0 0 300 44" preserveAspectRatio="none">${svg}</svg>`};
    if(D<=10500)coursePred=effortTime(pts,vdotTime(v,DIST[pg.dist].d)/(DIST[pg.dist].d/1000),hp);
  }
  // what the coach has to say
  const notes=[],all=P.weeks.flatMap(w=>w.days);
  if(ad.pain)notes.push('🩹 You noted pain, so today and tomorrow are rest. If it\'s still there on an easy run, stop and get it looked at before any hard running.');
  const sw=all.find(s=>s.adapted==='tired');if(sw&&!ad.pain)notes.push(`😮‍💨 Heavy legs and low energy lately: <b>${esc(sw.swapped)}</b> on ${DOW[sw.i]} is now an easy run.`);
  if(raced)notes.push(`🏁 A recent race says you're fitter than your plan thought: paces updated to VDOT ${v.toFixed(1)}.`);
  else if(ad.dv>=0.3)notes.push(`📈 Sessions have felt easier than planned, so your paces are a little quicker (+${ad.dv.toFixed(1)} VDOT).`);
  else if(ad.dv<=-0.3)notes.push(`🧭 Sessions have felt harder than planned, so your paces are eased a little (${ad.dv.toFixed(1)} VDOT). In the Norwegian method that's exactly right: controlled beats heroic.`);
  if(ad.easyAdj>1)notes.push(`🌿 Easy runs have been feeling hard: easy pace eased to ${fmt(P.paces.easy)}/km.`);
  if(!tests.length&&!all.some(s=>s.kind==='test'))notes.push('🧪 No course test in the plan (no first test day set): your paces come from your recent runs.');
  const nt=all.find(s=>s.kind==='test'&&dayNum(s.date)>=today&&!did[s.key]);if(nt)notes.push(`🧪 Next course test: <b>${new Date(nt.date).toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})}</b>${course&&nt.vres?.route===course?`, the full ${esc(course.name)}`:''}.`);
  const missed=all.filter(s=>s.hard&&dayNum(s.date)<today&&dayNum(s.date)>=today-7&&!did[s.key]).length;
  if(missed>=2)notes.push('📅 Missed a couple of sessions? Don\'t try to catch up: just pick up from today.');
  progC={runs:allRuns,pg,P,pc:P.paces,vdot:v,v0:pg.base.v,adj:ad.dv,ad,tests,did,today,wk,kindOfRun,load:loadOf(loadRuns,now),notes,course:cinfo,coursePred,hp};progKey=key;
  return progC;
}
// A plan session as a day on Today and something Pacer can run: the route and how (from venues.js), what
// it's for, and the target (the session's flat pace with the hills taken the way you take them)
function progDay(s,st){
  const day={...s,kind:TKINDS[s.kind].fam,pkind:s.kind,prog:true},v=s.vres;
  if(s.kind==='rest'||!v)return day;
  const r=routes.find(x=>x.id===v.route.id)||v.route,RP={id:r.id,name:r.name,D:r.pts.at(-1).d};
  if(v.how==='int')return {...day,route:RP,how:'int',int:{kind:'repeat',from:v.from,len:v.len,reps:s.reps,dir:v.dir,slen:1000,rest:Math.round(s.hill?Math.max(s.rest,v.len/1000*st.pc.easy):s.rest),pace:Math.round(s.pace),step:0}};
  const pts=v.how==='part'?slice(r.pts,0,v.len):r.pts,pu=['test','race','rehearsal'].includes(s.kind)?'race':'easy';
  const goal=s.kind==='race'&&st.pg.goalTime&&v.how==='full'&&Math.abs(RP.D-DIST[st.pg.dist].d)<400;
  const lastTest=s.kind==='test'?st.tests.filter(t=>t.run.route?.id===r.id&&!t.run.route?.part).at(-1):null;
  return {...day,route:RP,how:v.how,len:v.how==='part'?v.len:RP.D,purpose:pu,target:Math.round(goal?st.pg.goalTime:effortTime(pts,s.pace,st.hp)),vsRun:lastTest?.run.id??null};
}
// ---- The Plan tab ----
let pgOpen=null,pgWeek=null;
function renderPlanView(){
  const el=$('progview'),st=progState();
  if(!st)return renderPlanIntro(el,{},{onNew:()=>openBuilder()});
  if(dayNum(Date.now())>dayNum(st.pg.raceDate)+1){ // race day has been
    const pg=st.pg,D=DIST[pg.dist],run=allRuns.filter(r=>mine(r)&&r.status==='done'&&Math.abs(dayNum(r.started)-dayNum(pg.raceDate))<=1&&(r.yd??r.rd??0)>=D.d*0.95).sort((a,b)=>raceTime0(a)-raceTime0(b))[0];
    const t=run&&raceTime0(run),km=Object.values(st.did).flat().reduce((a,r)=>a+(r.yd??r.rd??0)/1000,0);
    return renderPlanIntro(el,{finished:{name:st.course?.name||D.name,time:t,
      line:t?(pg.goalTime?(t<=pg.goalTime?`Goal smashed by ${gapFmt(pg.goalTime-t)} 🎉`:`${gapFmt(t-pg.goalTime)} off your ${fmt(pg.goalTime)} goal`):'Race done 🎉'):'',
      sum:`${st.P.weeks.length} weeks · ${Math.round(km)} km of training · fitness ${st.v0.toFixed(1)} → ${st.vdot.toFixed(1)} VDOT.`}},{onNew:()=>{opt.set('program',null);openBuilder()}});
  }
  renderPlanTab(el,{...st,dayNum,feelOf:r=>r.feel,open:pgOpen,openWeek:pgWeek},{
    onToggle:k=>{pgOpen=pgOpen===k?null:k;renderPlanView()},
    onRoute:(k,id)=>{opt.set('prog:route:'+k,id);progKey=null;renderPlanView();renderToday()},
    onWeek:i=>{pgWeek=pgWeek===i?null:i;pgOpen=null;renderPlanView()},
    onRun:s=>{tab('today');loadSession(progDay(s,st))},
    onOpenRun:id=>{const r=allRuns.find(x=>x.id===id);if(r)showResult(r)},
    onEdit:()=>openBuilder(true),
    onEnd:()=>{if(!confirm('End this training plan? Your runs stay; the plan goes.'))return;opt.set('program',null);renderPlanView();renderToday()}});
}
const raceTime0=r=>(r.fullAt??r.lineAt??r.elapsed)/1000;
// ---- The plan builder ----
let pf=null,pfErr=[],pfV=null;
const parseTime=t=>{const m=String(t||'').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);return m?(+(m[1]||0))*3600+ +m[2]*60+ +m[3]:null};
const parseDay=v=>{const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d).getTime()};
const nearestDist=D=>Object.entries(DIST).sort((a,b)=>Math.abs(a[1].d-D)-Math.abs(b[1].d-D))[0][0];
function openBuilder(edit){
  const pg=progCfg(),I=planInputs(),A=getA(),g=goalOf();
  pfV=A.ready&&A.form?vdotOf(10000,A.form*10):null;
  const sun=addDays(Date.now(),(7-new Date().getDay())%7); // this Sunday (today if it's Sunday)
  pf=edit&&pg?{dist:pg.dist,date:isoDay(pg.raceDate),route:pg.route??null,goal:pg.goalTime?fmt(pg.goalTime):'',days:pg.days,km:pg.km,longKm:pg.longKm,test:pg.firstTest?isoDay(pg.firstTest):'',edit:true}
    :{dist:g?nearestDist(routes.find(r=>r.id===g.route)?.pts.at(-1).d||10000):'10k',date:isoDay(g&&g.date>Date.now()+28*864e5?g.date:addDays(mondayOf(Date.now()),7*10+6)),route:g?.route??null,goal:'',
      days:I.runsPerWeek,km:Math.max(8,Math.round(I.weekKm||20)),longKm:Math.max(5,Math.round(I.longKm||8)),test:isoDay(sun)};
  pfErr=[];sheetOpen('progsheet');$('pfgo').textContent=edit?'Update my plan':'Build my plan';drawBuilder();
}
const pfWeeks=()=>pf.date?Math.round((dayNum(mondayOf(parseDay(pf.date)))-dayNum(mondayOf(Date.now())))/7)+1:null;
function drawBuilder(){
  const D=DIST[pf.dist],peak=Math.round(Math.max(pf.km,Math.min(D.peak*Math.max(0.7,Math.min(1.3,pf.days/5)),pf.km*1.6)));
  const c=pf.route&&routes.find(r=>r.id===pf.route),onCourse=c&&D.d<=10500;
  renderBuilder($('progform'),pf,{routes:routes.filter(r=>!r.laps).map(r=>({id:r.id,name:r.name,D:r.pts.at(-1).d})),weeks:pfWeeks(),peak,errors:pfErr,
    testNote:onCourse?`The full ${esc(c.name)}, all-out`:c?`A 5 km time trial (a full ${esc(D.name)} is too much to test with)`:'A 5 km time trial on your flattest route (choose a race course to test on it)'},(patch,quiet)=>{
    Object.assign(pf,patch);if(patch.route){const r=routes.find(x=>x.id===patch.route);if(r)pf.dist=nearestDist(r.pts.at(-1).d)}if(!quiet)drawBuilder()});
}
$('progback').onclick=()=>closeSheets();
$('pfgo').onclick=()=>{
  pfErr=[];const w=pfWeeks(),goal=pf.goal?parseTime(pf.goal):null,old=progCfg();
  if(!pf.date)pfErr.push('Choose your race day.');else if(w<4||w>30)pfErr.push('Your race needs to be between 4 and 30 weeks away.');
  if(pf.goal&&!goal)pfErr.push('That goal time doesn\'t look right: try 44:59 or 1:45:00.');
  const ft=pf.test?parseDay(pf.test)+9*3600e3:null;
  if(ft&&pf.date&&dayNum(ft)>dayNum(parseDay(pf.date))-14)pfErr.push('Your first test needs to be at least two weeks before the race.');
  if(ft&&!pf.edit&&dayNum(ft)<dayNum(Date.now()))pfErr.push('Your first test can\'t be in the past.');
  if(pf.dist==='mar'&&pf.km<25&&!pf.warned){pf.warned=true;pfErr.push('A marathon on under 25 km a week is a big step: consider a half first. Tap Build again to go ahead anyway.')}
  if(pfErr.length){drawBuilder();$('progsheet').scrollTo({top:$('progsheet').scrollHeight,behavior:'smooth'});return}
  const raceDate=parseDay(pf.date)+9*3600e3;
  const pg={start:pf.edit&&old?old.start:Date.now(),raceDate,dist:pf.dist,style:'norwegian',days:pf.days,km:pf.km,longKm:pf.longKm,firstTest:ft,goalTime:goal,route:pf.route,
    base:pf.edit&&old?old.base:{v:pfV??Math.max(30,Math.min(50,32+pf.km*0.3)),from:pfV?'runs':'estimate'}};
  opt.set('program',pg);
  const r=pf.route&&routes.find(x=>x.id===pf.route);
  if(r)opt.set('goal',{route:r.id,name:r.name,date:raceDate,time:goal??Math.round(vdotTime(pg.base.v,r.pts.at(-1).d))});
  closeSheets();tab('plan');renderToday();
};
// ---- After a run: a course test's result, and how it felt ----
function renderTestCard(r){
  const st=progState(),t=st?.tests.find(x=>x.run.id===r.id);$('rtest').hidden=!t;if(!t)return;
  const i=st.tests.indexOf(t),was=i?st.tests[i-1].v:st.v0,D=DIST[st.pg.dist],pc=st.pc,prev=i?st.tests[i-1].run:null;
  const ct=prev&&prev.route?.id===r.route?.id?prev.elapsed/1000-r.elapsed/1000:null;
  $('rtest').innerHTML=`<div class="h">🧪 Course test${st.tests.length>1?` ${i+1}`:''}</div><div class="tst"><b>${t.v.toFixed(1)}</b><span>VDOT${Math.abs(t.v-was)>=0.1?` · <em class="${t.v>was?'up':'down'}">${t.v>was?'+':''}${(t.v-was).toFixed(1)}</em> on ${i?'your last test':'the estimate'}`:''}</span></div>
    ${ct!=null?`<p class="sub">${ct>0?`<b>${gapFmt(ct)} quicker</b> on the course than your last test`:`${gapFmt(-ct)} slower than your last test: a hard day, or tired legs? The plan adjusts either way`}.</p>`:''}
    <p class="sub">About <b>${fmt(vdotTime(t.v,D.d))}</b> for a ${D.name} on the flat. Your paces for the next four weeks: easy <b>${fmt(pc.easy)}</b> · sub-threshold <b>${fmt(pc.subS)}–${fmt(pc.subL)}</b> · hills <b>${fmt(pc.hill)}</b> /km.</p>`;
}
function renderFeelCard(r){
  const ok=mine(r)&&r.status==='done'&&!r.imported?.who&&(r.fixes?.length||0)>5;$('rfeel').hidden=!ok;if(!ok)return;
  const st=progState(),kind=st?st.kindOfRun(r):r.mode==='intervals'?'sub':({race:'race',tempo:'sub',long:'long',int:'hills'})[kindOf(r)]??'easy';
  const draw=reply=>renderFeel($('rfeel'),{kind,title:TKINDS[kind]?.name,feel:r.feel||null,reply},async f=>{
    const before=progState();r.feel=f;await saveRun(r);allRuns=await listRuns();const after=progState();draw(coachReply(before,after,f,kind));
  });
  draw(null);
}
// The coach's answer to how a session felt: what (if anything) it changed
function coachReply(b,a,f,kind){
  const out=[],e=TKINDS[kind]?.rpe;
  if(f.pain)out.push('🩹 Pain noted: today and tomorrow are now rest days. If it\'s still there on an easy run, stop and get it looked at before any hard running.');
  if(a&&b){
    if(Math.abs(a.vdot-b.vdot)>=0.1)out.push(`${a.vdot>b.vdot?'📈 Easier than planned':'🧭 Harder than planned'}: your paces ${a.vdot>b.vdot?'move a little quicker':'ease a little'}. Sub-threshold is now <b>${fmt(a.pc.sub)}</b>/km (was ${fmt(b.pc.sub)}).`);
    if(a.ad.easyAdj>b.ad.easyAdj)out.push(`🌿 Easy runs have felt hard lately: easy pace eased to <b>${fmt(a.pc.easy)}</b>/km.`);
    const sw=a.P.weeks.flatMap(w=>w.days).find(s=>s.adapted==='tired'),was=sw&&b.P.weeks.flatMap(w=>w.days).find(s=>s.key===sw.key);
    if(sw&&was?.adapted!=='tired')out.push(`😮‍💨 ${esc(sw.swapped)} on ${DOW[sw.i]} becomes an easy run: your legs need it more than the session.`);
  }
  if(!out.length&&e&&e[1]){
    if(kind==='sub'&&f.rpe>=8)out.push('🌊 Sub-threshold should feel comfortably hard, not hard. If that keeps happening the plan eases your paces; next time, start the first rep a little slower.');
    else if(f.rpe>=e[0]&&f.rpe<=e[1]&&f.how==='plan')out.push(`✅ Right where ${TKINDS[kind].name.toLowerCase()} should be (${e[0]}–${e[1]} out of 10). Nothing to change.`);
    else if(['easy','recovery','long','strides','hillsprints'].includes(kind)&&f.rpe>e[1])out.push(`🌿 That's hard work for an ${kind==='long'?'easy long run':'easy run'}. Next time, slow right down: easy should be conversational.`);
    else out.push('Noted. One session doesn\'t change the plan; a pattern will.');
  }
  return out.join('<br>');
}

// ---- Goal race: a race on one of your courses to train towards ----
const goalOf=()=>opt.get('goal',null);
const isoDay=ms=>{const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};
const dayStr=ms=>new Date(ms).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'});
function renderGoalFold(){
  const g=goalOf(),here=g&&base&&g.route===base.id;
  $('dgoal').hidden=howOf()!=='full'||vsMode==='ghost';
  $('sum-goal').textContent=here?`${dayStr(g.date)} · goal ${fmt(g.time)}`:g?`Your goal now: ${g.name}`:'Set a race day to train towards';
  if(document.activeElement!==$('goaldate'))$('goaldate').value=here?isoDay(g.date):'';
  $('goalset').textContent=here?'Update my goal':'Set as my goal';$('goaldel').hidden=!here;
  $('goalnote').textContent=`Goal time: your race target, ${fmt(finishFor(base,'race'))}. Today shows how close you are, week by week.`;
}
$('goalset').onclick=()=>{
  const v=$('goaldate').value;if(!v)return alert('Choose the race day first.');
  const [y,m,d]=v.split('-').map(Number);
  opt.set('goal',{route:base.id,name:base.name,date:new Date(y,m-1,d,9).getTime(),time:finishFor(base,'race')});
  afterRebuild();
};
$('goaldel').onclick=()=>{opt.set('goal',null);afterRebuild()};
function renderGoal(){
  const g=goalOf(),r=g&&routes.find(x=>x.id===g.route);$('goalcard').hidden=!r;if(!r)return;
  const d0=new Date();d0.setHours(0,0,0,0);const gd=new Date(g.date);gd.setHours(0,0,0,0);const days=Math.round((gd-d0)/864e5);
  const open=()=>{selectRoute(r);opt.set('how:'+r.id,'full');opt.set('purpose:'+r.id,'race');deriveRoute();rebuild();openSetup()};
  if(days<-1){ // race day has been: how did it go?
    const run=allRuns.filter(x=>fairRun(x)&&x.route?.id===r.id&&Math.abs(x.started-g.date)<1.5*864e5).sort((a,b)=>raceTime(a)-raceTime(b))[0];
    const t=run&&raceTime(run)/1000,dd=t&&t-g.time;
    $('goalcard').innerHTML=`<div class="eyebrow">🎯 Goal race · ${dayStr(g.date)}</div><h3>${esc(g.name)}</h3>`+
      (run?`<div class="gl-res ${dd<=0?'win':''}"><b>${fmt(t)}</b><span>${Math.abs(dd)<1?'Bang on your goal':dd<0?`Goal smashed by ${gapFmt(-dd)} 🎉`:`${gapFmt(dd)} off your ${fmt(g.time)} goal`}</span></div>`:`<p class="sub">No run of it on the day. Import it from your watch, or set your next goal.</p>`)+
      `<div class="bt2">${run?'<button class="btn ghost" id="glrun">See the race</button>':''}<button class="btn go" id="glnew">Set your next goal</button></div>`;
    if(run)$('glrun').onclick=()=>showResult(run);
    $('glnew').onclick=()=>{opt.set('goal',null);tab('routes')};
    return;
  }
  const A=getA(),Pg=buildPacer(r.pts,g.time,prof),now=Date.now(),pred=courseTime(A,Pg)?.t??null;
  const ser=[];for(let k=11;k>=0;k--){const ct=courseTime(A,Pg,now-k*7*864e5);ser.push(ct?.t??null)}
  const v=ser.filter(x=>x!=null),gap=pred!=null?pred-g.time:null;
  let spark='';
  if(v.length>=2){
    const lo=Math.min(g.time,...v)-10,hi=Math.max(g.time,...v)+10,X=i=>(i/11*300).toFixed(1),Y=t=>(6+(t-lo)/(hi-lo)*48).toFixed(1);
    const pts=ser.map((t,i)=>t==null?null:`${X(i)},${Y(t)}`).filter(Boolean);
    spark=`<svg class="gspark" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="300" y1="${Y(g.time)}" y2="${Y(g.time)}" stroke="#4ade80" stroke-width="1.5" stroke-dasharray="5 5" vector-effect="non-scaling-stroke"/><polyline points="${pts.join(' ')}" fill="none" stroke="#fb923c" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="4" fill="#fb923c"/></svg>`;
  }
  const was=v.length?v[0]:null;
  $('goalcard').innerHTML=`<button class="goalbtn" id="glopen"><div class="eyebrow">🎯 Goal race · ${days<=0?'today':days===1?'tomorrow':`in ${days} days`}</div><h3>${esc(g.name)}</h3><small class="gdate">${dayStr(g.date)}</small>`+
    `<div class="gnums"><div><span>Goal</span><b>${fmt(g.time)}</b></div><div><span>You today</span><b>${pred!=null?'≈ '+fmt(pred):'–'}</b></div></div>`+spark+
    `<div class="gstat ${gap!=null&&gap<=0?'win':''}">${gap==null?'Run or import a few runs and Pacer predicts your time on this course.':Math.abs(gap)<3?'Right on your goal: keep it going':gap<=0?`On track ✓ about ${gapFmt(-gap)} in hand`:`${gapFmt(gap)} to find${days>0?` in ${days} days`:''}`}${was!=null&&pred!=null&&was-pred>=5?` · ${gapFmt(was-pred)} quicker than 12 weeks ago`:''}</div></button>`;
  $('glopen').onclick=open;
}

// ---- Today ----
function renderToday(){
  $('welcome').hidden=routes.length>0;
  // Today's run comes from your week's plan: loaded into the card once a day (change it freely after)
  const pl=planNow();if(pl&&autoLoad(pl))return;
  const td0=pl?.p.days[pl.today],ranToday=!!pl?.ranToday,hl=opt.get('hero:loaded',null);
  // the session you loaded into the card today (maybe another day's), else today's plan
  const td=hl&&hl.day===new Date().toDateString()&&hl.routeId===base?.id?{...hl,kind:'run',route:{id:base.id}}:td0;
  const planned=td&&td.kind!=='rest'&&td.route?.id===base?.id&&!ranToday;
  const ok=!!(base&&route&&P);$('hero').hidden=!ok;
  if(ok){
    $('hname').textContent=route.name;
    $('hero').querySelector('.eyebrow').textContent=ranToday?'Done today ✓':planned?`${td.dow||'Today'} · ${td.title}`:td?.kind==='rest'?'Rest day':
      howOf()==='int'?'Ready for the session':vsMode==='ghost'||purposeOf()==='race'?'Ready to race':`Ready for a${purposeOf()==='easy'?'n easy':' tempo'} run`;
    $('hwhy').hidden=!planned;$('hwhy').textContent=planned?td.why:'';
    $('hchips').innerHTML=[`${kmStr(P.total)} km`,`${Math.round(climbOf(route))} m climb`,`${turns.length} turn${turns.length===1?'':'s'}`].map(t=>`<span>${t}</span>`).join('');
    drawPlanMap($('hmap'));
    const lo=Math.min(...P.es),span=Math.max(Math.max(...P.es)-lo,15),X=d=>(d/P.total*300).toFixed(1),Y=e=>(40-(e-lo)/span*34).toFixed(1);let e='';
    for(let i=0;i<P.d.length-1;i+=2){const j=Math.min(P.d.length-1,i+2),cl=gradeColor(P.grade[i]);e+=`<polygon points="${X(P.d[i])},40 ${X(P.d[i])},${Y(P.es[i])} ${X(P.d[j])},${Y(P.es[j])} ${X(P.d[j])},40" fill="${cl}" stroke="${cl}" stroke-width=".6"/>`}
    $('hele').innerHTML=e;
    const cells=[],how=howOf();
    if(how==='int'){const c=intCfg(),R=intReps(c);cells.push({k:'p',l:'Session',v:`${R.length} × ${c.kind==='split'?kmStr(c.slen):kmStr(c.len)} km`,s:`${restTxt(c.rest)} rest · ${fmt(c.pace)}/km flat effort`})}
    else{
      if(vsMode!=='ghost'){const pr=profList().find(p=>p.id===prof.id);cells.push({k:'p',l:PURPOSES[purposeOf()].pacer,v:fmt(P.finish),s:`${fmt(P.finish/(P.total/1000))}/km · ${pr?pr.name:'Custom'}`})}
      const rv=ghostRun||rival?.run;
      if(rv)cells.push({k:'r',l:rv.imported?.who||(rv.imported?'Imported run':ghosts0()[0]?.run===rv?'Your best':'Past run'),v:fmt(ghostRun?P.finish:rival.time),s:when(rv.started)});
    }
    $('hvs').innerHTML=cells.map(c=>`<div class="${c.k}"><span>${esc(c.l)}</span><b>${c.v}</b><small>${esc(c.s)}</small></div>`).join('');
    const wc=wx.w?wxAt(wx.w,raceStart):null,ct=vsMode==='ghost'||how==='int'||purposeOf()!=='race'?null:courseTime(getA(),P),bits=[];
    if(wc)bits.push(`🌡 <b>${Math.round(wc.temp)}°C</b>`,`💨 <b>${Math.round(mph(wc.wind))} mph</b> ${compass16(wc.dir)}`);
    if(P.wx&&o.wxOn&&purposeOf()!=='easy'){const d=P.wx.suggested-P.target;if(Math.abs(d)>=1)bits.push(`conditions ${d>0?'cost':'save'} <b>${gapFmt(Math.abs(d))}</b>`)}
    if(ct)bits.push(`🔮 you: about <b>${fmt(ct.t)}</b>`);
    $('hwx').innerHTML=bits.map(b=>`<span>${b}</span>`).join('');
    const g=ghosts0().find(x=>mine(x.run));$('qbest').textContent=g?`${fmt(g.time)} on ${route.name}`:'Run this route once first';
  }
  // last run
  const done=allRuns.filter(r=>r.status==='done').sort((a,b)=>b.started-a.started),last=done[0];
  $('lastcard').hidden=!last;
  renderPlan(pl);renderGoal();
  if(last){const u=outcome(last);
    $('lastcard').innerHTML=`<button class="lastrun" id="lastbtn"><span class="lr-ic">${u.icon}</span><span class="lr-t"><small>Last run · ${when(last.started)}${last.sim?' · sim':''}</small><b>${esc(last.route?.name||'Run')}</b><small>${kmStr(u.c.d||last.yd||0)} km · ${fmt(u.c.you)}</small><div class="lr-r ${u.cls}">${esc(u.text)}</div></span><i class="chev"></i></button>`;
    $('lastbtn').onclick=()=>showResult(last)}
  // the last 7 days
  const day0=new Date();day0.setHours(0,0,0,0);const wk=[];
  for(let i=6;i>=0;i--){const d=new Date(day0);d.setDate(d.getDate()-i);wk.push({t:d.getTime(),km:0,lab:d.toLocaleDateString(undefined,{weekday:'narrow'})})}
  let n=0,secs=0;
  const HARD=['race','tempo','int','long','easy'];
  for(const r of done.filter(r=>SIM||!r.sim))if(r.started>=wk[0].t&&mine(r)){const k=wk.findLastIndex(x=>x.t<=r.started),kd=kindOf(r);wk[k].km+=(r.yd??r.rd??0)/1000;n++;secs+=(r.elapsed||0)/1000;
    if(!wk[k].kind||HARD.indexOf(kd)<HARD.indexOf(wk[k].kind))wk[k].kind=kd}
  const tot=wk.reduce((a,x)=>a+x.km,0),mx=Math.max(1,...wk.map(x=>x.km));
  $('weekcard').hidden=!done.length||!$('plancard').hidden; // (your week's plan shows the week instead)
  $('weekcard').innerHTML=`<div class="wk-top"><div class="h">Last 7 days</div></div><div class="wk-num"><div><b>${tot.toFixed(1)}</b><span>km</span></div><div><b>${n}</b><span>run${n===1?'':'s'}</span></div><div><b>${fmt(secs)}</b><span>time</span></div></div>`+
    `<div class="wkbars">${wk.map((x,i)=>`<div class="${i===6?'today':''}"><i class="${x.km?'':'z'}" style="height:${x.km?Math.max(8,x.km/mx*100):4}%${x.kind?`;background:${KCOL[x.kind]}`:''}"></i><small>${x.lab}</small></div>`).join('')}</div>`;
  // Runner DNA
  const A=getA();$('dnateaser').hidden=!done.length;
  $('dnateaser').innerHTML=A.ready?`<span class="ti">${A.type.icon}</span><span><small>Your Runner DNA</small><b>${A.type.name}</b><small>Climbing ${A.scores.climb} · Descending ${A.scores.descent}${A.scores.pacing!=null?` · Pacing ${A.scores.pacing}`:''}</small></span><i class="chev"></i>`
    :`<span class="ti">🧬</span><span><b>Unlock your Runner DNA</b><small>Race a route with GPS, or import a run, and Pacer learns how you run</small></span><i class="chev"></i>`;
  $('dnateaser').onclick=()=>tab('insights');
}
const ghosts0=()=>route?pastRuns(route):[];

// ---- Results: this run against how you usually run; share it; challenge a friend with it ----
function resultExtras(r){
  $('rchal').hidden=!(r.route?.pts&&r.mode!=='intervals'&&(r.fixes?.length||0)>10);
  // best efforts this run set (beating an earlier best: a first run over a distance isn't news)
  const before=r.mode==='intervals'||!mine(r)?[]:bestsOf(allRuns.filter(x=>x.id!==r.id&&x.started<r.started&&(SIM||!x.sim)));
  const pbs=before.length?getBests().filter(b=>b.run.id===r.id&&before.some(p=>p.id===b.id&&b.t<p.t-0.5)):[];
  const f=r.mode==='intervals'?'':runFacts(getA(),r,true,pbs);
  renderTestCard(r);renderFeelCard(r);
  $('rdna').innerHTML=f;$('rdna').hidden=!f;
}
$('rshare').onclick=async()=>{
  const r=shownRun;if(!r)return;
  const cv=document.createElement('canvas');cv.width=1080;cv.height=1350;
  const pts=r.route?.pts||[],c=compare(r),you=c.you,D=c.ran||c.d||r.yd||r.rd||0;
  const grade=i=>{const a=pts[Math.max(0,i-5)],b=pts[Math.min(pts.length-1,i+5)];return b.d>a.d?((b.ele??0)-(a.ele??0))/(b.d-a.d)*100:0};
  const sp=(r.rsplits||[]).map((t,k)=>(t-(r.rsplits[k-1]||0))/1000),avg=sp.length?sp.reduce((a,b)=>a+b,0)/sp.length:0;
  drawCard(cv.getContext('2d'),{tag:r.mode==='intervals'?'Pacer · intervals':'Pacer',title:r.route?.name||'Run',big:fmt(you),line:$('rtitle').textContent,
    stats:[['Distance',`${kmStr(D)} km`],['Pace',`${fmt(you/(D/1000||1))}/km`],['Climb',`${Math.round(pts.length?climbOf({pts}):0)} m`]],
    pts,colors:pts.map((_,i)=>gradeColor(grade(i))),splits:sp.map(s=>({s,faster:s<avg})),accent:!c.record&&!c.intervals&&c.diff<0?'#4ade80':'#fb923c'});
  const blob=await new Promise(res=>cv.toBlob(res,'image/png'));
  const file=new File([blob],`pacer-${new Date(r.started).toISOString().slice(0,10)}.png`,{type:'image/png'});
  if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return}catch(e){if(e.name==='AbortError')return}}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=file.name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
};
$('rchal').onclick=async()=>{
  const r=shownRun;if(!r?.route?.pts)return;
  let who=opt.get('me:name','');
  if(!who){who=(prompt('Your name, so your friend knows who challenged them')||'').trim().slice(0,24);if(who)opt.set('me:name',who)}
  try{
    const code=await encodeChallenge(r.route.pts,r,{who,name:r.route.name});
    const url=`${location.origin}${location.pathname}#c=${code}`,t=fmt(r.elapsed/1000);
    const text=`${who||'I'} ran ${r.route.name} (${kmStr(Math.min(r.route.pts.at(-1).d,r.rd||1e9))} km) in ${t}. Think you can beat it? Race me in Pacer:`;
    if(navigator.share){try{await navigator.share({title:'Pacer challenge',text,url});return}catch(e){if(e.name==='AbortError')return}}
    await navigator.clipboard?.writeText(`${text} ${url}`);alert('Challenge link copied: paste it to a friend.');
  }catch(e){alert('Could not make the link: '+e.message)}
};

// ---- Opening a challenge link: save the course (or find it among yours) and the run, then race it ----
let incoming=null;
const clearHash=()=>history.replaceState(null,'',location.pathname+location.search);
async function checkChallenge(){
  const m=location.hash.match(/^#c=([A-Za-z0-9_-]+)/);if(!m)return;
  try{incoming=await decodeChallenge(m[1])}catch(e){clearHash();return alert(e.message)}
  if(!$('run').hidden)return; // not in the middle of a run
  show('home');tab('today');$('chin').hidden=false;
  $('chtitle').textContent=`${incoming.who||'A friend'} challenges you`;
  $('chsub').textContent=`${incoming.name||'A route'} · ${kmStr(incoming.D)} km in ${fmt(incoming.elapsed)} (${fmt(incoming.elapsed/(incoming.D/1000))}/km). Race their run as a ghost, metre by metre: every surge, every hill.`;
}
$('chno').onclick=()=>{$('chin').hidden=true;incoming=null;clearHash()};
$('chgo').onclick=async()=>{
  const c=incoming;if(!c)return;
  const pts=challengeRoute(c);let r=sameRoute(routes,pts),run;
  if(!r){r={name:c.name||`${c.who||'Friend'}'s route`,created:Date.now(),src:'Challenge',pts,cues:[]};r.id=await saveRoute(r);routes.unshift(r);run=challengeRun(c,pts)}
  else{ // on your own copy of the course: place their run on it
    const im=importRun(c.pts.map(p=>({lat:p.lat,lon:p.lon,ele:p.ele,t:c.started+p.t*1000})),r.pts);
    run={...challengeRun(c,pts),fixes:im.fixes,rd:im.rd,yd:im.dist,dist:im.dist,rsplits:im.rsplits,elapsed:im.elapsed,complete:im.complete};
  }
  let rec=allRuns.find(x=>x.imported?.challenge&&x.started===c.started&&x.route?.id===r.id);
  if(!rec){rec={...run,route:{id:r.id,name:r.name,src:r.src,pts:r.pts,cues:r.cues||[]},saved:Date.now()};rec.id=await saveRun(rec);allRuns=await listRuns()}
  $('chin').hidden=true;incoming=null;clearHash();
  opt.set('how:'+r.id,'full');opt.set('pcmode:'+r.id,'ghost');opt.set('ghost:'+r.id,rec.id);
  selectRoute(r);await refreshHistory();openSetup('vscard');
};
addEventListener('hashchange',()=>checkChallenge());

initHome();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
