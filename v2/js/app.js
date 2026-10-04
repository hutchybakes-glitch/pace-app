// Pacer (v2): race a virtual pacer who runs the route at a gradient-aware pace.
// Screens: Home (route, target, pacer profile, options, history) → Run (full-screen view,
// you vs pacer) → Result.
import {createTrack,watch,fitPace,speedPace} from './gps.js';
import {parseGPX,resample,fillElevation} from './route.js';
import {createMatcher} from './match.js';
import {turnsFor,nextTurn,turnText,inDist} from './nav.js';
import {createStartGate,compass} from './start.js';
import {buildPacer,timeAt,distAt,paceAt,avgBetween,extremes,gradeColor,PROFILES,TRAIT_NAMES} from './pacer.js';
import {createView} from './view.js';
import {saveRoute,listRoutes,deleteRoute,saveRun,listRuns,deleteRun,opt,importV1Routes} from './store.js';
import {SIM,SPEED,now,every,sim,simWatch} from './sim.js';

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
let routes=[],route=null,P=null,turns=[];
let prof=opt.get('profile',{id:'even',climb:'average',descent:'average',strategy:'even'});
const o={speed:opt.get('speed',false),auto:opt.get('auto',true),zone:opt.get('zone',25),view:opt.get('view','map')};
const finishFor=r=>opt.get('finish:'+r.id,Math.round(r.pts.at(-1).d/1000*300/15)*15); // default 5:00/km
const msg=(t,err)=>{$('msg').textContent=t;$('msg').className=err?'err':''};
if(SIM)document.querySelector('.brand h1').textContent='Pacer · SIM';

async function initHome(){
  try{const n=await importV1Routes();if(n)msg(`Brought over ${n} route${n>1?'s':''} from Pace v1.`)}catch(e){}
  routes=(await listRoutes()).sort((a,b)=>b.created-a.created);
  selectRoute(routes.find(r=>r.id===opt.get('route',null))||routes[0]||null);
  refreshHistory();
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
  $('routes').innerHTML=routes.map(r=>`<li class="${route?.id===r.id?'on':''}"><button class="sel" data-id="${r.id}">${esc(r.name)}<span class="meta">${kmStr(r.pts.at(-1).d)} km${r.from==='v1'?' · from v1':''}</span></button><button class="del" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">✕</button></li>`).join('');
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
  if(r){turns=turnsFor(r);rebuild()}
}

// Rebuild the pacer after any change of route, target or profile
function rebuild(){
  const fin=finishFor(route);
  P=buildPacer(route.pts,fin,prof);
  const D=P.total,up=P.es.reduce((a,e,i)=>a+(i&&e>P.es[i-1]?e-P.es[i-1]:0),0);
  $('rname').textContent=route.name;
  $('rchips').innerHTML=[`${kmStr(D)} km`,`${Math.round(up)} m climb`,`${turns.length} turns`,`elevation: ${route.src}`].map(t=>`<span>${esc(t)}</span>`).join('');
  $('v-finish').textContent=fmt(fin);$('v-pace').textContent=fmt(fin/(D/1000));
  renderProfiles();drawPlanMap();drawPlanChart();
  const e=extremes(P),g=x=>`${x>0?'+':''}${x.toFixed(1)} %`;
  const pr=PROFILES.find(p=>p.id===prof.id);
  $('pinsight').innerHTML=`${pr?esc(pr.desc)+'<br>':''}Slowest <b>${fmt(e.slow.pace)}</b>/km on the ${g(e.slow.grade)} at ${kmStr(e.slow.d)} km · quickest <b>${fmt(e.fast.pace)}</b>/km on the ${g(e.fast.grade)} at ${kmStr(e.fast.d)} km. Finishes in <b>${fmt(fin)}</b>.`;
}

function drawPlanMap(){
  const pts=route.pts,k=Math.cos(pts[0].lat*Math.PI/180)*111195,xy=pts.map(p=>[p.lon*k,-p.lat*111195]);
  const xs=xy.map(q=>q[0]),ys=xy.map(q=>q[1]),x0=Math.min(...xs),y0=Math.min(...ys),w=Math.max(...xs)-x0,h=Math.max(...ys)-y0,pad=Math.max(w,h)*0.06+10;
  const X=q=>(q[0]-x0).toFixed(1)+','+(q[1]-y0).toFixed(1);
  let s=`<polyline points="${xy.map(X).join(' ')}" fill="none" stroke="#020617" stroke-width="10" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  for(let i=0;i<pts.length-1;i++)s+=`<line x1="${X(xy[i]).replace(',','" y1="')}" x2="${X(xy[i+1]).replace(',','" y2="')}" stroke="${gradeColor(P.grade[i])}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const r=Math.max(w,h)*0.014+4,dot=(q,c)=>{const [x,y]=X(q).split(',');return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`};
  s+=dot(xy.at(-1),'#fff')+dot(xy[0],'#22c55e');
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

function renderOptions(){
  $('o-speed').querySelectorAll('button').forEach(b=>{b.classList.toggle('on',(b.dataset.v==='1')===o.speed);b.onclick=()=>{o.speed=b.dataset.v==='1';opt.set('speed',o.speed);renderOptions()}});
  $('o-auto').classList.toggle('on',o.auto);$('o-auto').setAttribute('aria-checked',o.auto);
  $('o-auto').onclick=()=>{o.auto=!o.auto;opt.set('auto',o.auto);renderOptions()};
  $('o-zone').querySelector('b').textContent=`${o.zone} m`;
  $('o-zone').querySelectorAll('button').forEach(b=>b.onclick=()=>{o.zone=Math.max(10,Math.min(100,o.zone+ +b.dataset.d));opt.set('zone',o.zone);renderOptions()});
}
renderOptions();

$('race').onclick=()=>{if(route&&P)enterRun()};

// =====================================================================================
// Run
// =====================================================================================
const view=createView($('cv'));
const track=createTrack();
// phase: idle → armed (heading to the start) → running ⇄ paused → done
let phase='idle',acc=0,t0=0,wid=null,lock=null;
let matcher=null,rd=0,rsplits=[],rpts=[],spts=[],curPace=null,vNow=0,lastFixAt=0,lastLL=null,offRoute=false;
let gate=null,rec=null,dirty=false,saving=Promise.resolve(),runP=null,runRoute=null,runTurns=[];
let shownD=0,raf=0,lastFrame=0;
const el=()=>acc+(phase==='running'?now()-t0:0); // pause-aware elapsed ms
const ROUTE_WINDOW=20000,AUTOSAVE=10000,RESUME_GAP=15*60000;

function enterRun(r=route,p=P,tr=turns){
  runRoute=r;runP=p;runTurns=tr;
  resetRun();
  view.setRoute(r.pts,p,tr);
  show('run');layout();setView(o.view);
  cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
function resetRun(){
  phase='idle';acc=0;track.reset();rd=0;rsplits=[];rpts=[];spts=[];curPace=null;vNow=0;shownD=0;offRoute=false;
  rec=null;dirty=false;gate=null;sim.restart=true;sim.moving=false;
  matcher=createMatcher(runRoute.pts);
  $('off').hidden=true;$('arm').hidden=true;
  setPhaseUI();hud();
}
function layout(){
  view.resize();
  const top=document.querySelector('.ovtop .row2').getBoundingClientRect().bottom,bot=$('sheet').getBoundingClientRect().height;
  view.setInsets(top+6,bot);
}
addEventListener('resize',()=>{if(!$('run').hidden)layout()});
function setView(m){o.view=m;opt.set('view',m);$('views').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===m))}
$('views').querySelectorAll('button').forEach(b=>b.onclick=()=>setView(b.dataset.v));

function setPhaseUI(){
  const go=$('go');go.className='btn go';
  go.textContent={idle:'Start',armed:'Cancel',running:'Pause',paused:'Resume',done:'Start'}[phase];
  if(phase==='running')go.classList.add('pause');if(phase==='armed')go.classList.add('cancel');
  $('finbtn').disabled=phase!=='paused';
  $('back').hidden=phase==='running'||phase==='armed';
}

// ---- GPS ----
const gpsErr=e=>{$('gpsline').textContent='GPS error: '+e.message};
function ensureWatch(){if(wid===null)wid=SIM?simWatch(()=>runRoute&&runP?{route:runRoute,P:runP}:null,onPos,gpsErr):watch(onPos,gpsErr)}

function onPos(p){
  const c=p.coords;
  $('gpsline').textContent=`GPS ±${Math.round(c.accuracy)} m`+(SIM?` · SIM ${SPEED}×`:'');
  if(c.accuracy<=50)lastLL={lat:c.latitude,lon:c.longitude};
  if(phase==='armed')armFix(p);
  if(phase!=='running')return;
  const t=el();
  if(!track.add(c,p.timestamp,t))return;
  const m=matcher.update(c.latitude,c.longitude,track.dist);
  rd=m.d;offRoute=m.off;
  $('off').hidden=!m.off;$('off').textContent=(m.matched?'Off route':'Not on the route yet')+' · using GPS distance';
  while(rd>=(rsplits.length+1)*1000)rsplits.push(t);
  rpts.push({t,d:rd});if(c.speed!=null&&c.speed>=0)spts.push({t,v:c.speed});
  rpts=rpts.filter(q=>t-q.t<=ROUTE_WINDOW);spts=spts.filter(q=>t-q.t<=ROUTE_WINDOW);
  curPace=(o.speed&&speedPace(spts))||fitPace(rpts);
  vNow=curPace?1000/curPace:0;lastFixAt=now();
  rec.fixes.push([p.timestamp,t,c.latitude,c.longitude,c.accuracy,track.dist,rd,curPace]);dirty=true;
  if(rd>=runP.total-8)finishRun(true);
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
  if(!rec)rec={started:Date.now(),status:'active',sim:SIM,route:{id:runRoute.id,name:runRoute.name,src:runRoute.src,pts:runRoute.pts,cues:runRoute.cues||[]},
    finish:runP.finish,prof:{...prof},speed:o.speed,fixes:[]};
  phase='running';t0=at??now();track.last=null;rpts=[];spts=[];sim.moving=true;
  ensureWatch();wake();setPhaseUI();
}
function pause(){acc=el();phase='paused';sim.moving=false;lock?.release();lock=null;setPhaseUI();save()}
$('go').onclick=()=>{
  if(phase==='running')pause();
  else if(phase==='armed')disarm();
  else if(phase==='idle')o.auto?arm():start();
  else if(phase==='paused')start(now());
};
$('finbtn').onclick=async()=>{
  if(phase!=='paused')return;
  if(!worth(rec)){if(!confirm('Nothing much recorded yet. Discard this run?'))return;if(rec?.id)await deleteRun(rec.id);resetRun();return}
  if(!confirm('Finish here and save this run?'))return;
  finishRun(false);
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
  acc=el();phase='done';sim.moving=false;lock?.release();lock=null;
  if(complete)rd=runP.total;
  snapshot();Object.assign(rec,{status:'done',running:false,complete});
  await saving;rec.id=await saveRun(rec);
  cancelAnimationFrame(raf);showResult(rec);
}

// ---- Frame loop: smooth movement between GPS fixes ----
function loop(ts){
  raf=requestAnimationFrame(loop);
  if(ts-lastFrame<33)return;lastFrame=ts;
  let target=rd;
  if(phase==='running'&&lastFixAt)target=Math.min(runP.total,rd+Math.min(3,(now()-lastFixAt)/1000)*vNow);
  shownD=Math.abs(target-shownD)>60?target:shownD+(target-shownD)*0.25;
  const started=phase==='running'||phase==='paused'||phase==='done';
  view.draw({mode:o.view,you:started?shownD:0,pacer:started?distAt(runP,el()/1000):0,gps:(!started||offRoute)?lastLL:null});
}

// ---- Heads-up numbers, turn card, gap ----
function hud(){
  if($('run').hidden||!runP)return;
  const t=el()/1000,D=runP.total,started=phase==='running'||phase==='paused';
  $('tm').textContent=fmt(t);$('km').textContent=kmStr(rd);$('togo').textContent=kmStr(Math.max(0,D-rd));
  const cls=(id,you,pc)=>{$(id).className=you&&pc?(you<pc-1?'faster':you>pc+1?'slower':''):''};
  if(started&&rd>20){
    const pd=distAt(runP,t),k0=rsplits.length*1000,tk=(rsplits.at(-1)||0)/1000;
    const ky=rd-k0>50?(t-tk)/((rd-k0)/1000):null,kp=rd-k0>50?avgBetween(runP,k0,rd):null;
    const ay=t/(rd/1000),ap=timeAt(runP,rd)/(rd/1000),pp=paceAt(runP,pd);
    $('cy').textContent=fmtP(curPace);$('cp').textContent=fmtP(pp);cls('cy',curPace,paceAt(runP,rd));
    $('ky').textContent=fmtP(ky);$('kp').textContent=fmtP(kp);cls('ky',ky,kp);
    $('ay').textContent=fmtP(ay);$('ap').textContent=fmtP(ap);cls('ay',ay,ap);
    const tg=t-timeAt(runP,rd),dg=pd-rd,g=$('gap');
    if(Math.abs(tg)<0.5){g.className='gap';g.textContent='Level with the pacer'}
    else if(tg<0){g.className='gap lead';g.textContent=`You lead · ${gapFmt(-tg)} · ${Math.round(Math.abs(dg))} m`}
    else{g.className='gap behind';g.textContent=`Pacer leads · ${gapFmt(tg)} · ${Math.round(Math.abs(dg))} m`}
  }else{
    for(const id of ['cy','ky','ay','kp','ap'])$(id).textContent='--:--';
    $('cp').textContent=fmtP(paceAt(runP,0));
    $('gap').className='gap';$('gap').textContent=phase==='armed'?'Pacer waiting at the start':started?'And you\'re off…':'Pacer ready at the start';
  }
  // Next turn
  const nt=nextTurn(runTurns,rd),left=(nt?nt.d:D)-rd;
  $('ticon').innerHTML=turnIcon(nt);$('ttext').textContent=nt?turnText(nt):'Finish';
  let dist=inDist(Math.max(0,left));
  if(nt?.kind==='uturn'&&dist==='now'&&lastLL){ // "now" only when you're physically at the turnaround
    const tp=runRoute.pts[Math.min(runRoute.pts.length-1,Math.round(nt.d/10))],k=Math.cos(tp.lat*Math.PI/180)*111195;
    if(Math.hypot((lastLL.lon-tp.lon)*k,(lastLL.lat-tp.lat)*111195)>25)dist='in 20 m';
  }
  $('tdist').textContent=dist;$('turn').className=left<=60?'soon':'';
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
function compare(r){
  const Pr=buildPacer(r.route.pts,r.finish,r.prof),you=r.elapsed/1000,d=r.complete?Pr.total:r.rd,pacer=timeAt(Pr,d);
  return {Pr,you,pacer,d,diff:you-pacer};
}
function showResult(r){
  shownRun=r;const c=compare(r),pr=PROFILES.find(p=>p.id===r.prof.id);
  const a=Math.abs(c.diff),by=gapFmt(a);
  if(!r.complete){$('rbadge').textContent='📍';$('rtitle').textContent='Run saved';$('rsub').textContent=`${kmStr(c.d)} of ${kmStr(c.Pr.total)} km · ${c.diff<=0?`${by} ahead of`:`${by} behind`} the pacer there`}
  else if(a<0.5){$('rbadge').textContent='🤝';$('rtitle').textContent='Dead heat!';$('rsub').textContent='You matched the pacer to the second'}
  else if(c.diff<0){$('rbadge').textContent='🏆';$('rtitle').textContent=`You beat the pacer by ${by}`;$('rsub').textContent=''}
  else{$('rbadge').textContent='🏃';$('rtitle').textContent=`The pacer won by ${by}`;$('rsub').textContent=''}
  $('rsub').textContent+=`${$('rsub').textContent?' · ':''}${r.route.name} · ${pr?pr.name:'Custom'} pacer${r.sim?' · simulated':''}`;
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
  show('result');
}
$('rdone').onclick=()=>{show('home');refreshHistory()};
$('rgpx').onclick=()=>{
  const r=shownRun,name=`pacer-${new Date(r.started).toISOString().slice(0,16).replace(/[:T]/g,'-')}.gpx`;
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
  const all=(await listRuns()).sort((a,b)=>b.started-a.started);
  pending=all.find(r=>r.status==='active'&&r!==rec&&r.id!==rec?.id)||null;
  const done=all.filter(r=>r.status==='done');
  $('noruns').hidden=done.length>0;
  $('runs').innerHTML=done.map(r=>{
    const c=compare(r),a=Math.abs(c.diff),when=new Date(r.started).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
    const res=r.complete?(a<0.5?'dead heat with the pacer':c.diff<0?`beat the pacer by ${gapFmt(a)}`:`pacer won by ${gapFmt(a)}`):`stopped at ${kmStr(c.d)} km`;
    return `<li><button class="sel" data-id="${r.id}">${r.sim?'SIM · ':''}${esc(r.route.name)}<span class="meta">${when} · ${fmt(c.you)}</span><span class="meta ${r.complete?(c.diff<0?'win':'lose'):''}">${res}</span></button><button class="del" data-id="${r.id}" aria-label="Delete run">✕</button></li>`;
  }).join('');
  $('runs').querySelectorAll('.sel').forEach(b=>b.onclick=()=>showResult(done.find(r=>r.id===+b.dataset.id)));
  $('runs').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this run?'))return;await deleteRun(+b.dataset.id);refreshHistory()});
  if(pending){const ago=Math.round((Date.now()-pending.saved)/60000);$('rsinfo').textContent=`${pending.route.name} · ${kmStr(pending.rd||0)} km · ${fmt((pending.elapsed||0)/1000)} · last saved ${ago<1?'just now':ago+' min ago'}`}
  $('resume').hidden=!pending;
}
$('rssave').onclick=async()=>{const r=pending;if(!r)return;r.status='done';r.running=false;r.complete=false;await saveRun(r);refreshHistory()};
$('rsdel').onclick=async()=>{if(!pending||!confirm('Discard this unfinished run?'))return;await deleteRun(pending.id);refreshHistory()};
$('rsgo').onclick=()=>{
  const r=pending;if(!r)return;$('resume').hidden=true;
  const Pr=buildPacer(r.route.pts,r.finish,r.prof);
  enterRun(r.route,Pr,turnsFor(r.route));
  rec=r;rd=r.rd||0;rsplits=[...(r.rsplits||[])];track.dist=r.dist||0;matcher.seed(rd,track.dist);shownD=rd;
  sim.jump=rd;
  const gap=(Date.now()-r.saved)*SPEED,last=r.fixes.at(-1);
  if(r.running&&gap<RESUME_GAP){acc=r.elapsed+gap;start(now());if(last)track.last={lat:last[2],lon:last[3],t:last[0]}}
  else{acc=r.elapsed;phase='paused';setPhaseUI()}
};

initHome();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
