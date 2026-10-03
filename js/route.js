// Route: GPX parse, 10 m resample, DEM elevation fill, smoothing and gradient segmentation.
// No DOM access (fillElevation takes fetch as a parameter), so it all runs under node --test.
import {hav} from './gps.js';

// step/smooth/minLen in metres, up/down grade thresholds in %
export const DEF={step:10,smooth:60,up:2,down:-2,minLen:250};

// Segment classes for display
export const SEGCOL={up:'#e07a2e',down:'#3b82f6',flat:'#6b7280'},ICON={up:'▲',down:'▼',flat:'▬'},NAME={up:'Climb',down:'Descent',flat:'Flat'};

const ent=s=>s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');

// Returns {name, pts:[{lat,lon,ele|null}]}. Uses trkpt if present, else rtept.
export function parseGPX(xml){
  // Route name: first <name> outside waypoints and points (those are cue names like "Turn left")
  const outer=xml.replace(/<(wpt|trkpt|rtept)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g,'');
  const nm=outer.match(/<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/);
  const read=tag=>{
    const out=[],re=new RegExp(String.raw`<${tag}\b([^>]*?)(?:\/>|>([\s\S]*?)<\/${tag}\s*>)`,'g');let m;
    while((m=re.exec(xml))){
      const lat=+(m[1].match(/\blat\s*=\s*["']([^"']+)/)||[])[1],lon=+(m[1].match(/\blon\s*=\s*["']([^"']+)/)||[])[1];
      if(!isFinite(lat)||!isFinite(lon))continue;
      const e=m[2]&&m[2].match(/<ele>\s*([^<\s]+)/);
      out.push({lat,lon,ele:e&&isFinite(+e[1])?+e[1]:null});
    }
    return out;
  };
  let pts=read('trkpt');if(!pts.length)pts=read('rtept');
  return {name:nm?ent(nm[1]).trim():'',pts};
}

// Points every `step` metres along the route, plus the finish: [{d,lat,lon,ele|null}]
export function resample(pts,step=DEF.step){
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+hav(pts[i-1],pts[i]));
  const total=cum[cum.length-1];
  if(pts.length<2||total<2*step)throw new Error('Route is too short');
  let j=0;
  const at=d=>{
    while(j<cum.length-2&&cum[j+1]<d)j++;
    const span=cum[j+1]-cum[j],f=span?(d-cum[j])/span:0,a=pts[j],b=pts[j+1];
    return {d,lat:a.lat+(b.lat-a.lat)*f,lon:a.lon+(b.lon-a.lon)*f,ele:a.ele==null||b.ele==null?null:a.ele+(b.ele-a.ele)*f};
  };
  const out=[];
  for(let k=0;k*step<total-1;k++)out.push(at(k*step)); // last gap is 1..11 m, never ~0
  out.push(at(total));
  return out;
}

// Looks up every `every`-th sample on the Open-Meteo DEM (100 coords per request) and
// interpolates between them. Returns new samples with ele filled.
export async function fillElevation(s,fetchFn=fetch,every=5,onProgress){
  const key=[];for(let i=0;i<s.length;i+=every)key.push(i);
  if(key[key.length-1]!==s.length-1)key.push(s.length-1);
  const ele=[],n=Math.ceil(key.length/100);
  for(let b=0;b<key.length;b+=100){
    const ch=key.slice(b,b+100),q=f=>ch.map(i=>s[i][f].toFixed(5)).join(',');
    onProgress?.(b/100+1,n);
    const r=await fetchFn(`https://api.open-meteo.com/v1/elevation?latitude=${q('lat')}&longitude=${q('lon')}`);
    if(!r.ok)throw new Error(`Elevation lookup failed (HTTP ${r.status})`);
    const j=await r.json();
    if(!Array.isArray(j.elevation)||j.elevation.length!==ch.length)throw new Error('Elevation lookup returned unexpected data');
    ele.push(...j.elevation);
  }
  let k=0;
  return s.map((p,i)=>{
    while(k<key.length-2&&key[k+1]<i)k++;
    const a=s[key[k]],b=s[key[k+1]],f=(p.d-a.d)/(b.d-a.d);
    return {...p,ele:ele[k]+(ele[k+1]-ele[k])*f};
  });
}

// Centred moving average of elevation over `win` metres
export function smooth(s,win=DEF.smooth){
  const h=win/2,out=[];let a=0,b=0,sum=0;
  for(let i=0;i<s.length;i++){
    while(b<s.length&&s[b].d<=s[i].d+h)sum+=s[b++].ele;
    while(s[a].d<s[i].d-h)sum-=s[a++].ele;
    out.push(sum/(b-a));
  }
  return out;
}

// Classify each step by grade, merge runs, then fold segments shorter than minLen into the
// neighbour with the closest grade until stable. Segment grade = net climb / length.
// Returns [{id,i0,i1,d0,d1,len,g,cls}] where i0/i1 index into s and cls is up|down|flat.
export function segment(s,es,o={}){
  o={...DEF,...o};
  const cls=g=>g>o.up?'up':g<o.down?'down':'flat';
  const mk=(i0,i1)=>{const d0=s[i0].d,d1=s[i1].d,len=d1-d0,g=len>0?(es[i1]-es[i0])/len*100:0;return {i0,i1,d0,d1,len,g,cls:cls(g)}};
  let segs=[];
  for(let i=1;i<s.length;i++){
    const c=cls((es[i]-es[i-1])/(s[i].d-s[i-1].d)*100),L=segs[segs.length-1];
    if(L&&L.cls===c)L.i1=i;else segs.push({i0:i-1,i1:i,cls:c});
  }
  segs=segs.map(x=>mk(x.i0,x.i1));
  for(;;){
    segs=segs.reduce((a,x)=>{const L=a[a.length-1];if(L&&L.cls===x.cls)a[a.length-1]=mk(L.i0,x.i1);else a.push(x);return a},[]);
    let k=-1;segs.forEach((x,i)=>{if(x.len<o.minLen&&(k<0||x.len<segs[k].len))k=i});
    if(k<0||segs.length<2)break;
    const x=segs[k],L=segs[k-1],R=segs[k+1];
    const a=!R||(L&&Math.abs(L.g-x.g)<=Math.abs(R.g-x.g))?k-1:k; // merge pair starts here
    segs.splice(a,2,mk(segs[a].i0,segs[a+1].i1));
  }
  return segs.map((x,id)=>({id,...x}));
}

// Everything the Setup screen needs from stored samples
export function analyse(s,o={}){
  o={...DEF,...o};
  const es=smooth(s,o.smooth);let gain=0,loss=0;
  for(let i=1;i<es.length;i++){const d=es[i]-es[i-1];if(d>0)gain+=d;else loss-=d}
  return {dist:s[s.length-1].d,es,gain,loss,segs:segment(s,es,o)};
}
