// Setup screen: "unfinished run" banner and the run history list.
import {listRuns,saveRun,deleteRun} from './storage.js';
import {summarise,worthKeeping} from './record.js';
import {fmt} from './pacing.js';
import {buildReport,toCSV,toGPX,fileName} from './report.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const when=ms=>new Date(ms).toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const title=r=>(r.sim?'SIM · ':'')+(r.route?r.route.name:'Free run');

let runs=[],pending=null,open=null,cb={};

// cb: onResume(run), currentId() → id of the run this session is recording (never offered as unfinished)
export function initHistory(callbacks){
  cb=callbacks;
  $('rsgo').onclick=()=>{const r=pending;pending=null;$('resume').hidden=true;cb.onResume(r)};
  $('rssave').onclick=()=>settlePending().then(refreshHistory);
  $('rsdel').onclick=async()=>{if(!confirm('Discard this unfinished run?'))return;await deleteRun(pending.id);pending=null;refreshHistory()};
  refreshHistory().catch(e=>{$('noruns').textContent='Could not open run history: '+e.message});
}

// Save an unfinished run from an earlier session to history (or drop it if it recorded nothing)
export async function settlePending(){
  if(!pending)return;
  const r=pending;pending=null;$('resume').hidden=true;
  if(worthKeeping(r))await saveRun({...r,status:'done',running:false});else await deleteRun(r.id);
}

export async function refreshHistory(){
  const all=(await listRuns()).sort((a,b)=>b.started-a.started);
  const cur=cb.currentId?.();
  pending=all.find(r=>r.status==='active'&&r.id!==cur)||null;
  runs=all.filter(r=>r.status==='done');
  if(pending){
    const s=summarise(pending),ago=Math.round((Date.now()-pending.saved)/60000);
    $('rsinfo').textContent=`${title(pending)} · ${(s.dist/1000).toFixed(2)} km · ${fmt(s.elapsed/1000)} · started ${when(pending.started)} · last saved ${ago<1?'just now':ago+' min ago'}`;
  }
  $('resume').hidden=!pending;
  render();
}

export const showRun=id=>{open=id;render()};

// Share a file through the iOS share sheet (Files, AirDrop, Mail…); download it where that isn't available
async function deliver(name,type,text){
  const file=new File([text],name,{type});
  if(navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file]});return}catch(e){if(e.name==='AbortError')return}
  }
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=name;
  document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
}

function view(r){
  $('rpframe').srcdoc=buildReport(r);
  $('report').hidden=false;document.body.style.overflow='hidden';
}
$('rpclose').onclick=()=>{$('report').hidden=true;$('rpframe').srcdoc='';document.body.style.overflow=''};

const ACTIONS={
  view:r=>view(r),
  share:r=>deliver(fileName(r,'html'),'text/html',buildReport(r)),
  csv:r=>deliver(fileName(r,'csv'),'text/csv',toCSV(r)),
  gpx:r=>deliver(fileName(r,'gpx'),'application/gpx+xml',toGPX(r)),
};

function render(){
  $('noruns').hidden=runs.length>0;
  $('runs').innerHTML=runs.map(r=>{
    const s=summarise(r),sp=r.route?r.rsplits:r.splits;
    const meta=`${(s.dist/1000).toFixed(2)} km · ${fmt(s.elapsed/1000)} · ${s.avg?fmt(s.avg):'--:--'} /km`+
      (r.route?` · target ${fmt(r.pace)}`+(s.inBand!=null?` · ${Math.round(s.inBand*100)}% in band`:''):'');
    const det=open===r.id?`<div class="det">${sp.length?sp.map((x,i)=>`Km ${i+1}: ${fmt((x-(sp[i-1]||0))/1000)}`).join('<br>'):'No full km'}<br>${r.fixes.length} GPS points recorded<div class="acts"><button data-a="view" data-id="${r.id}">View report</button><button data-a="share" data-id="${r.id}">Share report</button><button data-a="csv" data-id="${r.id}">CSV</button><button data-a="gpx" data-id="${r.id}">GPX</button></div></div>`:'';
    return `<li><div class="rrow"><button class="sel" data-id="${r.id}">${esc(title(r))}<span class="meta">${when(r.started)}</span><span class="meta">${meta}</span></button><button class="del" data-id="${r.id}" aria-label="Delete run">✕</button></div>${det}</li>`;
  }).join('');
  $('runs').querySelectorAll('.sel').forEach(b=>b.onclick=()=>{const id=+b.dataset.id;open=open===id?null:id;render()});
  $('runs').querySelectorAll('.acts button').forEach(b=>b.onclick=()=>{
    const r=runs.find(x=>x.id===+b.dataset.id);
    Promise.resolve().then(()=>ACTIONS[b.dataset.a](r)).catch(e=>alert('Export failed: '+e.message));
  });
  $('runs').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this run from history?'))return;
    await deleteRun(+b.dataset.id);runs=runs.filter(r=>r.id!==+b.dataset.id);render();
  });
}
