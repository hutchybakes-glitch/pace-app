// Storage for Pacer: its own IndexedDB ('pacer') so v1 is never touched, plus small options in
// localStorage under 'pacer:' keys. Saved routes are copied over from v1 ('pace') once.
let db=null;
const open=()=>db||(db=new Promise((res,rej)=>{
  const r=indexedDB.open('pacer',1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('routes',{keyPath:'id',autoIncrement:true});d.createObjectStore('runs',{keyPath:'id',autoIncrement:true})};
  r.onsuccess=()=>res(r.result);r.onerror=()=>{db=null;rej(r.error)};
}));
const tx=(store,mode,fn)=>open().then(d=>new Promise((res,rej)=>{
  const t=d.transaction(store,mode),req=fn(t.objectStore(store));
  t.oncomplete=()=>res(req.result);t.onerror=t.onabort=()=>rej(t.error);
}));

export const saveRoute=r=>tx('routes','readwrite',s=>s.put(r));
export const listRoutes=()=>tx('routes','readonly',s=>s.getAll());
export const deleteRoute=id=>tx('routes','readwrite',s=>s.delete(id));
export const saveRun=r=>tx('runs','readwrite',s=>s.put(r));
export const listRuns=()=>tx('runs','readonly',s=>s.getAll());
export const deleteRun=id=>tx('runs','readwrite',s=>s.delete(id));

// Options. In the sim (?sim=1) the training plan, the goal and the coach's changes are kept under 'pacer:sim:'
// keys, so trying the coach out never touches your real plan
const SANDBOX=typeof location!=='undefined'&&new URLSearchParams(location.search).has('sim');
const key=k=>'pacer:'+(SANDBOX&&/^(program$|goal$|hero:loaded$|plan:|prog:|demo:)/.test(k)?'sim:':'')+k;
export const opt={
  get(k,def){try{const v=localStorage.getItem(key(k));return v==null?def:JSON.parse(v)}catch(e){return def}},
  set(k,v){try{localStorage.setItem(key(k),JSON.stringify(v))}catch(e){}},
};

// Copy v1's saved routes the first time Pacer runs (v1's database is only read, never upgraded)
export async function importV1Routes(){
  if(opt.get('imported',false))return 0;
  const old=await new Promise(res=>{
    try{
      const r=indexedDB.open('pace');
      r.onsuccess=()=>{const d=r.result;if(!d.objectStoreNames.contains('routes')){d.close();return res([])}
        const q=d.transaction('routes').objectStore('routes').getAll();q.onsuccess=()=>{d.close();res(q.result)};q.onerror=()=>{d.close();res([])}};
      r.onerror=()=>res([]);
    }catch(e){res([])}
  });
  for(const r of old){const {id,...rest}=r;await saveRoute({...rest,from:'v1'})}
  opt.set('imported',true);
  return old.length;
}
