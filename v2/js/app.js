// Pacer (v2): race a virtual pacer who runs the route at a gradient-aware pace.
// Screens: Home (route, target, pacer profile, options, history) → Run (full-screen view,
// you vs pacer) → Result.
import {createTrack,watch,fitPace,speedPace,createSmoother} from './gps.js';
import {parseGPX,resample,fillElevation} from './route.js';
import {createMatcher} from './match.js';
import {turnsFor,nextTurn,turnText,inDist} from './nav.js';
import {createStartGate,compass} from './start.js';
import {buildPacer,timeAt,distAt,paceAt,avgBetween,extremes,gradeColor,projectFinish,paceMarks,ghostFromRun,ghostFromTimes,adjustPacer,PROFILES,TRAIT_NAMES} from './pacer.js';
import {RPE_SCALE,INTENSITIES,rpePlan,rpeAt,rpeName,checkpoints,advise,parseRpe,parseYesNo,rpeCol,rpeRound,rpeMarks} from './rpe.js';
import {createView,gapText} from './view.js';
import {saveRoute,listRoutes,deleteRoute,saveRun,listRuns,deleteRun,opt,importV1Routes} from './store.js';
import {SIM,SPEED,now,every,sim,simWatch,SCENARIOS} from './sim.js';
import {createCoach,createSpeaker,gapPhrase,STYLES,listen} from './coach.js';
import {fetchWeather,at as wxAt,windStretches,compass16,mph,SHELTER} from './weather.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const fmtP=p=>p&&p<1800?fmt(p):'--:--';
const gapFmt=s=>s<59.5?`${Math.round(s)} s`:fmt(s);
const kmStr=m=>(m/1000).toFixed(2);
const show=id=>{for(const s of ['home','run','result'])$(s).hidden=s!==id;if(id!=='run')scrollTo(0,0)};

// =====================================================================================
// Home
// =====================================================================================
let routes=[],route=null,P=null,turns=[],allRuns=[],ghostRun=null;
const when=ms=>new Date(ms).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const shortDate=ms=>new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short'});
// Your finished runs on a route that went (nearly) the whole way: these can be raced as a ghost, best first
const runsOn=r=>allRuns.filter(x=>x.status==='done'&&x.route?.id===r.id&&x.fixes?.length>10&&(x.complete||(x.rd||0)>=r.pts.at(-1).d*0.97)).sort((a,b)=>a.elapsed-b.elapsed);
let prof=opt.get('profile',{id:'even',climb:'average',descent:'average',strategy:'even'});
// speed: live pace from GPS (Doppler) speed, falling back to position; live: how quickly live pace reacts
const o={speed:opt.get('speedSrc',true),live:opt.get('live','balanced'),band:opt.get('band',5),auto:opt.get('auto',true),zone:opt.get('zone',25),view:opt.get('view','map'),
  voice:opt.get('voice','full'),tones:opt.get('tones',true),rate:opt.get('rate','normal'),muted:opt.get('muted',false)};
o.coachStyle=opt.get('coachStyle','moderate');o.rpe=opt.get('rpe',true);o.intensity=opt.get('intensity','allout');o.rpeAsk=opt.get('rpeAsk',true);o.rpeMic=opt.get('rpeMic',true);o.wxOn=opt.get('wxOn',true);o.wxMode=opt.get('wxMode','keep');o.shelter=opt.get('shelter','some');
const RATES={slow:0.9,normal:1,fast:1.12};
const speaker=createSpeaker();speaker.setOpts({tones:o.tones,rate:RATES[o.rate]});speaker.setMuted(o.muted);
const voiceOn=()=>o.voice!=='off'&&!o.muted;
const finishFor=r=>opt.get('finish:'+r.id,Math.round(r.pts.at(-1).d/1000*300/15)*15); // default 5:00/km
const msg=(t,err)=>{$('msg').textContent=t;$('msg').className=err?'err':''};
if(SIM){
  document.querySelector('.brand h1').textContent='Pacer · SIM';
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
  refreshHistory();storageStatus();fixRecordedElevation();
}

$('gpx').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    msg('Reading '+f.name+'…');
    const g=parseGPX(await f.text());
    if(g.pts.length<2)throw new Error('No track or route points found in this file');
    let s=resample(g.pts),src='GPX';
    if(s.some(p=>p.ele==null)){s=await fillElevation(s,fetch,5,(i,n)=>msg(`Fetching elevation ${i}/${n}…`));src='Open-Meteo'}
    const r={name:g.name||f.name.replace(/\.[^.]+$/,''),created:Date.now(),src,pts:s,cues:g.cues};
    r.id=await saveRoute(r);routes.unshift(r);msg('');selectRoute(r);
  }catch(err){msg(err.message,true)}
};

function renderRoutes(){
  $('routes').innerHTML=routes.map(r=>`<li class="${route?.id===r.id?'on':''}"><button class="sel" data-id="${r.id}">${esc(r.name)}<span class="meta">${kmStr(r.pts.at(-1).d)} km${r.from==='v1'?' · from v1':''}${r.recorded?' · recorded':''}</span></button><button class="del" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">✕</button></li>`).join('');
  $('routes').querySelectorAll('.sel').forEach(b=>b.onclick=()=>selectRoute(routes.find(r=>r.id===+b.dataset.id)));
  $('routes').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    const r=routes.find(x=>x.id===+b.dataset.id);if(!confirm(`Delete route "${r.name}"?`))return;
    await deleteRoute(r.id);routes=routes.filter(x=>x!==r);if(route===r)selectRoute(routes[0]||null);else renderRoutes();
  });
}

function selectRoute(r){
  route=r;if(r)opt.set('route',r.id);
  renderRoutes();
  $('plan').hidden=!r;$('race').disabled=!r;
  if(r){turns=turnsFor(r);rebuild();loadWeather()}
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
function rebuild(){
  const fin=finishFor(route),ghosts=runsOn(route);
  ghostRun=opt.get('pcmode:'+route.id,'profile')==='ghost'&&ghosts.length?(ghosts.find(x=>x.id===opt.get('ghost:'+route.id,null))||ghosts[0]):null;
  P=ghostRun?ghostFromRun(route.pts,ghostRun.fixes,ghostRun.elapsed/1000):buildPacer(route.pts,fin,prof,{cond:cond()});
  renderPcMode(ghosts);renderRpe();
  $('tgtcard').hidden=$('wxcard').hidden=$('profiles').hidden=$('tune').hidden=!!ghostRun;
  renderWx();
  const D=P.total,up=P.es.reduce((a,e,i)=>a+(i&&e>P.es[i-1]?e-P.es[i-1]:0),0);
  $('rname').textContent=route.name;
  $('rchips').innerHTML=[`${kmStr(D)} km`,`${Math.round(up)} m climb`,`${turns.length} turns`,`elevation: ${route.src}`].map(t=>`<span>${esc(t)}</span>`).join('');
  $('v-finish').textContent=fmt(fin);$('v-pace').textContent=fmt(fin/(D/1000));
  renderProfiles();drawPlanMap();drawPlanChart();
  const e=extremes(P),g=x=>`${x>0?'+':''}${x.toFixed(1)} %`;
  const pr=PROFILES.find(p=>p.id===prof.id);
  if(ghostRun){$('pinsight').innerHTML=`Racing your run from <b>${when(ghostRun.started)}</b>: <b>${fmt(P.finish)}</b> (${fmt(P.finish/(D/1000))}/km)${ghostRun===ghosts[0]?', your best here 🏆':''}. It was slowest at <b>${fmt(e.slow.pace)}</b>/km around ${kmStr(e.slow.d)} km and quickest at <b>${fmt(e.fast.pace)}</b>/km around ${kmStr(e.fast.d)} km.`;return}
  $('pinsight').innerHTML=`${pr?esc(pr.desc)+'<br>':''}${P.wx?`Paced for the ${o.wxMode==='adjust'?'conditions':'conditions, same finish'}. `:''}Slowest <b>${fmt(e.slow.pace)}</b>/km on the ${g(e.slow.grade)} at ${kmStr(e.slow.d)} km · quickest <b>${fmt(e.fast.pace)}</b>/km on the ${g(e.fast.grade)} at ${kmStr(e.fast.d)} km. Finishes in <b>${fmt(P.finish)}</b>.`;
}

function drawPlanMap(){
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
  $('pmap').setAttribute('viewBox',`${-pad} ${-pad} ${w+2*pad} ${h+2*pad}`);$('pmap').innerHTML=s;
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
  s+=`<polyline points="${P.d.map((d,i)=>X(d)+','+Yp(P.pace[i])).join(' ')}" fill="none" stroke="#fb923c" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  $('pchart').innerHTML=s;
  const pct=y=>(y/220*100).toFixed(1)+'%';
  $('pylab').innerHTML=`<span style="top:${pct(Yp(pmin))}">${fmt(pmin)}</span><span style="top:${pct(Yp(avg))}">${fmt(avg)}</span><span style="top:${pct(Yp(pmax))}">${fmt(pmax)}</span>`;
  $('paxis').innerHTML=`<span>0 km</span><span>${kmStr(D/2)}</span><span>${kmStr(D)} km</span>`;
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
const setFinish=f=>{const D=route.pts.at(-1).d/1000;f=Math.max(150*D,Math.min(720*D,f));opt.set('finish:'+route.id,Math.round(f));rebuild()};
stepper($('st-finish'),(d,n)=>setFinish(finishFor(route)+d*(n<8?5:n<20?15:60)));
stepper($('st-pace'),(d,n)=>{const D=route.pts.at(-1).d/1000,p=Math.round(finishFor(route)/D)+d*(n<15?1:5);setFinish(p*D)});

function renderProfiles(){
  $('profiles').innerHTML=PROFILES.map(p=>`<button class="prof ${prof.id===p.id?'on':''}" data-id="${p.id}"><span class="ic">${p.icon}</span><b>${p.name}</b><small>${esc(p.desc)}</small></button>`).join('');
  $('profiles').querySelectorAll('.prof').forEach(b=>b.onclick=()=>{const p=PROFILES.find(x=>x.id===b.dataset.id);setProf({id:p.id,climb:p.climb,descent:p.descent,strategy:p.strategy})});
  for(const k of ['climb','descent','strategy']){
    const keys=k==='strategy'?['even','negative','positive']:k==='climb'?['weak','average','strong']:['cautious','average','strong'];
    $('t-'+k).innerHTML=keys.map(v=>`<button data-v="${v}" class="${prof[k]===v?'on':''}">${TRAIT_NAMES[k][v]}</button>`).join('');
    $('t-'+k).querySelectorAll('button').forEach(b=>b.onclick=()=>{
      const next={...prof,[k]:b.dataset.v},match=PROFILES.find(p=>p.climb===next.climb&&p.descent===next.descent&&p.strategy===next.strategy);
      setProf({...next,id:match?match.id:'custom'});
    });
  }
}
function setProf(p){prof=p;opt.set('profile',p);rebuild()}

// ---- Effort (RPE): the plan for how hard each part should feel ----
// Colour for an RPE: green (easy) through yellow and orange to red (maximal)
let Rplan=null;
function renderRpe(){
  const sw=(id,v)=>{$(id).classList.toggle('on',v);$(id).setAttribute('aria-checked',v)};
  sw('o-rpe',o.rpe);sw('o-rpeask',o.rpeAsk);sw('o-rpemic',o.rpeMic);
  $('o-rpe').onclick=()=>{o.rpe=!o.rpe;opt.set('rpe',o.rpe);renderRpe()};
  $('o-rpeask').onclick=()=>{o.rpeAsk=!o.rpeAsk;opt.set('rpeAsk',o.rpeAsk);renderRpe()};
  $('o-rpemic').onclick=()=>{o.rpeMic=!o.rpeMic;opt.set('rpeMic',o.rpeMic);renderRpe()};
  $('rpe-body').hidden=!o.rpe;
  if(!$('rpe-scale').children.length)$('rpe-scale').innerHTML=RPE_SCALE.map(x=>`<li><i style="background:${rpeCol(x.n)}">${x.n}</i><span><b>${x.name}</b> ${esc(x.feel)}<em>Talk test: ${x.talk}</em></span></li>`).join('');
  $('rpe-int').innerHTML=INTENSITIES.map(x=>`<button class="stylec ${x.id===o.intensity?'on':''}" data-v="${x.id}"><b>${x.name}</b><small>${esc(x.desc)}</small></button>`).join('');
  $('rpe-int').querySelectorAll('.stylec').forEach(b=>b.onclick=()=>{o.intensity=b.dataset.v;opt.set('intensity',o.intensity);renderRpe()});
  if(!P||!o.rpe)return;
  Rplan=rpePlan(P,o.intensity);
  const W=1000,D=P.total,X=d=>(d/D*W).toFixed(1),Y=r=>(150-(r-1)/9*140).toFixed(1);
  const lo=Math.min(...P.es),span=Math.max(Math.max(...P.es)-lo,20);
  let g=`<polygon points="0,160 ${P.d.map((d,i)=>X(d)+','+(160-(P.es[i]-lo)/span*45).toFixed(1)).join(' ')} ${W},160" fill="#1e293b"/>`;
  for(const r of [2,4,6,8,10])g+=`<line x1="0" x2="${W}" y1="${Y(r)}" y2="${Y(r)}" stroke="#fff" stroke-opacity=".08" vector-effect="non-scaling-stroke"/>`;
  for(let i=0;i<Rplan.d.length-1;i+=2){const j=Math.min(i+2,Rplan.d.length-1);g+=`<line x1="${X(Rplan.d[i])}" x2="${X(Rplan.d[j])}" y1="${Y(Rplan.rpe[i])}" y2="${Y(Rplan.rpe[j])}" stroke="${rpeCol(Rplan.rpe[i])}" stroke-width="3.5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`}
  if(o.rpeAsk)for(const d of checkpoints(P))g+=`<circle cx="${X(d)}" cy="12" r="5" fill="#fff" fill-opacity=".85" vector-effect="non-scaling-stroke"/>`;
  $('rpechart').innerHTML=g;
  const pct=y=>(y/160*100).toFixed(1)+'%';
  $('rpeylab').innerHTML=[2,4,6,8,10].map(r=>`<span style="top:${pct(Y(r))}">${r}</span>`).join('');
  $('rpeaxis').innerHTML=`<span>0 km</span><span>${kmStr(D/2)}</span><span>${kmStr(D)} km</span>`;
  const at=d=>Math.round(rpeAt(Rplan,d)*2)/2,q=D>=4000?2500:D/4,peak=Rplan.rpe.reduce((m,v,i)=>v>m.v&&P.time[i]<P.finish*0.8?{v,d:P.d[i]}:m,{v:0,d:0});
  const I=INTENSITIES.find(x=>x.id===o.intensity),dots=o.rpeAsk?' <span class="dim">White dots: when it will ask how you feel.</span>':'';
  const hiR=Math.round(Math.max(...Rplan.rpe)*2)/2;
  if(I.shape==='flat'){
    $('rpeinsight').innerHTML=`Hold about <b>${Rplan.start}</b> (${I.id==='easy'?'easy, Zone 2':rpeName(Rplan.start).toLowerCase()}) the whole way. It shouldn't build as you go: if it starts to feel harder, slow down.`+
      (hiR>Rplan.start?` A touch more on the climbs (up to ${hiR})${I.id==='easy'?'; walk the steep bits if you need to':''}.`:'')+dots;
    return;
  }
  $('rpeinsight').innerHTML=(I.id==='allout'
      ?`Start around <b>${at(300)}</b> (${rpeName(at(300)).toLowerCase()}), <b>${at(q)}</b> by ${kmStr(q)} km, <b>${at(D/2)}</b> at halfway and <b>${at(D)}</b> at the finish: building steadily, with nothing left at the line.`
      :`Settle at about <b>${at(D/4)}</b> (${rpeName(at(D/4)).toLowerCase()}) and hold it, about <b>${at(D/2)}</b> at halfway, building only to <b>${at(D)}</b> by the finish. You should finish knowing you had more.`)+
    (peak.v>at(D*0.6)+0.4?` The toughest part before the finish is around ${kmStr(peak.d)} km (${Math.round(peak.v*2)/2}); let your breathing settle over the top.`:'')+dots;
}

// Choose between a pacer profile and one of your past runs on this route (best first, 🏆)
function renderPcMode(ghosts){
  $('pc-mode').querySelectorAll('button').forEach(b=>{
    b.classList.toggle('on',b.dataset.v===(ghostRun?'ghost':'profile'));b.disabled=b.dataset.v==='ghost'&&!ghosts.length;
    b.onclick=()=>{opt.set('pcmode:'+route.id,b.dataset.v);rebuild()};
  });
  $('pcnote').textContent=ghosts.length?'':'Run this route once and you can race yourself on it.';
  $('ghosts').hidden=!ghostRun;
  const D=route.pts.at(-1).d/1000;
  $('ghosts').innerHTML=ghosts.map((r,i)=>`<button class="stylec ${r===ghostRun?'on':''}" data-id="${r.id}"><b>${i===0?'🏆 ':''}${when(r.started)}<em>${fmt(r.elapsed/1000)} · ${fmt(r.elapsed/1000/D)}/km</em></b><small>${r.mode==='record'?'When you recorded this route':r.ghost?'Racing a past run':'Racing a pacer'}${i===0?' · your best here':''}${r.sim?' · simulated':''}</small></button>`).join('');
  $('ghosts').querySelectorAll('.stylec').forEach(b=>b.onclick=()=>{opt.set('ghost:'+route.id,+b.dataset.id);rebuild()});
}

function renderOptions(){
  $('o-speed').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',(b.dataset.v==='1')===o.speed);b.onclick=()=>{o.speed=b.dataset.v==='1';opt.set('speedSrc',o.speed);renderOptions()}});
  $('o-band').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',+b.dataset.v===o.band);b.onclick=()=>{o.band=+b.dataset.v;opt.set('band',o.band);renderOptions()}});
  $('o-live').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',b.dataset.v===o.live);b.onclick=()=>{o.live=b.dataset.v;opt.set('live',o.live);smoother=createSmoother(LIVE[o.live].tau);renderOptions()}});
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
  $('o-zone').querySelector('b').textContent=`${o.zone} m`;
  $('o-zone').querySelectorAll('button').forEach(b=>b.onclick=()=>{o.zone=Math.max(10,Math.min(100,o.zone+ +b.dataset.d));opt.set('zone',o.zone);renderOptions()});
}
renderOptions();

$('race').onclick=()=>{if(route&&P)enterRun(route,P,turns,ghostRun?null:cond(),prof,ghostRun)};
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
let runR=null,runChecks=[],checkI=0,asking=null,effSaid=null,effAt=-1e9; // RPE plan for this run, check-in points, the open question
const who=()=>runGhost?'ghost':'pacer',Who=()=>runGhost?'Ghost':'Pacer';
// Show the parts of the run screen that only make sense when racing a route
function raceUI(on){
  for(const id of ['turn','views'])$(id).hidden=!on;
  $('course').style.display=on?'':'none'; // (an svg: no .hidden)
  $('togow').hidden=!on;$('projl').textContent=on?'Est':'Avg';
  $('plab').textContent=on?Who():'Average';$('lhp').textContent=on?Who():'';
}
function enterRun(r=route,p=P,tr=turns,rc=cond(),pf=prof,ghost=null){
  mode='race';runCond=rc;runGhost=ghost?{runId:ghost.id,started:ghost.started}:null;raceUI(true);
  runRoute=r;runP=p;runTurns=tr;runR=o.rpe?rpePlan(p,o.intensity):null;runChecks=runR&&o.rpeAsk?checkpoints(p):[];
  coach=createCoach({P:p,prof:pf,level:o.voice==='key'?'key':'full',style:o.coachStyle,band:o.band,who:who()});armSaid=null;
  setMuteUI();
  resetRun();
  view.setRoute(r.pts,p,tr);view.setRpe(runR?rpeMarks(runR):[],rpeCol);
  drawCourse(p);
  show('run');layout();setView(o.view);
  cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
// Recording a new route: no pacer, your trail on the map, and the route is built when you save
function enterRecord(){
  mode='record';runCond=null;runRoute=null;runP=null;runTurns=[];runGhost=null;coach=null;runR=null;runChecks=[];raceUI(false);
  setMuteUI();resetRun();view.clearRoute();view.setRpe([]);
  show('run');layout();
  cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
function resetRun(){
  phase='idle';acc=0;track.reset();smoother.reset();rd=0;rsplits=[];rpts=[];spts=[];curPace=null;vNow=0;shownD=0;offRoute=false;
  rec=null;dirty=false;gate=null;sim.restart=true;sim.moving=false;trail=[];spokenSplits=0;checkI=0;closeAsk();effSaid=null;effAt=-1e9;
  matcher=runRoute?createMatcher(runRoute.pts):null;
  $('off').hidden=true;$('arm').hidden=true;
  setPhaseUI();hud();
}
// The map stops at the top of the control bar; the side panel runs from below the top cards to it
// The view stops at the top of the bottom panel; the splits column runs down the left between them
function layout(){
  const bar=$('bottom').getBoundingClientRect().height,top=document.querySelector('.ovtop .row2').getBoundingClientRect().bottom;
  $('cv').style.height=`${Math.max(100,$('run').clientHeight-bar)}px`;
  $('lside').style.top=`${top+8}px`;$('lside').style.bottom=`${bar+8}px`;
  view.resize();
  view.setInsets(top+6,8,8,$('lside').hidden?0:$('lside').getBoundingClientRect().width+12);
}
addEventListener('resize',()=>{if(!$('run').hidden)layout()});
function setView(m){o.view=m;opt.set('view',m);$('views').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===m))}
$('views').querySelectorAll('button').forEach(b=>b.onclick=()=>setView(b.dataset.v));

function setPhaseUI(){
  const go=$('go');go.className='btn go';
  go.textContent={idle:'Start',armed:'Cancel',running:'Pause',paused:'Continue',done:'Start'}[phase];
  if(phase==='armed')go.classList.add('cancel');
  $('finbtn').hidden=$('discbtn').hidden=phase!=='paused';
  $('ctrls').hidden=phase==='running';               // running: your pace, the pacer's, and a big Pause
  $('tiles').hidden=phase!=='running';               // paused: Continue / Save / Discard instead
  $('lside').hidden=phase==='idle'||phase==='armed'; // nothing to show yet, and the start card needs the width
  if(!$('run').hidden)requestAnimationFrame(layout);
  $('back').hidden=phase==='running'||phase==='armed';
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
    if(matcher){
      const m=matcher.update(c.latitude,c.longitude,track.dist);
      rd=m.d;offRoute=m.off;
      $('off').hidden=!m.off;$('off').textContent=(m.matched?'Off route':'Not on the route yet')+' · using GPS distance';
    }else rd=track.dist; // recording: your own distance
    while(rd>=(rsplits.length+1)*1000)rsplits.push(t);
    rpts.push({t,d:rd});
  }
  // GPS speed from every decent fix, even ones too close together to count for distance
  if(c.accuracy<=25&&c.speed!=null&&c.speed>=0)spts.push({t,v:c.speed});
  updatePace(t);
  if(!used)return;
  if(mode==='record')trail.push({lat:c.latitude,lon:c.longitude,p:curPace});
  rec.fixes.push([p.timestamp,t,c.latitude,c.longitude,c.accuracy,track.dist,rd,curPace]);dirty=true;
  if(runP&&rd>=runP.total-8)finishRun(true);
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
  if(voiceOn())speaker.say(rec?'Resumed':mode==='record'?'Recording. Off you go.':`Go! Your ${who()}'s away.`,3,'start');
  if(!rec&&mode==='record')rec={started:Date.now(),status:'active',mode:'record',sim:SIM,route:null,speed:o.speed,fixes:[]};
  if(!rec)rec={started:Date.now(),status:'active',mode:'race',sim:SIM,route:{id:runRoute.id,name:runRoute.name,src:runRoute.src,pts:runRoute.pts,cues:runRoute.cues||[]},
    finish:runP.target??runP.finish,prof:{...prof},speed:o.speed,cond:runCond,fixes:[],
    ghost:runGhost?{...runGhost,time:runP.time.map(x=>+x.toFixed(1))}:null,intensity:runR?o.intensity:null,rpe:[],adjust:[]};
  phase='running';t0=at??now();track.last=null;rpts=[];spts=[];sim.moving=true;
  ensureWatch();wake();setPhaseUI();
}
function pause(){acc=el();phase='paused';sim.moving=false;lock?.release();lock=null;setPhaseUI();save();if(voiceOn())speaker.say('Paused',2)}
$('pausebig').onclick=()=>{if(phase==='running')pause()};
$('go').onclick=()=>{
  speaker.unlock(); // iOS: audio must be started from a tap
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
  rec=null;resetRun();
};
$('back').onclick=async()=>{
  if(phase==='paused'&&rec){if(!confirm('Leave this run? It stays saved, and you can resume it from the home screen.'))return;await save()}
  else if(phase==='idle'&&rec?.id&&!worth(rec))await deleteRun(rec.id);
  cancelAnimationFrame(raf);phase='idle';sim.moving=false;rec=null;show('home');refreshHistory();
};

// ---- Recording ----
const worth=r=>!!r&&r.fixes.length>=2&&(r.rd||rd)>=50;
function snapshot(){Object.assign(rec,{elapsed:el(),running:phase==='running',rd,dist:track.dist,rsplits:[...rsplits],saved:Date.now()})}
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
  acc=el();phase='done';sim.moving=false;lock?.release();lock=null;
  if(complete)rd=runP.total;
  snapshot();Object.assign(rec,{status:'done',running:false,complete});
  if(complete&&voiceOn()){const g=timeAt(runP,runP.total)-acc/1000,w=runGhost?'your past run':'the pacer';speaker.say(`Finished in ${fmt(acc/1000)}. ${Math.abs(g)<0.5?`A dead heat with ${w}!`:g>0?`You beat ${w} by ${gapPhrase(g).replace(' ahead','')}!`:`${w[0].toUpperCase()+w.slice(1)} won by ${gapPhrase(g).replace(' behind','')}.`}`,3,'pass')}
  await saving;rec.id=await saveRun(rec);allRuns=await listRuns();
  cancelAnimationFrame(raf);showResult(rec);
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
  const m=createMatcher(s),fx=rec.fixes.map(f=>[...f.slice(0,6),m.update(f[2],f[3],f[5]).d,f[7]]),spl=[];
  for(const f of fx)while(f[6]>=(spl.length+1)*1000)spl.push(f[1]);
  Object.assign(rec,{status:'done',running:false,complete:true,route:{id:r.id,name,src:r.src,pts:s,cues:[]},fixes:fx,rd:D,rsplits:spl,finish:rec.elapsed/1000,prof:null});
  await saving;rec.id=await saveRun(rec);allRuns=await listRuns();
  if(voiceOn())speaker.say(`Route saved. ${kmStr(D)} kilometres in ${fmt(rec.elapsed/1000)}.`,2);
  showResult(rec);
}
// Recorded routes saved offline get their elevation when there's signal again
async function fixRecordedElevation(){
  for(const r of routes.filter(x=>x.needsEle)){
    try{r.pts=await fillElevation(r.pts.map(p=>({...p,ele:null})),fetch,5);r.needsEle=false;r.src='Recorded';await saveRoute(r);if(route===r)rebuild()}catch(e){return}
  }
}

// ---- Frame loop: smooth movement between GPS fixes ----
function loop(ts){
  raf=requestAnimationFrame(loop);
  if(ts-lastFrame<33)return;lastFrame=ts;
  // You glide at your smoothed speed; each GPS position eases the arrow in over ~1.5 s rather than jumping
  const tn=now(),dt=lastFrameAt?Math.min(0.5,(tn-lastFrameAt)/1000):0;lastFrameAt=tn;
  if(mode==='record'){view.draw({trail,avg:rd>50?el()/1000/(rd/1000):null,dist:rd});return}
  if(phase==='running'){
    shownD+=vNow*dt;const err=rd-shownD;
    shownD=Math.abs(err)>80?rd:shownD+err*Math.min(1,dt/1.5);
    shownD=Math.min(runP.total,Math.max(0,shownD));
  }else shownD+=(rd-shownD)*0.3;
  const started=phase==='running'||phase==='paused'||phase==='done';
  const pd=started?distAt(runP,el()/1000):0;
  courseMarks(started?shownD:0,pd);
  view.draw({mode:o.view,label:runGhost?'GHOST':'PACER',you:started?shownD:0,pacer:pd,gap:started?gapNow:null,youCol:STATUS_COL[stat]||null,gps:(!started||offRoute)?lastLL:null});
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
function timeOneKmBack(){
  const f=rec?.fixes,want=rd-1000;if(!f?.length||want<0)return null;
  let lo=0,hi=f.length-1;if(f[lo][6]>want)return null;
  while(hi-lo>1){const m=(lo+hi)>>1;if(f[m][6]<=want)lo=m;else hi=m}
  const a=f[lo],b=f[hi],k=b[6]>a[6]?(want-a[6])/(b[6]-a[6]):0;
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
    `<line id="cyou" y1="0" y2="40" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
  $('course').innerHTML=s;
}
function courseMarks(you,pacer){
  const x=d=>(Math.max(0,Math.min(runP.total,d))/runP.total*1000).toFixed(1);
  $('cdone').setAttribute('width',x(you));
  for(const [id,d] of [['cyou',you],['cpacer',pacer]]){$(id).setAttribute('x1',x(d));$(id).setAttribute('x2',x(d))}
}

// ---- RPE on the run: the chip shows how hard it should feel here; check-ins ask how it does feel ----
function rpeHud(){
  if(!runR||phase==='idle'||phase==='armed')return;
  const r=Math.round(rpeAt(runR,rd)*2)/2;
  while(checkI<runChecks.length&&runChecks[checkI]<rd-300)checkI++; // passed while paused or resumed
  if(phase==='running'&&!asking&&checkI<runChecks.length&&rd>=runChecks[checkI]){checkI++;askRpe(true)}
  else if(phase==='running'&&!asking)effortCue();
}
// Spoken effort: where to settle at the start, then whenever the target is about to change by a whole
// point and stay changed (a climb, recovery over the top, or a race building), at most every 2 minutes
function effortCue(){
  if(!voiceOn())return;
  const t=el()/1000,I=runR.intensity;
  if(effSaid==null){
    if(rd<15)return;
    const r=rpeRound(rpeAt(runR,Math.max(rd,300)));effSaid=r;effAt=t;
    speaker.say(I.shape==='flat'?`Effort: about ${r} out of 10, ${rpeName(r).toLowerCase()}, and keep it there the whole way.`
      :`Effort: settle in around ${r} out of 10, ${rpeName(r).toLowerCase()}.${I.id==='allout'?' It will build as you go.':''}`,2);
    return;
  }
  if(t-effAt<120)return;
  // Only a change that lasts: a point or more away 50 m ahead, and still at least half a point the same
  // way 200 m ahead
  const ahead=rpeRound(rpeAt(runR,rd+50)),later=rpeRound(rpeAt(runR,rd+200));
  if(Math.abs(ahead-effSaid)<1||Math.abs(later-effSaid)<0.5||(ahead>effSaid)!==(later>effSaid))return;
  const up=ahead>effSaid,g=runP.grade,climb=[0,50,100,150].some(x=>g[Math.min(g.length-1,Math.round((rd+x)/10))]>2);
  effSaid=ahead;effAt=t;
  speaker.say(up?`Effort up to ${ahead}${climb?' for this climb':''}, ${rpeName(ahead).toLowerCase()}.`
    :`Effort easing to ${ahead}. ${climb?'':'Let your breathing settle.'}`.trim(),2);
}
// Tap your pace tile at any time to say how hard it feels
$('youtile').onclick=()=>{speaker.unlock();if(runR&&mode==='race'&&phase==='running'&&!asking)askRpe(false)};
function closeAsk(){asking?.stop?.();clearTimeout(asking?.timer);asking=null;$('rpeask').hidden=$('rpeadv').hidden=true}
// Can the phone listen for a spoken answer? (Then check-ins are voice only; the tap card is the fallback.)
const canListen=()=>o.rpeMic&&voiceOn()&&!SIM&&!!(window.SpeechRecognition||window.webkitSpeechRecognition);
function askRpe(spoken){
  closeAsk();const card=!spoken||!canListen();
  const tg=rpeAt(runR,rd);
  $('rpehint').textContent=`It should feel about ${Math.round(tg)} here: ${rpeName(tg).toLowerCase()}. Tap a number${o.rpeMic?' or say it':''}.`;
  $('rpad').innerHTML=RPE_SCALE.map(x=>`<button data-n="${x.n}" class="${x.n===Math.round(tg)?'tg':''}" style="background:${rpeCol(x.n)}"><b>${x.n}</b><small>${x.name.replace(', Zone 2','')}</small></button>`).join('');
  $('rpad').querySelectorAll('button').forEach(b=>b.onclick=()=>answerRpe(+b.dataset.n));
  $('rpemicst').textContent='';$('rpeask').hidden=!card;
  const a=asking={kind:'rpe',voice:!card,timer:setTimeout(()=>{if(asking===a)closeAsk()},30000)};
  const fallback=msg=>{if(asking!==a)return;$('rpemicst').textContent=msg;$('rpeask').hidden=false;a.voice=false};
  const ask=()=>{if(asking!==a||!o.rpeMic||SIM)return;$('rpemicst').textContent='🎤 Listening…';
    a.stop=listen((t,alts)=>{const n=alts.map(parseRpe).find(x=>x!=null);if(asking!==a)return;if(n!=null)answerRpe(n);else fallback(`Heard "${t}". Tap a number.`)},why=>fallback(why==='not-allowed'||why==='service-not-allowed'?'Microphone not allowed. Tap a number.':'Tap a number.'))};
  if(voiceOn())speaker.say(spoken?'Quick check. How hard does it feel, one to ten?':'How hard does it feel, one to ten?',3,'split',ask);else ask();
}
function answerRpe(n){
  if(!asking)return;const byVoice=asking.voice&&canListen();closeAsk();
  const adv=advise({R:runR,P:runP,said:n,at:rd,t:el()/1000});
  rec?.rpe?.push({rd:Math.round(rd),t:Math.round(el()/1000),said:n,target:+rpeAt(runR,rd).toFixed(1),status:adv.status});dirty=true;
  if(!adv.k){if(voiceOn())speaker.say(`${n}. ${adv.text}`,3);return}
  const left=runP.total-rd,newPace=(timeAt(runP,runP.total)-timeAt(runP,rd))*adv.k/(left/1000);
  $('advtitle').textContent=adv.k>1?`Ease off to ${fmt(newPace)}/km?`:`Pick it up to ${fmt(newPace)}/km?`;
  $('advtext').textContent=`You said ${n}. ${adv.text.replace(/ (Ease off|Pick it up) by .*$/,'')} The ${who()} changes to ${adv.change>0?'+':'−'}${Math.abs(adv.change)} s/km for the rest of the run.`;
  $('advyes').textContent=adv.k>1?'Ease off':'Speed up';$('rpeadv').hidden=byVoice;
  const a=asking={kind:'adv',timer:setTimeout(()=>{if(asking===a){closeAsk();if(voiceOn())speaker.say('Keeping the plan.',2)}},25000)};
  $('advyes').onclick=()=>{if(asking===a){closeAsk();applyAdjust(adv.k)}};
  $('advno').onclick=()=>{if(asking===a){closeAsk();if(voiceOn())speaker.say('Keeping the plan.',2)}};
  const ask=()=>{if(asking!==a||!o.rpeMic||SIM)return;a.stop=listen((t,alts)=>{if(asking!==a)return;const y=alts.map(parseYesNo).find(x=>x!=null);if(y===true)$('advyes').onclick();else if(y===false)$('advno').onclick();else $('rpeadv').hidden=false},()=>{if(asking===a)$('rpeadv').hidden=false})};
  if(voiceOn())speaker.say(`${n}. ${adv.text} Say yes or no.`,3,null,ask);else ask();
}
function applyAdjust(k){
  runP=adjustPacer(runP,rd,k);rec.adjust.push({rd:Math.round(rd),k});dirty=true;
  coach?.setP(runP);view.setRoute(runRoute.pts,runP,runTurns);view.setRpe(rpeMarks(runR),rpeCol);drawCourse(runP);
  if(voiceOn())speaker.say(`Done. The ${who()} is now on ${fmt(paceAt(runP,rd+50))} here, finishing in ${fmt(runP.finish)}.`,3,k<1?'up':'down');
}

// Recording: your time, distance, live and average pace, and splits; the voice reads each km
function hudRecord(){
  const t=el()/1000,avg=rd>50?t/(rd/1000):null;
  $('tm').textContent=fmt(t);$('km').textContent=kmStr(rd);$('proj').textContent=fmtP(avg);$('projd').textContent='';$('wxs').hidden=true;
  splits(t);
  $('ypace').textContent=fmtP(curPace);$('ystate').textContent='live';$('youtile').className='tile you rec';
  $('ppace').textContent=fmtP(avg);$('pstate').textContent=`${kmStr(rd)} km so far`;
  $('gap').hidden=phase!=='idle';$('gap').className='gap';$('gap').textContent='Recording a new route';
  if(rsplits.length>spokenSplits){
    spokenSplits=rsplits.length;const k=spokenSplits,sp=(rsplits[k-1]-(rsplits[k-2]||0))/1000;
    if(voiceOn())speaker.say(`Kilometre ${k}. ${fmt(sp)}. Average ${fmtP(avg)}.`,2,'split');
  }
}

// Splits table: every completed km for you and the pacer, then the km in progress (live, faint)
let splitsShown=-1;
function splits(t){
  const n=rsplits.length,k0=n*1000,live=rd-k0>50&&phase!=='idle';
  const rows=[];
  for(let k=0;k<n;k++){
    const you=(rsplits[k]-(rsplits[k-1]||0))/1000,pc=runP?timeAt(runP,(k+1)*1000)-timeAt(runP,k*1000):null;
    rows.push(`<tr><td>${k+1}</td><td class="y ${pc&&you<pc-1?'faster':pc&&you>pc+1?'slower':''}">${fmt(you)}</td><td class="p">${pc?fmt(pc):''}</td></tr>`);
  }
  // The km in progress: average pace so far for you and the pacer over the same stretch; it becomes the
  // km's split time (the same number for a full km) when the km is done
  if(live){
    const you=(t-(rsplits.at(-1)||0)/1000)/((rd-k0)/1000),pc=runP?avgBetween(runP,k0,rd):null;
    rows.push(`<tr class="live"><td>${n+1}</td><td class="y ${pc&&you<pc-1?'faster':pc&&you>pc+1?'slower':''}">${fmtP(you)}</td><td class="p">${pc?fmtP(pc):''}</td></tr>`);
  }
  $('spl').innerHTML=rows.join('')||'<tr class="wait"><td colspan="3">Splits appear as you go</td></tr>';
  if(n!==splitsShown){splitsShown=n;const w=document.querySelector('.splw');w.scrollTop=w.scrollHeight}
}

// ---- Heads-up numbers, turn card, gap ----
function hud(){
  if(mode==='record'&&!$('run').hidden)return hudRecord();
  if($('run').hidden||!runP)return;
  const t=el()/1000,D=runP.total,started=phase==='running'||phase==='paused';
  $('tm').textContent=fmt(t);$('km').textContent=kmStr(rd);$('togo').textContent=kmStr(Math.max(0,D-rd));
  splits(t);
  if(started&&rd>20){
    gapNow=timeAt(runP,rd)-t;$('gap').hidden=true;
    stripWeather(t);
    // The glance tiles: your live pace (coloured against the pacer's pace where you are), the pacer's
    // live pace, and the gap (+ you're ahead)
    const target=paceAt(runP,rd);
    $('ypace').textContent=fmtP(curPace);$('ystate').textContent=`target ${fmtP(target)}`;
    const pdNow=distAt(runP,t);$('ppace').textContent=fmtP(paceAt(runP,pdNow));
    $('pstate').textContent=`${Math.round(Math.abs(pdNow-rd))} m ${pdNow>=rd?'ahead':'behind'}`;
    setStatus(curPace?(curPace>target+o.band?'slow':curPace<target-o.band?'fast':'on'):null);

    // Projected finish: how you're doing against the pacer's hill-aware plan, applied to what's left
    const proj=projectFinish(runP,rd,t,timeOneKmBack());
    if(proj){const dlt=proj-runP.finish;$('proj').textContent=fmt(proj);$('projd').textContent=Math.abs(dlt)<0.5?'on target':`${dlt<0?'−':'+'}${gapFmt(Math.abs(dlt))}`;$('projd').className=dlt<-0.5?'ahead':dlt>0.5?'behind':''}
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
  rpeHud();
  if(phase==='running'&&voiceOn()&&coach&&rd>0&&!asking)speaker.play(coach.update({rd,t,gap:gapNow??0,cur:curPace,splits:rsplits.map(x=>x/1000),
    proj:projectFinish(runP,rd,t,timeOneKmBack())}));
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
const pacerFor=r=>(r.adjust||[]).reduce((p,a)=>adjustPacer(p,a.rd,a.k),r.ghost?ghostFromTimes(r.route.pts,[...r.ghost.time]):buildPacer(r.route.pts,r.finish,r.prof,{cond:r.cond}));
function compare(r){
  if(r.mode==='record')return {Pr:null,you:r.elapsed/1000,pacer:null,d:r.rd||r.dist||0,diff:0,record:true};
  const Pr=pacerFor(r),you=r.elapsed/1000,d=r.complete?Pr.total:r.rd,pacer=timeAt(Pr,d);
  return {Pr,you,pacer,d,diff:you-pacer};
}
// Was this your quickest complete run on its route?
const isBest=r=>r.complete&&r.route&&!allRuns.some(x=>x!==r&&x.id!==r.id&&x.status==='done'&&x.complete&&x.route?.id===r.route.id&&x.elapsed<=r.elapsed);
function showResult(r){
  shownRun=r;$('rrace').hidden=r.mode!=='record';$('rpcbox').hidden=r.mode==='record';
  if(r.mode==='record')return showRecordResult(r);
  const c=compare(r),pr=PROFILES.find(p=>p.id===r.prof?.id),w=r.ghost?`your ${shortDate(r.ghost.started)} run`:'the pacer',W=w[0].toUpperCase()+w.slice(1);
  $('rpclab').textContent=r.ghost?'Past run':'Pacer';
  const a=Math.abs(c.diff),by=gapFmt(a);
  if(!r.complete){$('rbadge').textContent='📍';$('rtitle').textContent='Run saved';$('rsub').textContent=`${kmStr(c.d)} of ${kmStr(c.Pr.total)} km · ${c.diff<=0?`${by} ahead of`:`${by} behind`} ${w} there`}
  else if(a<0.5){$('rbadge').textContent='🤝';$('rtitle').textContent='Dead heat!';$('rsub').textContent=`You matched ${w} to the second`}
  else if(c.diff<0){$('rbadge').textContent='🏆';$('rtitle').textContent=`You beat ${w} by ${by}`;$('rsub').textContent=''}
  else{$('rbadge').textContent='🏃';$('rtitle').textContent=`${W} won by ${by}`;$('rsub').textContent=''}
  if(isBest(r))$('rsub').textContent=`New best on this route!${$('rsub').textContent?' · '+$('rsub').textContent:''}`;
  $('rsub').textContent+=`${$('rsub').textContent?' · ':''}${r.route.name} · ${r.ghost?'raced a past run':`${pr?pr.name:'Custom'} pacer`}${r.sim?' · simulated':''}`;
  $('ryou').textContent=fmt(c.you);$('rpacer').textContent=fmt(c.pacer);
  // Km by km: your split vs the pacer's for the same km
  let rows='<tr><th>Km</th><th>You</th><th>Pacer</th><th>±</th></tr>';
  const sp=r.rsplits||[],last=c.d;
  for(let k=0;k*1000<last-1;k++){
    const a0=k*1000,a1=Math.min((k+1)*1000,last),you=k<sp.length?(sp[k]-(sp[k-1]||0))/1000:(r.elapsed-(sp.at(-1)||0))/1000;
    const pc=timeAt(c.Pr,a1)-timeAt(c.Pr,a0),dd=you-pc;
    rows+=`<tr><td>${k+1}${a1-a0<999?` <small>(${kmStr(a1-a0)})</small>`:''}</td><td>${fmt(you)}</td><td>${fmt(pc)}</td><td class="${dd<-0.5?'faster':dd>0.5?'slower':''}">${dd<-0.5?'−':dd>0.5?'+':''}${gapFmt(Math.abs(dd))}</td></tr>`;
  }
  $('rkm').innerHTML=rows;
  const rp=r.rpe||[];$('rrpecard').hidden=!rp.length;
  if(rp.length){const I=INTENSITIES.find(x=>x.id===r.intensity);
    $('rrpe').innerHTML=`<tr><th>At</th><th>Felt</th><th>Plan</th><th></th></tr>`+rp.map(x=>{const ad=(r.adjust||[]).find(a=>Math.abs(a.rd-x.rd)<300);
      return `<tr><td>${kmStr(x.rd)} km</td><td>${x.said}</td><td>${Math.round(x.target)}</td><td>${ad?(ad.k<1?'sped up':'eased off'):x.said>x.target+0.9?'above':x.said<x.target-1.4?'below':'on plan'}</td></tr>`}).join('')+(I?`<tr><td colspan="4"><small>${I.name}</small></td></tr>`:'')}
  show('result');
}
function showRecordResult(r){
  $('rrpecard').hidden=true;
  const D=r.rd||0,t=r.elapsed/1000;
  $('rbadge').textContent='🗺️';$('rtitle').textContent='Route saved';
  $('rsub').textContent=`${r.route.name} · ${kmStr(D)} km · ${fmt(t)} · ${fmt(t/(D/1000))}/km${r.sim?' · simulated':''}. Race it any time, against a pacer or this run.`;
  $('ryou').textContent=fmt(t);
  let rows='<tr><th>Km</th><th>You</th><th>Pace</th></tr>';const sp=r.rsplits||[];
  for(let k=0;k*1000<D-1;k++){const a1=Math.min((k+1)*1000,D),len=a1-k*1000,you=k<sp.length?(sp[k]-(sp[k-1]||0))/1000:(r.elapsed-(sp.at(-1)||0))/1000;
    rows+=`<tr><td>${k+1}${len<999?` <small>(${kmStr(len)})</small>`:''}</td><td>${fmt(you)}</td><td>${fmt(you/(len/1000))}</td></tr>`}
  $('rkm').innerHTML=rows;show('result');
}
$('rrace').onclick=()=>{const r=routes.find(x=>x.id===shownRun.route.id);show('home');if(r){selectRoute(r);$('plan').scrollIntoView({behavior:'smooth'})}refreshHistory()};
$('rdone').onclick=()=>{show('home');refreshHistory()};
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
  const done=all.filter(r=>r.status==='done');
  $('noruns').hidden=done.length>0;
  $('runs').innerHTML=done.map(r=>{
    const c=compare(r),a=Math.abs(c.diff),w=r.ghost?`your ${shortDate(r.ghost.started)} run`:'the pacer';
    const res=c.record?`recorded this route · ${fmt(c.you/(c.d/1000||1))}/km`:r.complete?(a<0.5?`dead heat with ${w}`:c.diff<0?`beat ${w} by ${gapFmt(a)}`:`${r.ghost?'past run':'pacer'} won by ${gapFmt(a)}`)+(isBest(r)?' · 🏆 best':''):`stopped at ${kmStr(c.d)} km`;
    return `<li><button class="sel" data-id="${r.id}">${r.sim?'SIM · ':''}${esc(r.route?.name||'Recording')}<span class="meta">${when(r.started)} · ${fmt(c.you)}</span><span class="meta ${c.record?'':r.complete?(c.diff<0?'win':'lose'):''}">${res}</span></button><button class="del" data-id="${r.id}" aria-label="Delete run">✕</button></li>`;
  }).join('');
  $('runs').querySelectorAll('.sel').forEach(b=>b.onclick=()=>showResult(done.find(r=>r.id===+b.dataset.id)));
  $('runs').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this run?'))return;await deleteRun(+b.dataset.id);refreshHistory()});
  if(pending){const ago=Math.round((Date.now()-pending.saved)/60000);$('rsinfo').textContent=`${pending.route?.name||'Recording a new route'} · ${kmStr(pending.rd||0)} km · ${fmt((pending.elapsed||0)/1000)} · last saved ${ago<1?'just now':ago+' min ago'}`}
  $('resume').hidden=!pending;
}
$('rssave').onclick=async()=>{const r=pending;if(!r)return;r.status='done';r.running=false;r.complete=false;await saveRun(r);refreshHistory()};
$('rsdel').onclick=async()=>{if(!pending||!confirm('Discard this unfinished run?'))return;await deleteRun(pending.id);refreshHistory()};
$('rsgo').onclick=()=>{
  speaker.unlock();
  const r=pending;if(!r)return;$('resume').hidden=true;
  if(r.mode==='record'){
    enterRecord();
    trail=r.fixes.map(f=>({lat:f[2],lon:f[3],p:f[7]}));
  }else{
    if(r.intensity){o.intensity=r.intensity;o.rpe=true}
    enterRun(r.route,pacerFor(r),turnsFor(r.route),r.cond||null,r.prof,r.ghost?{id:r.ghost.runId,started:r.ghost.started}:null);
  }
  rec=r;rd=r.rd||0;rsplits=[...(r.rsplits||[])];track.dist=r.dist||0;matcher?.seed(rd,track.dist);shownD=rd;spokenSplits=rsplits.length;
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
    for(const r of d.runs||[]){if(haveRuns.some(x=>x.started===r.started))continue;const {id,...rest}=r;if(rest.route&&ids[rest.route.id]!=null)rest.route={...rest.route,id:ids[rest.route.id]};await saveRun(rest);nu++}
    if(d.options&&Object.keys(d.options).length&&confirm('Also restore your settings from the backup?'))for(const [k,v] of Object.entries(d.options))try{localStorage.setItem(k,v)}catch(err){}
    alert(`Restored ${nr} route${nr===1?'':'s'} and ${nu} run${nu===1?'':'s'}.`);location.reload();
  }catch(err){alert('Could not restore: '+err.message)}
};

initHome();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
