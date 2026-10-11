// The coach's diary: every in-run request, every pace change, every piece of feedback, every plan change
// proposed (by the AI or the rules) and whether you accepted it. Kept on the phone in its own database
// (so Pacer's runs database is never upgraded or touched), and exportable as JSON Lines: together with
// the laptop's own log (coach/data/*.jsonl) it is the raw material for fine-tuning a LoRA later
// (coach/export_finetune.py turns both into chat-format training data).
const DB='pacer-coach';
let db=null;
const open=()=>db||(db=new Promise((res,rej)=>{
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>r.result.createObjectStore('events',{keyPath:'n',autoIncrement:true});
  r.onsuccess=()=>res(r.result);r.onerror=()=>{db=null;rej(r.error)};
}));
const tx=(mode,fn)=>open().then(d=>new Promise((res,rej)=>{const t=d.transaction('events',mode),q=fn(t.objectStore('events'));t.oncomplete=()=>res(q?.result);t.onerror=t.onabort=()=>rej(t.error)}));

// Add an event: {type: 'intent'|'adjust'|'feedback'|'proposal'|'decision'|'run'|'undo', ...}
export const logEvent=ev=>tx('readwrite',s=>s.add({v:1,ts:Date.now(),...ev})).catch(()=>null);
export const listEvents=()=>tx('readonly',s=>s.getAll()).catch(()=>[]);
export const countEvents=()=>tx('readonly',s=>s.count()).catch(()=>0);
// Update an event (e.g. a proposal's outcome) by its n
export const patchEvent=async(n,patch)=>{const all=await listEvents(),e=all.find(x=>x.n===n);if(e)await tx('readwrite',s=>s.put({...e,...patch}))};
// Everything, one JSON object per line
export const toJSONL=evs=>evs.map(e=>JSON.stringify(e)).join('\n')+'\n';
