// Per-km chart (SVG): one bar per km = actual average pace (current km live), drawn against
// that km's target ± S band. Y axis inverted: faster = taller. Used live on the run screen
// (scrolls sideways on long routes) and, as static SVG, in the post-run report.
import {band,fmt} from './pacing.js';

export const COL={green:'#22c55e',amber:'#f59e0b',red:'#ef4444',none:'#3b82f6'};
const H=130,TOP=8,XL=16,AX=38,MIN_SLOT=30; // plot height, top pad, x-label row, y-axis width, min px per km

// Average pace (s/km) for each km from km split times (ms, by route distance); the last entry is the
// current km, live, once it is 50 m in
export function kmPaces(splits,t,rd){
  const out=splits.map((s,i)=>(s-(splits[i-1]||0))/1000);
  const dk=(rd-splits.length*1000)/1000;
  if(dk>=0.05)out.push((t-(splits.at(-1)||0))/1000/dk);
  return out;
}

// Pace range shown [fast, slow]: every target band (or the paces, with no targets) plus actuals
// clamped to ±2 min of that, padded and rounded to 15 s. Grid step 15/30/60 s by range.
export function domain(targets,paces,S){
  const ref=targets.length?targets:paces.length?paces:[300];
  const lo=Math.min(...ref)-S,hi=Math.max(...ref)+S;
  const ps=paces.map(p=>Math.max(lo-120,Math.min(hi+120,p)));
  const fast=Math.floor((Math.min(lo,...ps)-10)/15)*15,slow=Math.ceil((Math.max(hi,...ps)+10)/15)*15;
  return {fast,slow,step:slow-fast>150?60:slow-fast>60?30:15};
}

// SVG markup for the y axis and the plot, `slot` px per km. targets may be empty (free run: no
// band, neutral bars). live = last pace is the unfinished km. Lines and band use currentColor.
export function chartSVG({targets,paces,live,S,amber,slot}){
  const n=Math.max(targets.length,paces.length),W=slot*n,base=TOP+H,h=base+XL;
  const {fast,slow,step}=domain(targets,paces,S);
  const Y=p=>TOP+(Math.max(fast,Math.min(slow,p))-fast)/(slow-fast)*H;
  let s='',ax='';
  for(let p=Math.ceil(fast/step)*step;p<=slow;p+=step){
    s+=`<line x1="0" x2="${W}" y1="${Y(p)}" y2="${Y(p)}" stroke="currentColor" stroke-opacity=".12"/>`;
    ax+=`<text x="${AX-4}" y="${Y(p)+4}" text-anchor="end">${fmt(p)}</text>`;
  }
  for(let i=0;i<n;i++){
    const x=i*slot,tg=targets[i],p=paces[i];
    if(tg!=null){
      const y0=Y(tg-S),y1=Y(tg+S);
      s+=`<rect x="${x+2}" y="${y0}" width="${slot-4}" height="${y1-y0}" fill="currentColor" fill-opacity=".16"/>`+
        `<line x1="${x+2}" x2="${x+slot-2}" y1="${y0}" y2="${y0}" stroke="currentColor" stroke-opacity=".6"/>`+
        `<line x1="${x+2}" x2="${x+slot-2}" y1="${y1}" y2="${y1}" stroke="currentColor" stroke-opacity=".6"/>`;
    }
    if(p!=null){
      const y=Math.min(Y(p),base-2),isLive=live&&i===paces.length-1;
      s+=`<rect x="${x+slot*0.2}" y="${y}" width="${slot*0.6}" height="${base-y}" rx="2" fill="${tg!=null?COL[band(p,tg,S,amber)]:COL.none}"${isLive?' fill-opacity=".7" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2"':''}/>`;
    }
    s+=`<text x="${x+slot/2}" y="${base+XL-3}" text-anchor="middle">${i+1}</text>`;
  }
  return {axis:`<svg class="ch-y" width="${AX}" height="${h}" aria-hidden="true">${ax}</svg>`,
    bars:`<svg class="ch-bars" width="${W}" height="${h}" role="img" aria-label="Pace per km">${s}</svg>`};
}

let lastCur=-1;

// Live chart: el contains .ch-y and .ch-scroll > .ch-bars
export function renderChart(el,opts){
  const sc=el.querySelector('.ch-scroll'),n=opts.targets.length;
  const slot=Math.max(MIN_SLOT,(sc.clientWidth||300)/n),c=chartSVG({...opts,slot});
  el.querySelector('.ch-y').outerHTML=c.axis;
  el.querySelector('.ch-bars').outerHTML=c.bars;
  const cur=opts.paces.length-1; // keep the current km in view, without fighting the user's own scrolling
  if(cur!==lastCur){lastCur=cur;sc.scrollLeft=Math.max(0,(cur+0.5)*slot-sc.clientWidth/2)}
}
