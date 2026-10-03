// Live per-km chart (SVG): one bar per km = actual average pace (current km live), drawn against
// that km's target ± S band. Y axis inverted: faster = taller. Scrolls sideways on long routes.
import {band,fmt} from './pacing.js';

const COL={green:'#22c55e',amber:'#f59e0b',red:'#ef4444'};
const H=130,TOP=8,XL=16,AX=38,MIN_SLOT=30; // plot height, top pad, x-label row, y-axis width, min px per km

// Average pace (s/km) for each km from km split times (ms, by route distance); the last entry is the
// current km, live, once it is 50 m in
export function kmPaces(splits,t,rd){
  const out=splits.map((s,i)=>(s-(splits[i-1]||0))/1000);
  const dk=(rd-splits.length*1000)/1000;
  if(dk>=0.05)out.push((t-(splits.at(-1)||0))/1000/dk);
  return out;
}

// Pace range shown [fast, slow]: every target band plus actuals (clamped to ±2 min of the targets),
// padded and rounded to 15 s. Grid step 15/30/60 s by range.
export function domain(targets,paces,S){
  const lo=Math.min(...targets)-S,hi=Math.max(...targets)+S;
  const ps=paces.map(p=>Math.max(lo-120,Math.min(hi+120,p)));
  const fast=Math.floor((Math.min(lo,...ps)-10)/15)*15,slow=Math.ceil((Math.max(hi,...ps)+10)/15)*15;
  return {fast,slow,step:slow-fast>150?60:slow-fast>60?30:15};
}

let lastCur=-1;

// el contains .ch-y (axis svg) and .ch-scroll > .ch-bars (plot svg). live = last pace is the unfinished km.
export function renderChart(el,{targets,paces,live,S,amber}){
  const n=targets.length,sc=el.querySelector('.ch-scroll');
  const slot=Math.max(MIN_SLOT,(sc.clientWidth||300)/n),W=slot*n;
  const {fast,slow,step}=domain(targets,paces,S);
  const Y=p=>TOP+(Math.max(fast,Math.min(slow,p))-fast)/(slow-fast)*H,base=TOP+H;
  let grid='',ax='';
  for(let p=Math.ceil(fast/step)*step;p<=slow;p+=step){
    grid+=`<line x1="0" x2="${W}" y1="${Y(p)}" y2="${Y(p)}" stroke="#fff" stroke-opacity=".12"/>`;
    ax+=`<text x="${AX-4}" y="${Y(p)+4}" text-anchor="end">${fmt(p)}</text>`;
  }
  let s=grid;
  targets.forEach((tg,i)=>{
    const x=i*slot,y0=Y(tg-S),y1=Y(tg+S);
    s+=`<rect x="${x+2}" y="${y0}" width="${slot-4}" height="${y1-y0}" fill="#fff" fill-opacity=".16"/>`+
      `<line x1="${x+2}" x2="${x+slot-2}" y1="${y0}" y2="${y0}" stroke="#fff" stroke-opacity=".6"/>`+
      `<line x1="${x+2}" x2="${x+slot-2}" y1="${y1}" y2="${y1}" stroke="#fff" stroke-opacity=".6"/>`;
    const p=paces[i];
    if(p!=null){
      const y=Math.min(Y(p),base-2),isLive=live&&i===paces.length-1;
      s+=`<rect x="${x+slot*0.2}" y="${y}" width="${slot*0.6}" height="${base-y}" rx="2" fill="${COL[band(p,tg,S,amber)]}"${isLive?' fill-opacity=".7" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"':''}/>`;
    }
    s+=`<text x="${x+slot/2}" y="${base+XL-3}" text-anchor="middle">${i+1}</text>`;
  });
  const bars=el.querySelector('.ch-bars'),yax=el.querySelector('.ch-y'),h=base+XL;
  bars.setAttribute('width',W);bars.setAttribute('height',h);bars.innerHTML=s;
  yax.setAttribute('width',AX);yax.setAttribute('height',h);yax.innerHTML=ax;
  const cur=paces.length-1; // keep the current km in view, without fighting the user's own scrolling
  if(cur!==lastCur){lastCur=cur;sc.scrollLeft=Math.max(0,(cur+0.5)*slot-sc.clientWidth/2)}
}
