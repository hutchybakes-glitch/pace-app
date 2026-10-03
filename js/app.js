import {createTrack,watch,fitPace,WINDOW} from './gps.js';
import {fmt,segAt,timeAt,band,hysteresis,perKm} from './pacing.js';
import {kmPaces,renderChart} from './chart.js';
import {createMatcher} from './match.js';
import {initSetup,selected,ICON,NAME} from './setup.js';
import {initHistory,refreshHistory,settlePending,showRun} from './history.js';
import {saveRun,deleteRun} from './storage.js';
import {I,worthKeeping} from './record.js';
import {SIM,SPEED,now,every,sim,simWatch} from './sim.js';

// State: running flag, banked ms, segment start, watch id, wake lock, draw tick
let run=false,acc=0,t0=0,wid=null,lock=null,tick=0;
const track=createTrack();
// Route mode: active = {route,plan,pace,S,amber,kmT} from Setup (null = free run; kmT = per-km targets), matcher,
// route distance, km split times by route distance, recent {t,d} by route distance, colour hysteresis
let active=null,matcher=null,rd=0,rsplits=[],rpts=[],hyst=hysteresis(2);
// Recording: rec = run record being written (see record.js), dirty = unsaved fixes, saving = save queue
let rec=null,dirty=false,saving=Promise.resolve();
const ROUTE_WINDOW=20000,ROUTE_EVERY=2; // route mode: 20 s rolling pace (fitted, route distance), a reading every 2 s
const AUTOSAVE=10000,RESUME_GAP=15*60000; // autosave interval; a reload within this keeps the clock running
const $=id=>document.getElementById(id);
const pace=(sec,km)=>km>0.005&&sec/km<1800?fmt(sec/km):'--:--';
const el=()=>acc+(run?now()-t0:0); // pause-aware elapsed ms

function onPos(p){
  $('gps').textContent=`GPS accuracy: ±${Math.round(p.coords.accuracy)} m`;
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
    rpts=rpts.filter(q=>t-q.t<=ROUTE_WINDOW);
    seg=segAt(active.plan.segs,rd);tgt=active.plan.segs[seg].target;cur=fitPace(rpts);
    b=cur?band(cur,tgt,active.S,active.amber):null;
  }else{
    const o=track.pts.find(q=>t-q.t<=WINDOW),dd=o?track.dist-o.d:0;
    cur=dd>5&&(t-o.t)/dd<1800?(t-o.t)/dd:null; // ms per m = s per km
  }
  rec.fixes.push([p.timestamp,t,c.latitude,c.longitude,c.accuracy,track.dist,matcher?rd:null,seg,cur,tgt,b]);
  dirty=true;
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
      rpts=rpts.filter(p=>t-p.t<=ROUTE_WINDOW);
      const cur=fitPace(rpts);
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
    route:active?{id:active.route.id,name:active.route.name,src:active.route.src,pts:active.route.pts}:null,
    segs:active?active.plan.segs:null,pace:active?.pace??null,S:active?.S??null,amber:active?.amber??null};
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

// ---- Run controls ----
async function wake(){try{lock=await navigator.wakeLock?.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(run&&document.visibilityState==='visible')wake()});

const neutral=()=>{hyst=hysteresis(2);document.body.className=''};
const gpsErr=e=>$('gps').textContent='GPS error: '+e.message;

function start(){
  if(!rec){newRecord();settlePending().catch(()=>{})}
  run=true;t0=now();track.last=null;tick=0;rpts=[];sim.moving=true;
  if(wid===null)wid=SIM?simWatch(()=>active||selected(),onPos,gpsErr):watch(onPos,gpsErr);
  $('back').hidden=true;
  wake();$('go').textContent='Pause';$('go').style.background='#b35900';
}
function pause(){
  acc=el();run=false;sim.moving=false;lock?.release();lock=null;$('back').hidden=false;neutral();
  $('go').textContent='Resume';$('go').style.background='#1a7f37';
  save();
}
$('go').onclick=()=>run?pause():start();

function resetRun(){
  acc=0;tick=0;track.reset();rd=0;rsplits=[];rpts=[];rec=null;dirty=false;
  matcher=active?createMatcher(active.route.pts):null;
  neutral();$('off').hidden=true;
  $('go').textContent='Start';$('go').style.background='#1a7f37';$('cur').textContent='--:--';draw();
}
$('rs').onclick=async()=>{
  if(run)return;
  if(rec){snapshot();if(worthKeeping(rec)){
    if(!confirm('Finish and save this run?'))return;
    const id=await endRun();resetRun();await refreshHistory();showRun(id);show('setup');return;
  }}
  if(!confirm('Reset run?'))return;
  await endRun();resetRun();
};

// ---- Screens ----
const show=id=>{$('setup').hidden=id!=='setup';$('run').hidden=id!=='run';scrollTo(0,0)};
function applyActive(){
  $('rt').hidden=$('chart').hidden=!active;
  if(active)$('chkey').textContent=`▲ faster · band ±${active.S} s`;
  $('rlabel').textContent=(SIM?`SIM ${SPEED}× · `:'')+(active?`${active.route.name} · target ${fmt(active.pace)} /km · ±${active.S} s`:'');
}
initSetup({onStart:async sel=>{
  const same=(sel?.route.id)===(active?.route.id);
  if(!same&&acc>0){
    if(!confirm('Finish and save the current run, and start a new one?'))return;
    await endRun();refreshHistory();
  }
  active=sel&&{...sel,kmT:perKm(sel.plan.segs).map(k=>k.target)};
  if(!same)resetRun();
  applyActive();show('run');draw();
}});
$('back').onclick=()=>{if(!run){neutral();refreshHistory();show('setup')}};
if(SIM)document.querySelector('#setup h1').textContent='Pace · SIM';

// Resume an unfinished run saved by an earlier session. If it was running and saved recently, the
// clock is assumed to have kept going, and distance from the last fix to the next one counts.
initHistory({currentId:()=>rec?.id,onResume:r=>{
  active=r.route&&{route:r.route,plan:{segs:r.segs},pace:r.pace,S:r.S,amber:r.amber,kmT:perKm(r.segs).map(k=>k.target)};
  resetRun();
  rec=r;rd=r.rd;rsplits=[...r.rsplits];track.dist=r.dist;track.splits=[...r.splits];
  if(matcher)matcher.seed(r.rd,r.dist);
  sim.resumeAt=r.route?r.rd:null;
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
