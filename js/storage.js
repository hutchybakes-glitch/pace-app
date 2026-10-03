// IndexedDB persistence. Routes for now; runs arrive in phase 5 (bump the version and add a store).
let db=null;
const open=()=>db||(db=new Promise((res,rej)=>{
  const r=indexedDB.open('pace',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('routes',{keyPath:'id',autoIncrement:true});
  r.onsuccess=()=>res(r.result);r.onerror=()=>{db=null;rej(r.error)};
}));
const tx=(mode,fn)=>open().then(d=>new Promise((res,rej)=>{
  const t=d.transaction('routes',mode),req=fn(t.objectStore('routes'));
  t.oncomplete=()=>res(req.result);t.onerror=t.onabort=()=>rej(t.error);
}));

export const saveRoute=r=>tx('readwrite',s=>s.put(r));   // resolves to the id
export const listRoutes=()=>tx('readonly',s=>s.getAll());
export const deleteRoute=id=>tx('readwrite',s=>s.delete(id));
