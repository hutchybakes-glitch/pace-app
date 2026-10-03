// Settings: live feedback options, segmentation thresholds and effort coefficients, kept in
// localStorage. Settings apply to routes shown on Setup and to new runs; a run in progress keeps
// the plan it started with.
import {DEF} from './route.js';
import {COEF,effort} from './pacing.js';

export const DEFAULTS={S:5,amber:false,speed:false,
  up:DEF.up,down:DEF.down,minLen:DEF.minLen,smooth:DEF.smooth,
  cUp:COEF.up,cDown:COEF.down,taper:COEF.taper};

// Editable number fields as shown: pct = shown as % (stored /100), neg = shown positive (stored negative)
export const FIELDS={
  S:{min:1,max:60},up:{min:0.5,max:10},down:{min:0.5,max:10,neg:true},minLen:{min:50,max:2000},smooth:{min:20,max:300},
  cUp:{min:0,max:10,pct:true},cDown:{min:0,max:5,pct:true},taper:{min:2,max:30,neg:true},
};
// Shown text → stored value, or null if out of range
export function parseField(k,str){
  const f=FIELDS[k],t=String(str).replace(',','.').trim(),v=+t;
  if(t===''||!isFinite(v)||v<f.min||v>f.max)return null;
  const x=f.pct?+(v/100).toFixed(6):v;
  return f.neg?-x:x;
}
export function showField(k,v){
  const f=FIELDS[k];let x=f.neg?-v:v;
  if(f.pct)x*=100;
  return String(+x.toFixed(3));
}

const KEY='settings';
function load(){
  try{const s=JSON.parse(localStorage.getItem(KEY)||'null');if(s)return {...DEFAULTS,...s}}catch(e){}
  const o={...DEFAULTS};
  try{const S=+localStorage.getItem('sens');if(S)o.S=S;o.amber=localStorage.getItem('amber')==='1'}catch(e){} // phase 3 keys
  return o;
}
let cur=load();
export const settings=()=>cur;
export function setSettings(p){cur={...cur,...p};try{localStorage.setItem(KEY,JSON.stringify(cur))}catch(e){}}
export const routeOpts=s=>({up:s.up,down:s.down,minLen:s.minLen,smooth:s.smooth});
export const coef=s=>({up:s.cUp,down:s.cDown,taper:s.taper});

// ---- Settings screen ----
const $=id=>document.getElementById(id);

// onChange() lets Setup re-analyse the selected route; preview() → "9 segments on <route>" or ''
export function initSettings({onChange,preview}){
  const fill=()=>{
    for(const k in FIELDS){$('s-'+k).value=showField(k,cur[k]);$('s-'+k).classList.remove('bad')}
    $('s-amber').checked=cur.amber;
    $('s-speed-'+(cur.speed?'on':'off')).checked=true;
    drawEffort();$('s-preview').textContent=preview();
  };
  const changed=()=>{onChange();drawEffort();$('s-preview').textContent=preview()};
  for(const k in FIELDS)$('s-'+k).onchange=e=>{
    const v=parseField(k,e.target.value);
    if(v==null){e.target.classList.add('bad');return}
    e.target.classList.remove('bad');setSettings({[k]:v});changed();
  };
  $('s-amber').onchange=e=>{setSettings({amber:e.target.checked});changed()};
  for(const id of ['s-speed-on','s-speed-off'])$(id).onchange=()=>{setSettings({speed:$('s-speed-on').checked});changed()};
  $('s-reset').onclick=()=>{if(!confirm('Reset all settings to defaults?'))return;setSettings({...DEFAULTS});fill();onChange()};
  fill();
  return fill;
}

// Effort factor curve over -20 %…+15 % grade, with the climb/descent thresholds marked
function drawEffort(){
  const c=coef(cur),W=320,H=150,g0=-20,g1=15,f0=0.7,f1=1.55;
  const X=g=>((g-g0)/(g1-g0)*W).toFixed(1),Y=f=>(H-(f-f0)/(f1-f0)*H).toFixed(1);
  let p='';for(let g=g0;g<=g1;g+=0.5)p+=(p?'L':'M')+X(g)+','+Y(effort(g,c));
  let s=`<rect x="${X(cur.down)}" y="0" width="${X(cur.up)-X(cur.down)}" height="${H}" fill="currentColor" fill-opacity=".07"/>`;
  for(const g of [-20,-10,0,10])s+=`<line x1="${X(g)}" x2="${X(g)}" y1="0" y2="${H}" stroke="currentColor" stroke-opacity=".12"/><text x="${+X(g)+3}" y="${H-4}">${g>0?'+':''}${g}%</text>`;
  for(const f of [0.8,1,1.2,1.4])s+=`<line x1="0" x2="${W}" y1="${Y(f)}" y2="${Y(f)}" stroke="currentColor" stroke-opacity="${f===1?.35:.12}"/><text x="3" y="${+Y(f)-3}">×${f}</text>`;
  s+=`<path d="${p}" fill="none" stroke="#4ade80" stroke-width="2.5"/>`;
  $('s-curve').innerHTML=s;
  const ex=g=>{const f=effort(g,c);return `${g>0?'+':''}${g}% → ${f>=1?'+':'−'}${Math.round(Math.abs(f-1)*100)}%`};
  $('s-curve-note').textContent=`Pace change on: ${ex(5)} · ${ex(-5)} · ${ex(-15)}`;
}
