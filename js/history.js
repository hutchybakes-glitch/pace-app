// Setup screen: "unfinished run" banner and the run history list.
import {listRuns,saveRun,deleteRun} from './storage.js';
import {summarise,worthKeeping} from './record.js';
import {fmt} from './pacing.js';

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

function render(){
  $('noruns').hidden=runs.length>0;
  $('runs').innerHTML=runs.map(r=>{
    const s=summarise(r),sp=r.route?r.rsplits:r.splits;
    const meta=`${(s.dist/1000).toFixed(2)} km · ${fmt(s.elapsed/1000)} · ${s.avg?fmt(s.avg):'--:--'} /km`+
      (r.route?` · target ${fmt(r.pace)}`+(s.inBand!=null?` · ${Math.round(s.inBand*100)}% in band`:''):'');
    const det=open===r.id?`<div class="det">${sp.length?sp.map((x,i)=>`Km ${i+1}: ${fmt((x-(sp[i-1]||0))/1000)}`).join('<br>'):'No full km'}<br>${r.fixes.length} GPS points recorded</div>`:'';
    return `<li><div class="rrow"><button class="sel" data-id="${r.id}">${esc(title(r))}<span class="meta">${when(r.started)}</span><span class="meta">${meta}</span></button><button class="del" data-id="${r.id}" aria-label="Delete run">✕</button></div>${det}</li>`;
  }).join('');
  $('runs').querySelectorAll('.sel').forEach(b=>b.onclick=()=>{const id=+b.dataset.id;open=open===id?null:id;render()});
  $('runs').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    if(!confirm('Delete this run from history?'))return;
    await deleteRun(+b.dataset.id);runs=runs.filter(r=>r.id!==+b.dataset.id);render();
  });
}
