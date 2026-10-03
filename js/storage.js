// IndexedDB persistence: saved routes and recorded runs.
let db=null;
const open=()=>db||(db=new Promise((res,rej)=>{
  const r=indexedDB.open('pace',2);
  r.onupgradeneeded=()=>{
    const d=r.result;
    if(!d.objectStoreNames.contains('routes'))d.createObjectStore('routes',{keyPath:'id',autoIncrement:true});
    if(!d.objectStoreNames.contains('runs'))d.createObjectStore('runs',{keyPath:'id',autoIncrement:true});
  };
  r.onsuccess=()=>res(r.result);r.onerror=()=>{db=null;rej(r.error)};
}));
const tx=(store,mode,fn)=>open().then(d=>new Promise((res,rej)=>{
  const t=d.transaction(store,mode),req=fn(t.objectStore(store));
  t.oncomplete=()=>res(req.result);t.onerror=t.onabort=()=>rej(t.error);
}));

export const saveRoute=r=>tx('routes','readwrite',s=>s.put(r));   // resolves to the id
export const listRoutes=()=>tx('routes','readonly',s=>s.getAll());
export const deleteRoute=id=>tx('routes','readwrite',s=>s.delete(id));

export const saveRun=r=>tx('runs','readwrite',s=>s.put(r));       // resolves to the id
export const listRuns=()=>tx('runs','readonly',s=>s.getAll());
export const deleteRun=id=>tx('runs','readwrite',s=>s.delete(id));
