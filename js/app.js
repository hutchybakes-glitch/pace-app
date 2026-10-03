import {createTrack,watch} from './gps.js';

// State: running flag, banked ms, segment start, watch id, wake lock, draw tick
let run=false,acc=0,t0=0,wid=null,lock=null,tick=0;
const track=createTrack();
const $=id=>document.getElementById(id);
const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const pace=(sec,km)=>km>0.005&&sec/km<1800?fmt(sec/km):'--:--';
const el=()=>acc+(run?Date.now()-t0:0); // pause-aware elapsed ms

function onPos(p){
  $('gps').textContent=`GPS accuracy: ±${Math.round(p.coords.accuracy)} m`;
  if(run)track.add(p.coords,p.timestamp,el());
}

function draw(){
  const t=el(),km=track.dist/1000;
  $('tm').textContent=fmt(t/1000);
  $('km').textContent=km.toFixed(2);
  $('avg').textContent=pace(t/1000,km);
  if(tick++%5===0){                              // current pace every 5 s
    const r=track.rolling(t);
    $('cur').textContent=r?pace(r.sec,r.km):'--:--';
  }
  const sp=track.splits;
  $('sp').innerHTML=sp.map((s,i)=>`Km ${i+1}: ${fmt((s-(sp[i-1]||0))/1000)}`).join('<br>');
}

async function wake(){try{lock=await navigator.wakeLock?.request('screen')}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(run&&document.visibilityState==='visible')wake()});

$('go').onclick=()=>{
  if(!run){
    run=true;t0=Date.now();track.last=null;tick=0;
    if(wid===null)wid=watch(onPos,e=>$('gps').textContent='GPS error: '+e.message);
    wake();$('go').textContent='Pause';$('go').style.background='#b35900';
  }else{
    acc=el();run=false;lock?.release();lock=null;
    $('go').textContent='Resume';$('go').style.background='#1a7f37';
  }
};
$('rs').onclick=()=>{
  if(run||!confirm('Reset run?'))return;
  acc=0;tick=0;track.reset();
  $('go').textContent='Start';$('cur').textContent='--:--';draw();
};
setInterval(draw,1000);

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
