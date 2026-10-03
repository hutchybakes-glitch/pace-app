// Offline cache. Network-first so a new Netlify deploy is picked up as soon as there's signal;
// falls back to the cached copy when offline. Bump VERSION when the file list changes.
const VERSION='pace-v8';
const FILES=['./','index.html','css/app.css','js/app.js','js/gps.js','js/route.js','js/pacing.js','js/storage.js','js/setup.js','js/match.js','js/sim.js','js/chart.js','js/record.js','js/history.js','js/report.js','js/settings.js','js/start.js','manifest.json','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(e.request,copy))}
    return r;
  }).catch(()=>caches.match(e.request,{ignoreSearch:true})));
});
