// Post-run report: one self-contained HTML file with the run embedded as JSON. The map, charts and
// tables are drawn as static SVG/HTML when the file is built, so it reads anywhere, including the iOS
// Files preview, which doesn't run scripts. A small script then adds the Leaflet street map (online)
// and links a finger/cursor on the charts to the position on the map. Also CSV and GPX exports.
// No DOM access, so it all runs under node --test.
import {fmt,timeAt,band,perKm} from './pacing.js';
import {analyse,SEGCOL,ICON,NAME} from './route.js';
import {I,summarise} from './record.js';
import {kmPaces,chartSVG,COL} from './chart.js';

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const iso=ms=>new Date(ms).toISOString();
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
const signed=s=>(s>=0.5?'+':s<=-0.5?'−':'')+fmt(Math.abs(s));
const BANDS=['green','amber','red'];

export function fileName(run,ext){
  const d=new Date(run.started),p=n=>String(n).padStart(2,'0');
  return `pace-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-${slug(run.route?run.route.name:'free run')||'run'}.${ext}`;
}

// Elapsed ms when route distance d was first reached, interpolated between fixes; null if never
export function timeAtDist(fixes,d){
  if(d<=0)return 0;
  let prev=null;
  for(const f of fixes){
    const r=f[I.rd];if(r==null)continue;
    if(r>=d)return prev&&r>prev[1]?prev[0]+(f[I.t]-prev[0])*(d-prev[1])/(r-prev[1]):f[I.t];
    prev=[f[I.t],r];
  }
  return null;
}

// Actual pace per segment (s/km). A segment the run didn't finish gets the pace over the part
// covered (partial), if at least 50 m; the finish counts as reached within 30 m.
export function segActuals(run){
  return run.segs.map(s=>{
    const a=timeAtDist(run.fixes,s.d0);
    if(a==null)return {...s,actual:null,partial:false};
    let b=timeAtDist(run.fixes,s.d1);
    if(b==null&&run.rd>=s.d1-30)b=run.elapsed;
    if(b!=null)return {...s,actual:(b-a)/s.len,partial:false};
    const cov=run.rd-s.d0;
    return {...s,actual:cov>=50?(run.elapsed-a)/cov:null,partial:true};
  });
}

// Route elevation at distance d (route pts are every 10 m)
function eleAt(pts,d){
  let lo=0,hi=pts.length-2;
  while(lo<hi){const m=(lo+hi+1)>>1;if(pts[m].d<=d)lo=m;else hi=m-1}
  const a=pts[lo],b=pts[lo+1]||a,f=b.d>a.d?Math.max(0,Math.min(1,(d-a.d)/(b.d-a.d))):0;
  return a.ele+(b.ele-a.ele)*f;
}

export function toCSV(run){
  const h='time,elapsed_s,lat,lon,accuracy_m,gps_distance_m,route_distance_m,segment,pace_s_per_km,target_s_per_km,band';
  const n=(v,dp)=>v==null?'':v.toFixed(dp);
  return h+'\n'+run.fixes.map(f=>[iso(f[I.ts]),n(f[I.t]/1000,1),n(f[I.lat],6),n(f[I.lon],6),n(f[I.acc],0),n(f[I.d],1),
    n(f[I.rd],1),f[I.seg]??'',n(f[I.cur],1),n(f[I.tgt],1),f[I.band]??''].join(',')).join('\n')+'\n';
}

export function toGPX(run){
  const name=esc((run.route?run.route.name:'Free run')+' · '+new Date(run.started).toLocaleString());
  const pts=run.fixes.map(f=>{
    const ele=run.route&&f[I.rd]!=null?`<ele>${eleAt(run.route.pts,f[I.rd]).toFixed(1)}</ele>`:'';
    return `<trkpt lat="${f[I.lat].toFixed(7)}" lon="${f[I.lon].toFixed(7)}">${ele}<time>${iso(f[I.ts])}</time></trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Pace" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${name}</name><time>${iso(run.started)}</time></metadata>
<trk><name>${name}</name><type>running</type><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}

// ---- Report ----

// Equirectangular projection in metres covering the track and route
function projection(lls){
  const lat0=lls[0][0],k=Math.cos(lat0*Math.PI/180)*111195;
  const xs=lls.map(p=>p[1]*k),ys=lls.map(p=>-p[0]*111195),x0=Math.min(...xs),y0=Math.min(...ys);
  return {k,x0,y0,w:Math.max(...xs)-x0,h:Math.max(...ys)-y0};
}

function mapSVG(track,routeLL,pr){
  const pad=Math.max(pr.w,pr.h)*0.05+10,r=Math.max(pr.w,pr.h)*0.012+4;
  const P=p=>`${(p[1]*pr.k-pr.x0).toFixed(1)},${(-p[0]*111195-pr.y0).toFixed(1)}`;
  const line=(pts,col,w,op)=>`<polyline points="${pts.map(P).join(' ')}" fill="none" stroke="${col}" stroke-width="${w}" stroke-opacity="${op}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  let s=routeLL?line(routeLL,'currentColor',9,.15):'';
  // Track in runs of the same band colour (each run shares its first point with the previous one)
  for(let i=0;i<track.length-1;){
    const c=track[i][5];let j=i+1;
    while(j<track.length-1&&track[j][5]===c)j++;
    s+=line(track.slice(i,j+1).map(f=>[f[1],f[2]]),c?COL[BANDS[c-1]]:COL.none,4,1);
    i=j;
  }
  const dot=(p,fill)=>{const [x,y]=P(p).split(',');return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`};
  if(track.length){s+=dot([track.at(-1)[1],track.at(-1)[2]],'#fff')+dot([track[0][1],track[0][2]],'#22c55e')}
  s+=`<circle id="mk" r="${r*1.2}" fill="#facc15" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
  return `<svg id="smap" viewBox="${-pad} ${-pad} ${pr.w+2*pad} ${pr.h+2*pad}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Map of the run coloured by pace band">${s}</svg>`;
}

// Pace vs target over distance: band and target per segment, actual pace line (faster = up)
function paceChart(track,segs,S,total){
  const W=1000,H=240,cur=track.map(f=>f[3]).filter(v=>v!=null).sort((a,b)=>a-b);
  const q=f=>cur[Math.floor(f*(cur.length-1))];
  const ref=segs?segs.flatMap(s=>[s.target-S,s.target+S]):cur.length?[q(0.05),q(0.95)]:[270,330];
  const act=cur.length?[q(0.02),q(0.98)]:[];
  const lo=Math.min(...ref,...act),hi=Math.max(...ref,...act);
  const fast=Math.floor((lo-10)/15)*15,slow=Math.ceil((hi+10)/15)*15,step=slow-fast>150?60:slow-fast>60?30:15;
  const X=d=>(d/total*W).toFixed(1),Y=p=>(H*(Math.max(fast,Math.min(slow,p))-fast)/(slow-fast)).toFixed(1);
  let s='',lab='';
  for(let p=Math.ceil(fast/step)*step;p<=slow;p+=step){
    s+=`<line x1="0" x2="${W}" y1="${Y(p)}" y2="${Y(p)}" stroke="currentColor" stroke-opacity=".12" vector-effect="non-scaling-stroke"/>`;
    lab+=`<span class="yl" style="top:${(Y(p)/H*100).toFixed(1)}%">${fmt(p)}</span>`;
  }
  if(segs)for(const g of segs){
    s+=`<rect x="${X(g.d0)}" y="${Y(g.target-S)}" width="${(X(g.d1)-X(g.d0)).toFixed(1)}" height="${(Y(g.target+S)-Y(g.target-S)).toFixed(1)}" fill="currentColor" fill-opacity=".13"/>`+
      `<line x1="${X(g.d0)}" x2="${X(g.d1)}" y1="${Y(g.target)}" y2="${Y(g.target)}" stroke="currentColor" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>`;
  }
  let path='',pen=false;
  for(const f of track){if(f[3]==null){pen=false;continue}path+=(pen?'L':'M')+X(f[0])+','+Y(f[3]);pen=true}
  s+=`<path d="${path}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  return `<div class="plot" data-x="1"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Pace against target over distance">${s}</svg>${lab}<div class="xh"></div></div>${xAxis(total)}`;
}

function profileChart(route,segs,total){
  const a=analyse(route.pts),W=1000,H=140,es=a.es,lo0=Math.min(...es),hi0=Math.max(...es),m=Math.max(10,(hi0-lo0)*0.1);
  const lo=lo0-m,hi=hi0+m,X=d=>(d/total*W).toFixed(1),Y=e=>(H-(e-lo)/(hi-lo)*H).toFixed(1);
  const pts=route.pts;
  let s=segs.map(x=>{let q=`${X(x.d0)},${H} `;for(let i=x.i0;i<=x.i1;i++)q+=`${X(pts[i].d)},${Y(es[i])} `;return `<polygon points="${q}${X(x.d1)},${H}" fill="${SEGCOL[x.cls]}" fill-opacity=".85"/>`}).join('');
  s+=`<polyline points="${es.map((e,i)=>`${X(pts[i].d)},${Y(e)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  const lab=`<span class="yl" style="top:${(Y(hi0)/H*100).toFixed(1)}%">${Math.round(hi0)} m</span><span class="yl" style="top:${(Y(lo0)/H*100).toFixed(1)}%">${Math.round(lo0)} m</span>`;
  return {html:`<div class="plot short" data-x="1"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Elevation profile shaded by segment">${s}</svg>${lab}<div class="xh"></div></div>${xAxis(total)}`,gain:a.gain};
}

function xAxis(total){
  const km=total/1000,step=km<=12?1:km<=25?2:5;let s='';
  for(let k=0;k<=km+1e-9;k+=step)s+=`<span style="left:${(k/km*100).toFixed(2)}%">${k?k:'0 km'}</span>`;
  return `<div class="xa">${s}</div>`;
}

export function buildReport(run){
  const sum=summarise(run),route=run.route,segs=run.segs,S=run.S;
  const total=Math.max(sum.dist,1);
  // Compact track: [distance m, lat, lon, pace, target, band 0 none/1 green/2 amber/3 red, elapsed s]
  const track=run.fixes.map(f=>[+(route?f[I.rd]??0:f[I.d]).toFixed(1),+f[I.lat].toFixed(6),+f[I.lon].toFixed(6),
    f[I.cur]==null?null:+f[I.cur].toFixed(1),f[I.tgt]==null?null:+f[I.tgt].toFixed(1),BANDS.indexOf(f[I.band])+1,+(f[I.t]/1000).toFixed(1)]);
  const routeLL=route?route.pts.map(p=>[+p.lat.toFixed(6),+p.lon.toFixed(6)]):null;
  const lls=[...track.map(f=>[f[1],f[2]]),...(routeLL||[])],pr=projection(lls.length?lls:[[0,0]]);
  const title=(route?route.name:'Free run')+(run.sim?' (simulated)':'');
  const date=new Date(run.started).toLocaleString(undefined,{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});

  // Summary tiles
  const tiles=[['Time',fmt(sum.elapsed/1000)],['Distance',(sum.dist/1000).toFixed(2)+' km'],['Average pace',(sum.avg?fmt(sum.avg):'--:--')+' /km']];
  let prof=null;
  if(route){
    const dl=sum.elapsed/1000-timeAt(segs,run.rd);
    prof=profileChart(route,segs,total);
    tiles.push(['Target pace',fmt(run.pace)+' /km'],['Vs plan',signed(dl)+(Math.abs(dl)<0.5?'':dl>0?' behind':' ahead')],
      ['In band (±'+S+' s)',sum.inBand==null?'–':Math.round(sum.inBand*100)+'%'],['Route climb','↑'+Math.round(prof.gain)+' m']);
  }

  // Per km
  const splits=route?run.rsplits:run.splits,kp=kmPaces(splits,run.elapsed,sum.dist);
  const kmT=route?perKm(segs).map(k=>k.target):[];
  const km=chartSVG({targets:kmT.slice(0,Math.max(kp.length,kmT.length)),paces:kp,live:false,S:S??0,amber:run.amber,slot:34});
  const kmRows=kp.map((p,i)=>{
    const len=Math.min(1000,sum.dist-i*1000)/1000,tg=kmT[i];
    return `<tr><td>${i+1}${len<0.999?` <small>(${len.toFixed(2)})</small>`:''}</td><td>${fmt(p*len)}</td><td>${fmt(p)}</td>`+
      (route?`<td>${tg?fmt(tg):''}</td><td class="${tg?band(p,tg,S,run.amber):''}">${tg?signed(p-tg):''}</td>`:'')+'</tr>';
  }).join('');

  // Segments
  const segRows=route?segActuals(run).map(s=>`<tr><td><i style="background:${SEGCOL[s.cls]}"></i>${ICON[s.cls]} ${NAME[s.cls]}</td><td class="opt">${(s.d0/1000).toFixed(2)}</td><td>${Math.round(s.len)} m</td><td>${s.g>0?'+':''}${s.g.toFixed(1)}%</td><td>${fmt(s.target)}</td>`+
    (s.actual==null?'<td>–</td><td></td>':`<td>${fmt(s.actual)}${s.partial?'*':''}</td><td class="${band(s.actual,s.target,S,run.amber)}">${signed(s.actual-s.target)}</td>`)+'</tr>').join(''):'';

  const data={total,track,route:routeLL,pr:{k:pr.k,x0:pr.x0,y0:pr.y0}};
  const json=JSON.stringify(data).replace(/</g,'\\u003c');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(date)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>
:root{--bg:#fff;--fg:#111;--mut:#666;--card:#f4f4f5;--line:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b0c;--fg:#f4f4f5;--mut:#a1a1aa;--card:#18181b;--line:#27272a}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;padding:16px}
main{max-width:860px;margin:0 auto}
h1{font-size:24px;margin:0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:28px 0 8px}
.date{color:var(--mut);margin-top:2px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:16px}
.tile{background:var(--card);border-radius:12px;padding:10px 12px}.tile b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.tile span{color:var(--mut);font-size:13px}
#smap,#lmap{width:100%;height:340px;display:block;border-radius:12px;background:var(--card)}
#lmap{display:none}
.plot{position:relative;height:220px;margin-left:40px;border-left:1px solid var(--line);border-bottom:1px solid var(--line);touch-action:pan-y}.plot.short{height:130px}
.plot svg{width:100%;height:100%;display:block}
.yl{position:absolute;left:-44px;width:38px;text-align:right;transform:translateY(-50%);font-size:11px;color:var(--mut);font-variant-numeric:tabular-nums}
.xa{position:relative;height:18px;margin-left:40px;font-size:11px;color:var(--mut)}.xa span{position:absolute;transform:translateX(-50%);top:2px}.xa span:first-child{transform:none}
.xh{position:absolute;top:0;bottom:0;width:0;border-left:1px solid #facc15;display:none;pointer-events:none}
#read{min-height:20px;font-variant-numeric:tabular-nums;color:var(--mut);margin:6px 0 0 40px;font-size:14px}
.key{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--mut);margin:6px 0}
.key i,td i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}
.km{display:flex;overflow-x:auto;color:var(--fg)}.km svg{display:block;flex:none}.km text{fill:var(--mut);font-size:11px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:7px 4px;border-top:1px solid var(--line);text-align:right;white-space:nowrap}th{color:var(--mut);font-weight:500;font-size:12px;text-transform:uppercase}
th:first-child,td:first-child{text-align:left}.tw{overflow-x:auto}
@media (max-width:520px){th,td{padding:6px 2px;font-size:13px}.opt{display:none}}
.green{color:#16a34a}.amber{color:#d97706}.red{color:#dc2626}
footer{color:var(--mut);font-size:13px;margin:32px 0 8px}
</style></head><body><main>
<h1>${esc(title)}</h1><div class="date">${esc(date)}</div>
<div class="tiles">${tiles.map(([k,v])=>`<div class="tile"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>

<h2>Map</h2>
${mapSVG(track,routeLL,pr)}<div id="lmap"></div>
<div class="key">${route?`<span><i style="background:${COL.green}"></i>In band</span>`+(run.amber?`<span><i style="background:${COL.amber}"></i>Amber</span>`:'')+`<span><i style="background:${COL.red}"></i>Outside band</span><span><i style="background:${COL.none}"></i>No reading</span>`:''}<span><i style="background:#22c55e;border-radius:50%"></i>Start</span><span><i style="background:#fff;border:1px solid #000;border-radius:50%"></i>Finish</span></div>

<h2>Pace${route?' vs target':''}</h2>
${paceChart(track,route?segs:null,S??0,total)}
<div id="read">${track.length?'Touch or hover the charts to see that point on the map.':''}</div>
${route?`<div class="key"><span><i style="background:#2563eb"></i>Your pace (20 s)</span><span>- - Target · shaded = ±${S} s</span><span>Faster is higher</span></div>`:''}

${prof?`<h2>Elevation</h2>${prof.html}<div class="key"><span><i style="background:${SEGCOL.up}"></i>Climb</span><span><i style="background:${SEGCOL.flat}"></i>Flat</span><span><i style="background:${SEGCOL.down}"></i>Descent</span></div>`:''}

<h2>Per km</h2>
<div class="km">${km.axis}${km.bars}</div>
<div class="tw"><table><tr><th>Km</th><th>Time</th><th>Pace</th>${route?'<th>Target</th><th>Delta</th>':''}</tr>${kmRows||'<tr><td colspan="5">Under 50 m recorded</td></tr>'}</table></div>

${route?`<h2>Segments</h2><div class="tw"><table><tr><th>Segment</th><th class="opt">From km</th><th>Length</th><th>Grade</th><th>Target</th><th>Actual</th><th>Delta</th></tr>${segRows}</table></div>
<div class="key">Delta: + slower, − faster than target. * = segment not finished.</div>`:''}

<footer>Made with Pace. The street map needs an internet connection; everything else works offline.</footer>
</main>
<script type="application/json" id="data">${json}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('data').textContent),T=D.track,map=null,lm=null;
if(!T.length)return;
var mk=document.getElementById('mk'),read=document.getElementById('read');
function fm(s){s=Math.round(s);var m=Math.floor(s/60),x=s%60;return m+':'+(x<10?'0':'')+x}
function near(d){var lo=0,hi=T.length-1;while(lo<hi){var m=(lo+hi)>>1;if(T[m][0]<d)lo=m+1;else hi=m}return lo}
function show(i){
  var f=T[i],x=(f[0]/D.total*100)+'%';
  document.querySelectorAll('.xh').forEach(function(h){h.style.display='block';h.style.left=x});
  read.textContent=(f[0]/1000).toFixed(2)+' km · '+fm(f[6])+' · pace '+(f[3]?fm(f[3]):'--:--')+(f[4]?' · target '+fm(f[4]):'');
  mk.setAttribute('cx',(f[2]*D.pr.k-D.pr.x0).toFixed(1));mk.setAttribute('cy',(-f[1]*111195-D.pr.y0).toFixed(1));mk.setAttribute('visibility','visible');
  if(lm)lm.setLatLng([f[1],f[2]]).addTo(map);
}
document.querySelectorAll('.plot').forEach(function(p){
  function at(e){var t=e.touches?e.touches[0]:e,r=p.getBoundingClientRect();show(near(Math.max(0,Math.min(1,(t.clientX-r.left)/r.width))*D.total))}
  p.addEventListener('mousemove',at);p.addEventListener('touchstart',at,{passive:true});p.addEventListener('touchmove',at,{passive:true});
});
window.addEventListener('load',function(){
  if(!window.L)return;
  try{
    var el=document.getElementById('lmap');el.style.display='block';
    map=L.map(el,{scrollWheelZoom:false});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    var col=['${COL.none}','${COL.green}','${COL.amber}','${COL.red}'],all=[];
    if(D.route)L.polyline(D.route,{color:'#888',weight:9,opacity:.25}).addTo(map);
    for(var i=0;i<T.length-1;){var c=T[i][5],j=i+1;while(j<T.length-1&&T[j][5]===c)j++;
      var seg=T.slice(i,j+1).map(function(f){return [f[1],f[2]]});all=all.concat(seg);
      L.polyline(seg,{color:col[c],weight:5,opacity:.95}).addTo(map);i=j}
    map.fitBounds(L.latLngBounds(all.length?all:D.route),{padding:[16,16]});
    lm=L.circleMarker([T[0][1],T[0][2]],{radius:8,color:'#000',weight:2,fillColor:'#facc15',fillOpacity:1});
    document.getElementById('smap').style.display='none';
  }catch(e){document.getElementById('lmap').style.display='none'}
});
})();
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
</body></html>
`;
}

