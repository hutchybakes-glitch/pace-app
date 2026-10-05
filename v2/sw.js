// Pacer offline cache (scope /v2/). Network-first so a new deploy shows up as soon as there's signal;
// cached copy when offline. Bump VERSION when the file list changes.
const VERSION='pacer-v18';
const FILES=['./','index.html','app.css','manifest.json','js/app.js','js/gps.js','js/route.js','js/match.js','js/nav.js','js/start.js','js/pacer.js','js/view.js','js/store.js','js/sim.js','js/coach.js','js/weather.js','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('pacer-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||!u.pathname.includes('/v2/'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(VERSION).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
