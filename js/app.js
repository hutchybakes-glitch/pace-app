import {createTrack,watch,fitPace,WINDOW} from './gps.js';
import {fmt,segAt,timeAt,band,hysteresis} from './pacing.js';
import {createMatcher} from './match.js';
import {initSetup,selected,ICON,NAME} from './setup.js';
import {SIM,SPEED,now,every,sim,simWatch} from './sim.js';

// State: running flag, banked ms, segment start, watch id, wake lock, draw tick
let run=false,acc=0,t0=0,wid=null,lock=null,tick=0;
const track=createTrack();
// Route mode: active = {route,plan,pace,S,amber} from Setup (null = free run), matcher,
// route distance, km split times by route distance, recent {t,d} by route distance, colour hysteresis
let active=null,matcher=null,rd=0,rsplits=[],rpts=[],hyst=hysteresis(2);
const ROUTE_WINDOW=20000,ROUTE_EVERY=2; // route mode: 20 s rolling pace (fitted, route distance), a reading every 2 s
const $=id=>document.getElementById(id);
const pace=(sec,km)=>km>0.005&&sec/km<1800?fmt(sec/km):'--:--';
const el=()=>acc+(run?now()-t0:0); // pause-aware elapsed ms

function onPos(p){
  $('gps').textContent=`GPS accuracy: ±${Math.round(p.coords.accuracy)} m`;
  if(!run)return;
  const t=el();
  if(track.add(p.coords,p.timestamp,t)&&matcher){
    const m=matcher.update(p.coords.latitude,p.coords.longitude,track.dist);
    rd=m.d;rpts.push({t,d:rd});
    while(rd>=(rsplits.length+1)*1000)rsplits.push(t); // km split times by route distance
    $('off').hidden=!m.off;
    $('off').textContent=(m.matched?'Off route':'Not on route yet')+' · using GPS distance';
  }
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

async function wake(){try{lock=await navigator.wakeLock?.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(run&&document.visibilityState==='visible')wake()});

const neutral=()=>{hyst=hysteresis(2);document.body.className=''};
const gpsErr=e=>$('gps').textContent='GPS error: '+e.message;

$('go').onclick=()=>{
  if(!run){
    run=true;t0=now();track.last=null;tick=0;rpts=[];sim.moving=true;
    if(wid===null)wid=SIM?simWatch(()=>active||selected(),onPos,gpsErr):watch(onPos,gpsErr);
    $('back').hidden=true;
    wake();$('go').textContent='Pause';$('go').style.background='#b35900';
  }else{
    acc=el();run=false;sim.moving=false;lock?.release();lock=null;$('back').hidden=false;neutral();
    $('go').textContent='Resume';$('go').style.background='#1a7f37';
  }
};

function resetRun(){
  acc=0;tick=0;track.reset();rd=0;rsplits=[];rpts=[];
  matcher=active?createMatcher(active.route.pts):null;
  neutral();$('off').hidden=true;
  $('go').textContent='Start';$('go').style.background='#1a7f37';$('cur').textContent='--:--';draw();
}
$('rs').onclick=()=>{
  if(run||!confirm('Reset run?'))return;
  resetRun();
};
every(1000,draw);

// Screens
const show=id=>{$('setup').hidden=id!=='setup';$('run').hidden=id!=='run';scrollTo(0,0)};
initSetup({onStart:sel=>{
  const same=(sel?.route.id)===(active?.route.id);
  if(!same&&acc>0&&!confirm('Discard the current run and start a new one?'))return;
  active=sel;
  if(!same)resetRun();
  $('rt').hidden=!active;
  $('rlabel').textContent=(SIM?`SIM ${SPEED}× · `:'')+(active?`${active.route.name} · target ${fmt(active.pace)} /km · ±${active.S} s`:'');
  show('run');draw();
}});
$('back').onclick=()=>{if(!run){neutral();show('setup')}};
if(SIM)document.querySelector('#setup h1').textContent='Pace · SIM';

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
