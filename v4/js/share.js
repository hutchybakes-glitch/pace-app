// Sharing. Two things:
//   - Challenge links: a route and a run packed into a link (no server: it all lives in the link's #hash),
//     so a friend can open it and race your run as a ghost on the same course.
//   - Result cards: a picture of a run (route, time, result, splits) to post anywhere.
import {slice} from './courses.js';

// ---- Challenge links ----
// The route every S m (lat/lon to 1e-5°, about a metre; elevation to 0.1 m) and your time there (0.1 s),
// as zigzag varint deltas, deflated, base64url. A 10 km run comes to about 2 KB.
const zz=n=>n>=0?n*2:-n*2-1,unzz=n=>n%2?-(n+1)/2:n/2;
function putV(out,n){n=Math.round(n);while(n>=128){out.push((n&127)|128);n=Math.floor(n/128)}out.push(n)}
function getV(b,p){let n=0,m=1,x;do{x=b[p.i++];if(x===undefined)throw new Error('This challenge link is incomplete');n+=(x&127)*m;m*=128}while(x&128);return n}
const b64u=bytes=>{let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const unb64u=s=>{const t=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(t,c=>c.charCodeAt(0))};
async function pipe(bytes,stream){const r=new Response(new Blob([bytes]).stream().pipeThrough(stream));return new Uint8Array(await r.arrayBuffer())}
const canZip=()=>typeof CompressionStream!=='undefined';

// Your time (s) at route distance d in a run, from its fixes (null if it never got there)
export function timeAtD(run,d){
  const f=run.fixes||[];let i=f.findIndex(x=>x[6]>=d);if(i<0)return null;if(i===0)return f[0][1]/1000;
  const a=f[i-1],b=f[i];return (a[1]+(b[1]-a[1])*(d-a[6])/((b[6]-a[6])||1))/1000;
}

// Pack route pts (every 10 m) and a run on it. who: your name. Returns the link's hash value.
export async function encodeChallenge(pts,run,{who='',name=''}={}){
  const D=pts.at(-1).d,last=Math.min(D,run.rd??D),S=Math.max(20,Math.ceil(last/500/10)*10); // at most ~500 points
  const T=run.elapsed/1000,out=[];
  const head=new TextEncoder().encode(JSON.stringify({v:1,n:name,w:who,s:run.started,T:+T.toFixed(1),c:!!run.complete}));
  putV(out,head.length);out.push(...head);putV(out,S);putV(out,Math.round(last*10));
  const ds=[];for(let d=0;d<last;d+=S)ds.push(d);ds.push(last);
  putV(out,ds.length);
  let p=[0,0,0,0];
  for(const d of ds){
    const i=Math.min(pts.length-1,Math.round(d/10)),q=pts[i],t=d>=last&&run.complete?T:timeAtD(run,d)??T;
    const v=[Math.round(q.lat*1e5),Math.round(q.lon*1e5),Math.round((q.ele??0)*10),Math.round(t*10)];
    for(let k=0;k<4;k++){putV(out,zz(v[k]-p[k]))}p=v;
  }
  const raw=Uint8Array.from(out),zip=canZip()?await pipe(raw,new CompressionStream('deflate-raw')):null;
  const use=zip&&zip.length<raw.length,body=use?zip:raw;
  return b64u(Uint8Array.from([1,use?1:0,...body]));
}

// Unpack a challenge: {name, who, started, elapsed (s), complete, D, pts:[{d, lat, lon, ele, t}]}
export async function decodeChallenge(code){
  let b;try{b=unb64u(code)}catch(e){throw new Error("This challenge link isn't valid")}
  if(b[0]!==1)throw new Error('This challenge is from a newer version of Pacer');
  let body=b.slice(2);
  if(b[1]===1){if(!canZip())throw new Error("This browser can't open challenge links");body=await pipe(body,new DecompressionStream('deflate-raw'))}
  const p={i:0},hl=getV(body,p),h=JSON.parse(new TextDecoder().decode(body.slice(p.i,p.i+hl)));p.i+=hl;
  const S=getV(body,p),D=getV(body,p)/10,n=getV(body,p),pts=[];let v=[0,0,0,0];
  for(let k=0;k<n;k++){
    v=v.map(x=>x+unzz(getV(body,p)));
    pts.push({d:Math.min(D,k*S),lat:v[0]/1e5,lon:v[1]/1e5,ele:v[2]/10,t:v[3]/10});
  }
  if(pts.length>1)pts[pts.length-1].d=D;
  return {name:h.n,who:h.w,started:h.s,elapsed:h.T,complete:h.c,D,S,pts};
}

// The challenge's route, every 10 m (keeping its distances)
export const challengeRoute=c=>slice(c.pts,0,c.D);

// The challenger's run on route pts (from challengeRoute), as a saved run to race:
// fixes [ts, t ms, lat, lon, acc, gps m, route m, pace, cadence, stride, ran m]
export function challengeRun(c,pts){
  const P=c.pts,fx=[];let j=0;
  const tAt=d=>{while(j<P.length-2&&P[j+1].d<d)j++;const a=P[j],b=P[j+1]??a;return b.d>a.d?a.t+(b.t-a.t)*(d-a.d)/(b.d-a.d):a.t};
  for(const q of pts){const t=tAt(q.d);fx.push([c.started+t*1000,t*1000,q.lat,q.lon,5,q.d,q.d,null,null,null,q.d])}
  for(let i=0;i<fx.length;i++){const a=fx[Math.max(0,i-5)],b=fx[Math.min(fx.length-1,i+5)],dd=b[6]-a[6];fx[i][7]=dd>5?Math.round((b[1]-a[1])/(dd/1000)):null}
  const D=pts.at(-1).d,rsplits=[];for(let k=1000;k<=D;k+=1000){j=0;rsplits.push(Math.round(tAt(k)*1000))}
  return {started:c.started,status:'done',mode:'record',sim:false,imported:{name:c.who?`${c.who}'s run`:'Challenge',file:null,paused:0,challenge:true,who:c.who||null},
    fixes:fx,elapsed:Math.round(c.elapsed*1000),rd:D,yd:D,dist:D,rsplits,complete:c.complete};
}

// ---- Result cards ----
// Draw a 1080 × 1350 card on a 2D context. d: {title, big, line, stats:[[label, value]], pts (route, every
// 10 m), colors (one per point), splits:[{km, s, faster}], tag, accent}
export function drawCard(ctx,d){
  const W=1080,H=1350,A=d.accent||'#fb923c';
  const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,'#0b1a3a');bg.addColorStop(0.55,'#070d1c');bg.addColorStop(1,'#04070f');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const glow=ctx.createRadialGradient(W*0.8,120,10,W*0.8,120,620);glow.addColorStop(0,A+'55');glow.addColorStop(1,A+'00');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
  const font=(w,s)=>`${w} ${s}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
  // route
  const pts=d.pts||[];
  if(pts.length>1){
    const k=Math.cos(pts[0].lat*Math.PI/180),xs=pts.map(p=>p.lon*k),ys=pts.map(p=>-p.lat);
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),box={x:90,y:250,w:900,h:560};
    const sc=Math.min(box.w/((x1-x0)||1e-9),box.h/((y1-y0)||1e-9)),ox=box.x+(box.w-(x1-x0)*sc)/2,oy=box.y+(box.h-(y1-y0)*sc)/2;
    const X=i=>ox+(xs[i]-x0)*sc,Y=i=>oy+(ys[i]-y0)*sc;
    ctx.lineCap=ctx.lineJoin='round';
    ctx.strokeStyle='#000';ctx.lineWidth=26;ctx.beginPath();pts.forEach((_,i)=>i?ctx.lineTo(X(i),Y(i)):ctx.moveTo(X(i),Y(i)));ctx.stroke();
    ctx.lineWidth=14;
    for(let i=1;i<pts.length;i++){ctx.strokeStyle=d.colors?.[i]||A;ctx.beginPath();ctx.moveTo(X(i-1),Y(i-1));ctx.lineTo(X(i),Y(i));ctx.stroke()}
    const dot=(i,c)=>{ctx.fillStyle=c;ctx.strokeStyle='#000';ctx.lineWidth=6;ctx.beginPath();ctx.arc(X(i),Y(i),17,0,7);ctx.fill();ctx.stroke()};
    dot(pts.length-1,'#fff');dot(0,'#22c55e');
  }
  // text
  ctx.textAlign='left';ctx.fillStyle='#94a3b8';ctx.font=font(700,34);ctx.fillText((d.tag||'PACER').toUpperCase(),90,110);
  ctx.fillStyle='#fff';ctx.font=font(800,54);ctx.fillText(fit(ctx,d.title||'',900),90,180);
  ctx.font=font(900,150);ctx.fillStyle='#fff';ctx.fillText(d.big||'',84,980);
  ctx.font=font(800,48);ctx.fillStyle=A;ctx.fillText(fit(ctx,d.line||'',900),90,1050);
  // stats
  const st=d.stats||[];st.forEach(([l,v],i)=>{const x=90+i*(900/st.length);ctx.fillStyle='#fff';ctx.font=font(800,52);ctx.fillText(v,x,1150);ctx.fillStyle='#94a3b8';ctx.font=font(600,28);ctx.fillText(l.toUpperCase(),x,1192)});
  // splits as bars along the bottom
  const sp=d.splits||[];
  if(sp.length){const bw=Math.min(60,900/sp.length-6),lo=Math.min(...sp.map(s=>s.s)),hi=Math.max(...sp.map(s=>s.s));
    sp.forEach((s,i)=>{const h=24+(hi>lo?(hi-s.s)/(hi-lo):0.5)*46;ctx.fillStyle=s.faster==null?'#60a5fa':s.faster?'#4ade80':'#f87171';ctx.fillRect(90+i*(bw+6),1290-h,bw,h)})}
  ctx.textAlign='right';ctx.fillStyle='#64748b';ctx.font=font(700,28);ctx.fillText('pacer · race a pacer who knows every hill',990,1290);
}
function fit(ctx,s,w){if(ctx.measureText(s).width<=w)return s;while(s.length>1&&ctx.measureText(s+'…').width>w)s=s.slice(0,-1);return s+'…'}
