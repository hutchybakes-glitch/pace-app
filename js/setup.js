// Setup screen: load/select saved routes, route map, elevation profile, target pace and segment list.
import {parseGPX,resample,fillElevation,analyse,SEGCOL as COL,ICON,NAME} from './route.js';
import {plan,fmt,parseTime} from './pacing.js';
import {saveRoute,listRoutes,deleteRoute} from './storage.js';
import {settings,routeOpts,coef} from './settings.js';

const $=id=>document.getElementById(id);
const ls={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}}};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ok=p=>p>=120&&p<1800; // 2:00–30:00 /km

let routes=[],cur=null;               // cur = {route, a: analysis, p: plan}
let pace=parseTime(ls.get('pace')||'')||300;

const msg=(t,err)=>{$('msg').textContent=t;$('msg').className=err?'err':''};

export function initSetup({onStart,onSettings}){
  $('gpx').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)load(f)};
  $('tp').onchange=()=>setPace(parseTime($('tp').value),'tp');
  $('tf').onchange=()=>setPace(parseTime($('tf').value)/(cur.a.dist/1000),'tf');
  $('free').onclick=()=>onStart(null);
  $('fbset').onclick=onSettings;
  $('startr').onclick=()=>{const s=settings();onStart({route:cur.route,analysis:cur.a,plan:cur.p,pace,S:s.S,amber:s.amber,speed:s.speed})};
  refresh().catch(e=>msg('Could not open saved routes: '+e.message,true));
}

// The route currently shown on Setup (sim mode replays it even for a free run)
export const selected=()=>cur&&{route:cur.route,plan:cur.p};

// Re-analyse the selected route after a settings change
export const refreshRoute=()=>{if(cur)select(cur.route);else render()};
export const routePreview=()=>cur?`${cur.a.segs.length} segments on ${cur.route.name} with these settings`:'';

function setPace(p,id){
  if(!ok(p)){$(id).classList.add('bad');return}
  pace=p;ls.set('pace',fmt(p));render();
}

async function load(file){
  try{
    msg('Reading '+file.name+'…');
    const g=parseGPX(await file.text());
    if(g.pts.length<2)throw new Error('No track or route points found in this file');
    let s=resample(g.pts),src='GPX';
    if(s.some(p=>p.ele==null)){
      s=await fillElevation(s,fetch,5,(i,n)=>msg(`Fetching elevation ${i}/${n}…`));
      src='Open-Meteo';
    }
    const route={name:g.name||file.name.replace(/\.[^.]+$/,''),created:Date.now(),src,pts:s,cues:g.cues};
    route.id=await saveRoute(route);
    msg('');routes.unshift(route);select(route);
  }catch(e){msg(e.message,true)}
}

async function refresh(){
  routes=(await listRoutes()).sort((a,b)=>b.created-a.created);
  const id=+ls.get('route');
  select(routes.find(r=>r.id===id)||null);
}

function select(r){
  cur=r?{route:r,a:analyse(r.pts,routeOpts(settings()))}:null;
  if(r)ls.set('route',r.id);
  render();
}

function render(){
  $('routes').innerHTML=routes.map(r=>`<li class="${cur?.route.id===r.id?'on':''}"><button class="sel" data-id="${r.id}">${esc(r.name)}<span class="meta">${(r.pts.at(-1).d/1000).toFixed(2)} km · added ${new Date(r.created).toLocaleDateString()}</span></button><button class="del" data-id="${r.id}" aria-label="Delete ${esc(r.name)}">✕</button></li>`).join('');
  $('routes').querySelectorAll('.sel').forEach(b=>b.onclick=()=>select(routes.find(r=>r.id===+b.dataset.id)));
  $('routes').querySelectorAll('.del').forEach(b=>b.onclick=async()=>{
    const r=routes.find(r=>r.id===+b.dataset.id);
    if(!confirm(`Delete route "${r.name}"?`))return;
    await deleteRoute(r.id);routes=routes.filter(x=>x!==r);
    if(cur?.route===r)select(null);else render();
  });
  $('rv').hidden=!cur;
  if(!cur)return;
  const s=settings(),{route,a}=cur,p=cur.p=plan(a.segs,pace,coef(s));
  $('rname').textContent=route.name;
  const n={up:0,down:0,flat:0};a.segs.forEach(x=>n[x.cls]++);
  $('rstats').innerHTML=[`${(a.dist/1000).toFixed(2)} km`,`↑${Math.round(a.gain)} m ↓${Math.round(a.loss)} m`,
    `${a.segs.length} segments`,`${n.up} ▲ · ${n.flat} ▬ · ${n.down} ▼`,`elevation: ${route.src}`].map(t=>`<span>${esc(t)}</span>`).join('');
  $('tp').value=fmt(pace);$('tf').value=fmt(p.T);$('tp').classList.remove('bad');$('tf').classList.remove('bad');
  $('rbase').textContent=`Flat pace for even effort: ${fmt(p.base)} /km`;
  $('fbsum').textContent=`Colour band ±${s.S} s/km · amber ${s.amber?'on':'off'} · pace from ${s.speed?'GPS speed':'position'} · ${s.autoStart?`starts at the line (${s.zone} m zone)`:'starts on tap'}`;
  drawMap(route.pts,a.segs);
  drawProfile(route.pts,a);
  $('segs').innerHTML='<tr><th>Segment</th><th>From km</th><th>Length</th><th>Grade</th><th>Target</th></tr>'+
    p.segs.map(x=>`<tr><td><i style="background:${COL[x.cls]}"></i>${ICON[x.cls]} ${NAME[x.cls]}</td><td>${(x.d0/1000).toFixed(2)}</td><td>${Math.round(x.len)} m</td><td>${x.g>0?'+':''}${x.g.toFixed(1)}%</td><td>${fmt(x.target)}</td></tr>`).join('');
}

// Route outline, equirectangular in metres, coloured by segment class
function drawMap(pts,segs){
  const k=Math.cos(pts[0].lat*Math.PI/180)*111195,xy=pts.map(p=>[p.lon*k,-p.lat*111195]);
  const xs=xy.map(q=>q[0]),ys=xy.map(q=>q[1]),x0=Math.min(...xs),y0=Math.min(...ys);
  const w=Math.max(...xs)-x0,h=Math.max(...ys)-y0,pad=Math.max(w,h)*0.06+10,r=Math.max(w,h)*0.015+4;
  const X=q=>(q[0]-x0).toFixed(1),Y=q=>(q[1]-y0).toFixed(1);
  const dot=(q,fill)=>`<circle cx="${X(q)}" cy="${Y(q)}" r="${r}" fill="${fill}" stroke="#000" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  const svg=$('rmap');
  svg.setAttribute('viewBox',`${-pad} ${-pad} ${w+2*pad} ${h+2*pad}`);
  svg.innerHTML=`<polyline points="${xy.map(q=>X(q)+','+Y(q)).join(' ')}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`+
    segs.map(x=>`<polyline points="${xy.slice(x.i0,x.i1+1).map(q=>X(q)+','+Y(q)).join(' ')}" fill="none" stroke="${COL[x.cls]}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('')+
    dot(xy.at(-1),'#fff')+dot(xy[0],'#22c55e');
}

// Smoothed elevation with each segment's area shaded by class, km gridlines
function drawProfile(pts,a){
  const W=1000,H=160,lo0=Math.min(...a.es),hi0=Math.max(...a.es),m=Math.max(10,(hi0-lo0)*0.1);
  const lo=lo0-m,hi=hi0+m,X=d=>(d/a.dist*W).toFixed(1),Y=e=>(H-(e-lo)/(hi-lo)*H).toFixed(1);
  let s='';
  for(let km=1000;km<a.dist;km+=1000)s+=`<line x1="${X(km)}" x2="${X(km)}" y1="0" y2="${H}" stroke="#fff" stroke-opacity=".12" vector-effect="non-scaling-stroke"/>`;
  s+=a.segs.map(x=>{let q=`${X(x.d0)},${H} `;for(let i=x.i0;i<=x.i1;i++)q+=`${X(pts[i].d)},${Y(a.es[i])} `;return `<polygon points="${q}${X(x.d1)},${H}" fill="${COL[x.cls]}" fill-opacity=".85"/>`}).join('');
  s+=`<polyline points="${a.es.map((e,i)=>`${X(pts[i].d)},${Y(e)}`).join(' ')}" fill="none" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
  $('prof').innerHTML=s;
  $('paxis').innerHTML=`<span>0 km</span><span>${Math.round(lo0)}–${Math.round(hi0)} m</span><span>${(a.dist/1000).toFixed(2)} km</span>`;
}
