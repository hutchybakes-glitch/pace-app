import {createTrack,watch,fitPace,speedPace,WINDOW} from './gps.js';
import {fmt,segAt,timeAt,band,hysteresis,perKm} from './pacing.js';
import {kmPaces,renderChart} from './chart.js';
import {createMatcher} from './match.js';
import {initSetup,selected,refreshRoute,routePreview} from './setup.js';
import {ICON,NAME,SEGCOL,analyse} from './route.js';
import {initSettings,settings,routeOpts} from './settings.js';
import {initHistory,refreshHistory,settlePending,showRun} from './history.js';
import {saveRun,deleteRun} from './storage.js';
import {I,worthKeeping} from './record.js';
import {SIM,SPEED,now,every,sim,simWatch} from './sim.js';
import {createStartGate,compass} from './start.js';
import {turnsFor,nextTurn,turnText,inDist} from './nav.js';

// State: running flag, banked ms, segment start, watch id, wake lock, draw tick
let run=false,acc=0,t0=0,wid=null,lock=null,tick=0;
const track=createTrack();
// Route mode: active = {route,plan,pace,S,amber,speed,kmT} from Setup (null = free run; kmT = per-km targets;
// speed = current pace from GPS speed), matcher, route distance, km split times by route distance,
// recent {t,d} by route distance, recent {t,v} GPS speeds, colour hysteresis
let active=null,matcher=null,rd=0,rsplits=[],rpts=[],spts=[],hyst=hysteresis(2);
// Recording: rec = run record being written (see record.js), dirty = unsaved fixes, saving = save queue
let rec=null,dirty=false,saving=Promise.resolve();
// Start gate: armed = Start pressed on a route run, waiting for the runner to cross the start line
let armed=false,gate=null;
const ROUTE_WINDOW=20000,ROUTE_EVERY=2; // route mode: 20 s rolling pace (fitted, route distance), a reading every 2 s
const AUTOSAVE=10000,RESUME_GAP=15*60000; // autosave interval; a reload within this keeps the clock running
const $=id=>document.getElementById(id);
const pace=(sec,km)=>km>0.005&&sec/km<1800?fmt(sec/km):'--:--';
const el=()=>acc+(run?now()-t0:0); // pause-aware elapsed ms

function onPos(p){
  $('gps').textContent=`GPS accuracy: ±${Math.round(p.coords.accuracy)} m`;
  if(p.coords.accuracy<=50)lastLL={lat:p.coords.latitude,lon:p.coords.longitude};
  if(armed)armFix(p);
  if(!run)return;
  const t=el(),c=p.coords;
  if(!track.add(c,p.timestamp,t))return;
  let seg=null,tgt=null,cur=null,b=null;
  if(matcher){
    const m=matcher.update(c.latitude,c.longitude,track.dist);
    rd=m.d;rpts.push({t,d:rd});
    while(rd>=(rsplits.length+1)*1000)rsplits.push(t); // km split times by route distance
    $('off').hidden=!m.off;
    $('off').textContent=(m.matched?'Off route':'Not on route yet')+' · using GPS distance';
    if(c.speed!=null&&c.speed>=0)spts.push({t,v:c.speed});
    seg=segAt(active.plan.segs,rd);tgt=active.plan.segs[seg].target;cur=routePace(t);
    b=cur?band(cur,tgt,active.S,active.amber):null;
  }else{
    const o=track.pts.find(q=>t-q.t<=WINDOW),dd=o?track.dist-o.d:0;
    cur=dd>5&&(t-o.t)/dd<1800?(t-o.t)/dd:null; // ms per m = s per km
  }
  rec.fixes.push([p.timestamp,t,c.latitude,c.longitude,c.accuracy,track.dist,matcher?rd:null,seg,cur,tgt,b]);
  dirty=true;
}

// Route-mode current pace over the last 20 s: fitted on route distance, or mean GPS speed if chosen
// (falls back to the fit when the device gives no speed)
function routePace(t){
  rpts=rpts.filter(q=>t-q.t<=ROUTE_WINDOW);spts=spts.filter(q=>t-q.t<=ROUTE_WINDOW);
  return (active.speed&&speedPace(spts))||fitPace(rpts);
}

// Course strip: route profile coloured by segment; the part already run is dimmed
function drawStrip(){
  const pts=active.route.pts,es=analyse(pts,routeOpts(settings())).es,total=pts.at(-1).d,segs=active.plan.segs;
  const lo=Math.min(...es),hi=Math.max(...es),span=Math.max(hi-lo,15);
  const X=d=>(d/total*1000).toFixed(1),Y=e=>(38-(e-lo)/span*30).toFixed(1);
  $('strip').innerHTML=segs.map(x=>{let q=`${X(x.d0)},40 `;for(let i=x.i0;i<=x.i1;i++)q+=`${X(pts[i].d)},${Y(es[i])} `;return `<polygon points="${q}${X(x.d1)},40" fill="${SEGCOL[x.cls]}"/>`}).join('')+
    `<rect id="sdone" x="0" y="0" height="40" width="0" fill="#000" fill-opacity=".55"/><line id="spos" y1="0" y2="40" stroke="#fff" stroke-width="3" vector-effect="non-scaling-stroke"/>`;
}

// Background colour from current pace vs the current segment target; null = neutral
function setStatus(cur){
  const s=active.plan.segs[segAt(active.plan.segs,rd)];
  const shown=hyst(cur==null?null:band(cur,s.target,active.S,active.amber));
  document.body.className=shown?'st '+shown:'';
}

function drawRoute(t){
  const segs=active.plan.segs,i=segAt(segs,rd),s=segs[i],n=segs[i+1];
  $('tgt').textContent=fmt(s.target);
  $('seg').textContent=`${ICON[s.cls]} ${NAME[s.cls]} · ${Math.max(0,Math.round(s.d1-rd))} m left`;
  $('nxt').textContent=n?`Next: ${ICON[n.cls]} ${NAME[n.cls]} ${Math.round(n.len)} m · target ${fmt(n.target)}`:'Next: finish';
  const dl=t/1000-timeAt(segs,rd); // + = behind plan
  $('dlab').textContent=Math.abs(dl)<0.5?'On plan':dl>0?'Behind plan':'Ahead of plan';
  $('dl').textContent=(dl>=0.5?'+':dl<=-0.5?'−':'')+fmt(Math.abs(dl));
  $('ckm').textContent=pace((t-(rsplits.at(-1)||0))/1000,(rd-rsplits.length*1000)/1000);
  updateNav();
  const x=(rd/active.route.pts.at(-1).d*1000).toFixed(1);
  $('sdone')?.setAttribute('width',x);$('spos')?.setAttribute('x1',x);$('spos')?.setAttribute('x2',x);
  if(!$('run').hidden){
    const paces=kmPaces(rsplits,t,rd);
    renderChart($('chart'),{targets:active.kmT,paces,live:paces.length>rsplits.length,S:active.S,amber:active.amber});
  }
}

function draw(){
  const t=el(),km=(matcher?rd:track.dist)/1000;
  $('tm').textContent=fmt(t/1000);
  $('km').textContent=km.toFixed(2);
  $('avg').textContent=pace(t/1000,km);
  if(tick++%(matcher?ROUTE_EVERY:5)===0){         // current pace every 5 s (free) / 2 s (route)
    if(matcher){
      const cur=routePace(t);
      $('cur').textContent=cur?fmt(cur):'--:--';
      setStatus(run?cur:null);
    }else{
      const r=track.rolling(t,WINDOW);
      $('cur').textContent=r?pace(r.sec,r.km):'--:--';
    }
  }
  if(matcher)drawRoute(t);
  const sp=matcher?rsplits:track.splits;
  $('sp').innerHTML=sp.map((s,i)=>`Km ${i+1}: ${fmt((s-(sp[i-1]||0))/1000)}`).join('<br>');
}
every(1000,draw);

// ---- Recording ----
function newRecord(){
  rec={started:Date.now(),status:'active',sim:SIM,fixes:[],
    route:active?{id:active.route.id,name:active.route.name,src:active.route.src,pts:active.route.pts,cues:active.route.cues||[]}:null,
    segs:active?active.plan.segs:null,pace:active?.pace??null,S:active?.S??null,amber:active?.amber??null,speed:active?.speed??false};
}
// Copy live state into the record
function snapshot(){
  Object.assign(rec,{elapsed:el(),running:run,dist:track.dist,splits:[...track.splits],rd,rsplits:[...rsplits],saved:Date.now()});
}
// Saves are queued so the first put's id is known before the next one
function save(){
  if(!rec)return saving;
  snapshot();dirty=false;
  const r=rec;
  return saving=saving.then(()=>saveRun(r)).then(id=>{r.id=id}).catch(e=>{dirty=true;$('gps').textContent='Autosave failed: '+e.message});
}
every(AUTOSAVE,()=>{if(dirty)save()});
addEventListener('pagehide',()=>{if(rec)save()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&rec)save()});

// Finish the current run: saved to history if it recorded anything, otherwise dropped
async function endRun(){
  if(!rec)return;
  snapshot();
  const r=rec;rec=null;dirty=false;
  await saving;
  if(worthKeeping(r)){r.status='done';r.running=false;r.id=await saveRun(r);return r.id}
  if(r.id)await deleteRun(r.id);
}

// ---- Navigation: next turn card and mini map ----
// turns = this route's turns (nav.js); mm = mini-map projection; lastLL = latest GPS position
let turns=[],mm=null,lastLL=null;
let miniClose=(()=>{try{return localStorage.getItem('miniClose')==='1'}catch(e){return false}})();
const MINI_HALF=350; // close-up: metres either side of you

// Arrow for a turn of `a`° (+ right), a looped arrow for U-turns, in a 48×48 box
function turnIcon(t){
  const S='fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
  if(!t)return `<path d="M15 44V6" ${S}/><path d="M15 8h22l-5 7 5 7H15" fill="currentColor"/>`; // finish flag
  if(t.kind==='uturn'){
    const s=t.dir==='left'?1:-1,x1=24+7*s,x2=24-7*s;
    return `<path d="M${x1} 44V20a7 7 0 0 ${s===1?0:1} ${-14*s} 0v6" ${S}/><path d="M${x2-7} 25l7 10 7-10z" fill="currentColor"/>`;
  }
  const r=t.angle*Math.PI/180,sx=Math.sin(r),cy=Math.cos(r);
  const ex=24+13*sx,ey=24-13*cy,tx=24+23*sx,ty=24-23*cy,px=7*cy,py=7*sx;
  return `<path d="M24 45V24L${ex.toFixed(1)} ${ey.toFixed(1)}" ${S}/><path d="M${tx.toFixed(1)} ${ty.toFixed(1)}L${(ex+px).toFixed(1)} ${(ey+py).toFixed(1)}L${(ex-px).toFixed(1)} ${(ey-py).toFixed(1)}z" fill="currentColor"/>`;
}

function setupNav(){
  const pts=active.route.pts,k=Math.cos(pts[0].lat*Math.PI/180)*111195;
  turns=turnsFor(active.route);
  const P=p=>[p.lon*k,-p.lat*111195],xy=pts.map(P);
  const xs=xy.map(q=>q[0]),ys=xy.map(q=>q[1]),x0=Math.min(...xs),y0=Math.min(...ys);
  mm={P,xy,box:[x0,y0,Math.max(...xs)-x0,Math.max(...ys)-y0]};
  const line=xy.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
  $('mini').innerHTML=`<polyline points="${line}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`+
    `<polyline id="mdone" fill="none" stroke="#4ade80" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`+
    `<circle id="mturn" fill="#facc15" stroke="#000" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`+
    `<circle id="mpos" fill="#fff" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
}

function updateNav(){
  if(!mm)return;
  const pts=active.route.pts,total=pts.at(-1).d,t=nextTurn(turns,rd),left=(t?t.d:total)-rd;
  $('ticon').innerHTML=turnIcon(t);
  $('ttext').textContent=t?turnText(t):'Finish';
  $('tdist').textContent=inDist(Math.max(0,left));
  $('nav').className=left<=60?'soon':'';
  // Mini map: done part, next turn, you
  const n=Math.min(pts.length-1,Math.floor(rd/10));
  $('mdone').setAttribute('points',mm.xy.slice(0,n+1).map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' '));
  const me=lastLL?mm.P(lastLL):mm.xy[n];
  let [bx,by,bw,bh]=mm.box;
  if(miniClose){bx=me[0]-MINI_HALF;by=me[1]-MINI_HALF;bw=bh=2*MINI_HALF}
  const pad=Math.max(bw,bh)*0.1+10,vw=Math.max(bw,bh)+2*pad;
  $('mini').setAttribute('viewBox',`${(bx+bw/2-vw/2).toFixed(1)} ${(by+bh/2-vw/2).toFixed(1)} ${vw.toFixed(1)} ${vw.toFixed(1)}`);
  const set=(id,q,r)=>{$(id).setAttribute('cx',q[0].toFixed(1));$(id).setAttribute('cy',q[1].toFixed(1));$(id).setAttribute('r',(vw*r).toFixed(1))};
  set('mpos',me,0.055);
  if(t){set('mturn',mm.xy[Math.min(pts.length-1,Math.round(t.d/10))],0.04);$('mturn').style.display=''}else $('mturn').style.display='none';
}
$('mini').onclick=()=>{miniClose=!miniClose;try{localStorage.setItem('miniClose',miniClose?'1':'0')}catch(e){};updateNav()};

// ---- Start gate ----
// Guide the runner to the start; the clock starts as they cross the line, back-dated to the crossing
function arm(){
  armed=true;gate=createStartGate(active.route.pts,{zone:settings().zone});
  if(SIM){sim.jump=-150;sim.moving=true}
  if(wid===null)wid=SIM?simWatch(()=>active||selected(),onPos,gpsErr):watch(onPos,gpsErr);
  $('arm').className='far';$('armh').textContent='Finding your position…';$('armdist').textContent='';$('arms').textContent='';
  $('armarrow').style.visibility='hidden';
  $('arm').hidden=false;$('back').hidden=true;
  $('go').textContent='Cancel';$('go').style.background='#333';$('rs').disabled=true;
  wake();
}
function disarm(){
  armed=false;gate=null;sim.moving=false;$('arm').hidden=true;$('rs').disabled=false;
  $('go').textContent='Start';$('go').style.background='';
}
function armFix(p){
  const c=p.coords,g=gate.update(c.latitude,c.longitude,c.accuracy,p.timestamp);
  if(g.state==='go'){
    disarm();
    const t=now();start(Math.min(t,Math.max(g.crossTs,t-60000))); // trust the crossing time, within reason
    return;
  }
  const head=c.heading!=null&&!isNaN(c.heading)&&c.speed>0.8?c.heading:null; // direction of travel, when moving
  const rel=head==null?null:(g.bearing-head+360)%360;
  const T={weak:['Waiting for GPS',`Accuracy ±${Math.round(g.acc)} m · needs ±20 m or better`],
    far:['Head to the start',''],
    ready:['At the start ✓','Clock starts as you cross the start line'],
    crossing:['At the start ✓','Crossing the line…'],
    past:["You're over the start line",'Step back behind it, or tap Start now']}[g.state];
  $('arm').className=g.state==='crossing'?'ready':g.state;
  $('armh').textContent=T[0];
  $('armdist').textContent=g.state==='weak'?'':`${Math.round(g.dist)} m`;
  $('arms').textContent=g.state==='far'?(rel==null?`Start is ${compass(g.bearing)} of you`:
    rel<30||rel>330?'Straight ahead':rel<150?'Ahead to your right':rel<=210?'Behind you':'Ahead to your left'):T[1];
  $('armarrow').style.visibility=g.state==='far'&&rel!=null?'visible':'hidden';
  if(rel!=null)$('armarrow').style.transform=`rotate(${rel}deg)`;
}
$('armgo').onclick=()=>{disarm();start()};

// ---- Run controls ----
async function wake(){try{lock=await navigator.wakeLock?.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(run&&document.visibilityState==='visible')wake()});

const neutral=()=>{hyst=hysteresis(2);document.body.className=''};
const gpsErr=e=>$('gps').textContent='GPS error: '+e.message;

// at = when the clock started (start-line crossing), default now
function start(at){
  if(!rec){newRecord();settlePending().catch(()=>{})}
  run=true;t0=at??now();track.last=null;tick=0;rpts=[];spts=[];sim.moving=true;
  if(wid===null)wid=SIM?simWatch(()=>active||selected(),onPos,gpsErr):watch(onPos,gpsErr);
  $('back').hidden=true;
  wake();$('go').textContent='Pause';$('go').style.background='#b35900';
}
function pause(){
  acc=el();run=false;sim.moving=false;lock?.release();lock=null;$('back').hidden=false;neutral();
  $('go').textContent='Resume';$('go').style.background='#1a7f37';
  save();
}
$('go').onclick=()=>run?pause():armed?disarm():matcher&&!rec&&settings().autoStart?arm():start();

function resetRun(){
  if(armed)disarm();
  acc=0;tick=0;track.reset();rd=0;rsplits=[];rpts=[];spts=[];rec=null;dirty=false;sim.restart=true;
  matcher=active?createMatcher(active.route.pts):null;
  neutral();$('off').hidden=true;
  $('go').textContent='Start';$('go').style.background='#1a7f37';$('cur').textContent='--:--';draw();
}
$('rs').onclick=async()=>{
  if(run||armed)return;
  if(rec){snapshot();if(worthKeeping(rec)){
    if(!confirm('Finish and save this run?'))return;
    const id=await endRun();resetRun();await refreshHistory();showRun(id);show('setup');return;
  }}
  if(!confirm('Reset run?'))return;
  await endRun();resetRun();
};

// ---- Screens ----
const show=id=>{for(const s of ['setup','settings','run'])$(s).hidden=s!==id;scrollTo(0,0)};
function applyActive(){
  $('rt').hidden=$('chart').hidden=!active;
  if(active){$('chkey').textContent=`▲ faster · band ±${active.S} s`;drawStrip();setupNav()}else mm=null;
  $('rlabel').textContent=(SIM?`SIM ${SPEED}× · `:'')+(active?`${active.route.name} · target ${fmt(active.pace)} /km · ±${active.S} s`+(active.speed?' · GPS speed':''):'');
}
initSetup({onSettings:()=>openSettings(),onStart:async sel=>{
  const same=(sel?.route.id)===(active?.route.id);
  if(!same&&acc>0){
    if(!confirm('Finish and save the current run, and start a new one?'))return;
    await endRun();refreshHistory();
  }
  active=sel&&{...sel,kmT:perKm(sel.plan.segs).map(k=>k.target)};
  if(!same)resetRun();
  applyActive();show('run');draw();
}});
$('back').onclick=()=>{if(!run&&!armed){neutral();refreshHistory();show('setup')}};
const fillSettings=initSettings({onChange:refreshRoute,preview:routePreview});
function openSettings(){fillSettings();show('settings')}
$('gear').onclick=openSettings;
$('sback').onclick=()=>show('setup');
if(SIM)document.querySelector('#setup h1').textContent='Pace · SIM';

// Resume an unfinished run saved by an earlier session. If it was running and saved recently, the
// clock is assumed to have kept going, and distance from the last fix to the next one counts.
initHistory({currentId:()=>rec?.id,onResume:r=>{
  active=r.route&&{route:r.route,plan:{segs:r.segs},pace:r.pace,S:r.S,amber:r.amber,speed:!!r.speed,kmT:perKm(r.segs).map(k=>k.target)};
  resetRun();
  rec=r;rd=r.rd;rsplits=[...r.rsplits];track.dist=r.dist;track.splits=[...r.splits];
  if(matcher)matcher.seed(r.rd,r.dist);
  if(r.route)sim.jump=r.rd;
  const gap=(Date.now()-r.saved)*SPEED,last=r.fixes.at(-1);
  applyActive();show('run');
  if(r.running&&gap<RESUME_GAP){
    acc=r.elapsed+gap;start();
    if(last)track.last={lat:last[I.lat],lon:last[I.lon],t:last[I.ts]};
  }else{
    acc=r.elapsed;$('go').textContent='Resume';
  }
  draw();
}});

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
