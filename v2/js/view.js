// Run view: a full-screen canvas showing the road coloured by gradient, you, and the pacer.
//   map   heading-up map of the road around you
//   front 3D chase view down the road ahead (hills raised so you can see them coming)
//   rear  3D view looking back down the road behind you
// The pacer's target pace is written on the road wherever it changes, your line carries an F1-style
// time gap (+ you're ahead, − the pacer is), and each line shows that runner's live pace: yours on
// the left end of the blue line, the pacer's on the right end of the orange one.
import {gradeRGB,paceMarks} from './pacer.js';

const ZE=1.7;                     // 3D: vertical exaggeration of the terrain
const HALF=4.5;                   // 3D: half road width, m
const ORANGE='#fb923c',ME='#60a5fa',GOOD='#4ade80';
const SKY_TOP=[2,6,23],HORIZON=[30,41,59],GROUND=[12,18,32];
const FONT='-apple-system,system-ui,sans-serif';
const rgb=a=>`rgb(${a[0]},${a[1]},${a[2]})`;
const mix=(a,b,t)=>[0,1,2].map(i=>Math.round(a[i]+(b[i]-a[i])*t));
const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const paceStr=p=>p&&p<1800?mmss(p):'--:--';
// F1-style gap text, + = you're ahead
export const gapText=g=>{const a=Math.abs(g),sign=a<0.05?'':g>0?'+':'−';return sign+(a<59.95?a.toFixed(1):mmss(a))};

export function createView(canvas){
  const ctx=canvas.getContext('2d');
  let W=1,H=1,R=null,hd=null,cd=null; // R: prepared route; hd: smoothed map heading; cd: smoothed 3D camera direction
  let top=0,bot=0,rgt=0;      // screen covered by overlays at the top, bottom and right, px

  function resize(){
    const dpr=Math.min(2,window.devicePixelRatio||1);
    W=canvas.clientWidth||1;H=canvas.clientHeight||1;
    canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function setInsets(t,b,r=0){top=t;bot=b;rgt=r}

  // pts: route points every 10 m; P: pacer (smoothed elevation, grade, pace); turns: nav turns
  function setRoute(pts,P,turns){
    const lat0=pts[0].lat,lon0=pts[0].lon,k=Math.cos(lat0*Math.PI/180)*111195,n=pts.length;
    const X=pts.map(p=>(p.lon-lon0)*k),Y=pts.map(p=>(p.lat-lat0)*111195);
    const TX=[],TY=[];
    for(let i=0;i<n;i++){const a=Math.max(0,i-2),b=Math.min(n-1,i+2),dx=X[b]-X[a],dy=Y[b]-Y[a],L=Math.hypot(dx,dy)||1;TX.push(dx/L);TY.push(dy/L)}
    R={n,D:pts.map(p=>p.d),X,Y,Z:P.es,TX,TY,C:P.grade.map(gradeRGB),total:pts[n-1].d,turns:turns||[],marks:paceMarks(P),lat0,lon0,k};
    hd=null;cd=null;
  }

  // Interpolated point at route distance d: {x,y,z,tx,ty}
  function at(d){
    d=Math.max(0,Math.min(R.total,d));
    let lo=0,hi=R.n-2;while(lo<hi){const m=(lo+hi+1)>>1;if(R.D[m]<=d)lo=m;else hi=m-1}
    const f=(d-R.D[lo])/((R.D[lo+1]-R.D[lo])||1),L=a=>a[lo]+(a[lo+1]-a[lo])*f;
    return {x:L(R.X),y:L(R.Y),z:L(R.Z),tx:L(R.TX),ty:L(R.TY),i:lo};
  }
  const idxOf=d=>Math.max(0,Math.min(R.n-1,Math.round(d/10)));

  // s: {mode, you (route m), pacer (route m or null), gap (s, + = you ahead, or null),
  //     youPace, pacerPace (s/km or null), gps {lat,lon} or null}
  function draw(s){
    if(!R)return;
    ctx.clearRect(0,0,W,H);
    if(s.mode==='map')drawMap(s);else draw3D(s,s.mode==='rear');
  }

  // ---------- shared bits ----------
  function dot(x,y,r,col){ctx.save();ctx.shadowColor=col;ctx.shadowBlur=14;ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill();ctx.shadowBlur=0;ctx.lineWidth=2.5;ctx.strokeStyle='#fff';ctx.stroke();ctx.restore()}
  function pill(text,x,y,bg,fg,size=11,alpha=1){
    ctx.save();ctx.globalAlpha=alpha;ctx.font=`800 ${size}px ${FONT}`;const w=ctx.measureText(text).width+size*1.1,h=size*1.65;
    ctx.fillStyle=bg;ctx.beginPath();ctx.roundRect?ctx.roundRect(x-w/2,y-h/2,w,h,h/2):ctx.rect(x-w/2,y-h/2,w,h);ctx.fill();
    ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,x,y+0.5);ctx.restore();
  }
  // Your time gap above your line: green when you're ahead, orange when the pacer is
  function gapLabel(g,x,y,size=15){
    if(g==null)return;
    const ahead=g>=0.05,level=Math.abs(g)<0.05;
    pill(gapText(g),x,y,level?'#e2e8f0':ahead?GOOD:ORANGE,level?'#0f172a':ahead?'#052e16':'#1c1003',size);
  }
  // Pace painted on the road: white with a dark outline so it reads on any colour
  function paceText(text,x,y,size,alpha=1){
    ctx.save();ctx.globalAlpha=alpha;ctx.font=`900 ${size}px ${FONT}`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.lineJoin='round';ctx.lineWidth=Math.max(3,size*0.28);ctx.strokeStyle='rgba(2,6,23,.9)';ctx.strokeText(text,x,y);
    ctx.fillStyle='#fff';ctx.fillText(text,x,y);ctx.restore();
  }

  // ---------- Map ----------
  function drawMap(s){
    const me=at(s.you),ah=at(s.you+40);
    let hx=ah.x-me.x,hy=ah.y-me.y,L=Math.hypot(hx,hy);
    if(L<1){hx=me.tx;hy=me.ty;L=1}
    hx/=L;hy/=L;
    if(!hd)hd={x:hx,y:hy};else{hd.x+=(hx-hd.x)*0.15;hd.y+=(hy-hd.y)*0.15;const l=Math.hypot(hd.x,hd.y)||1;hd.x/=l;hd.y/=l}
    const vw=Math.max(160,W-rgt),vh=Math.max(160,H-top-bot);
    const sc=Math.min(vw*1.25,vh)*0.78/220,ax=vw/2,ay=top+vh*0.72; // px per m; you sit low in the visible area
    const T=(x,y)=>{const dx=x-me.x,dy=y-me.y;return [ax+(dx*hd.y-dy*hd.x)*sc,ay-(dx*hd.x+dy*hd.y)*sc]};

    // Background with a faint world-aligned grid (it turns as you turn, which reads as movement)
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#070d1c');g.addColorStop(1,'#0d1527');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const reach=Math.hypot(W,H)/sc,step=50;
    ctx.strokeStyle='rgba(148,163,184,.07)';ctx.lineWidth=1;ctx.beginPath();
    for(let gx=Math.floor((me.x-reach)/step)*step;gx<=me.x+reach;gx+=step){ctx.moveTo(...T(gx,me.y-reach));ctx.lineTo(...T(gx,me.y+reach))}
    for(let gy=Math.floor((me.y-reach)/step)*step;gy<=me.y+reach;gy+=step){ctx.moveTo(...T(me.x-reach,gy));ctx.lineTo(...T(me.x+reach,gy))}
    ctx.stroke();

    // Road: casing then coloured by grade; the part already run dimmed
    const roadW=Math.max(16,10*sc),vis=[];
    for(let i=0;i<R.n-1;i++){if(Math.hypot(R.X[i]-me.x,R.Y[i]-me.y)<reach*0.8)vis.push(i)}
    ctx.lineCap='round';ctx.lineJoin='round';
    ctx.strokeStyle='#020617';ctx.lineWidth=roadW+7;ctx.beginPath();
    for(const i of vis){ctx.moveTo(...T(R.X[i],R.Y[i]));ctx.lineTo(...T(R.X[i+1],R.Y[i+1]))}
    ctx.stroke();
    ctx.lineWidth=roadW;
    for(const i of vis){ // solid colours (no transparency) so the round joins don't bead where they overlap
      ctx.strokeStyle=rgb(R.D[i+1]<=s.you?mix(R.C[i],[13,21,39],0.7):R.C[i]);
      ctx.beginPath();ctx.moveTo(...T(R.X[i],R.Y[i]));ctx.lineTo(...T(R.X[i+1],R.Y[i+1]));ctx.stroke();
    }

    const across=(d,col,width,dash,glow)=>{
      const p=at(d),w=roadW*0.95/sc,a=T(p.x+p.ty*w,p.y-p.tx*w),b=T(p.x-p.ty*w,p.y+p.tx*w);
      ctx.save();if(glow){ctx.shadowColor=col;ctx.shadowBlur=16}
      ctx.strokeStyle=col;ctx.lineWidth=width;ctx.lineCap='round';if(dash)ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.restore();
      return {c:T(p.x,p.y),right:a,left:b};
    };
    across(0,'#22c55e',5);across(R.total,'#ffffff',6,true);

    // Target pace written on the road ahead, wherever it changes
    const near=d=>Math.abs(d-s.you)<25||(s.pacer!=null&&Math.abs(d-s.pacer)<30)||R.turns.some(t=>Math.abs(t.d-d)<25);
    for(const m of R.marks){
      if(m.d<s.you+20||m.d>s.you+reach*0.75||near(m.d))continue;
      const p=at(m.d),q=T(p.x,p.y);paceText(mmss(m.pace),q[0],q[1],Math.max(13,Math.min(17,roadW*0.8)));
    }
    // km markers beside the road, upcoming turns on it
    for(let km=1000;km<R.total;km+=1000){if(Math.abs(km-s.you)>reach*0.8)continue;const p=at(km),o=roadW*1.1/sc,q=T(p.x+p.ty*o,p.y-p.tx*o);pill(`${km/1000} km`,q[0],q[1],'rgba(15,23,42,.85)','#cbd5e1')}
    for(const t of R.turns){if(t.d<s.you||t.d>s.you+450)continue;const p=at(t.d),q=T(p.x,p.y);turnMarker(q[0],q[1],t,hd,p)}

    // Lines across the road: the pacer's (orange) and yours (blue)
    let pq=null;
    if(s.pacer!=null){pq=across(s.pacer,ORANGE,5,false,true)}
    const yq=across(s.you,ME,4,false,true);
    // Off-route: where GPS actually puts you
    if(s.gps){const x=(s.gps.lon-R.lon0)*R.k,y=(s.gps.lat-R.lat0)*111195,q=T(x,y);dot(q[0],q[1],6,'#facc15')}
    // You: an arrow pointing up the screen (direction of travel)
    ctx.save();ctx.translate(ax,ay);ctx.shadowColor=ME;ctx.shadowBlur=18;
    ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(11,12);ctx.lineTo(0,6);ctx.lineTo(-11,12);ctx.closePath();ctx.fill();
    ctx.shadowBlur=0;ctx.strokeStyle=ME;ctx.lineWidth=2.5;ctx.stroke();ctx.restore();
    // Labels last so nothing covers them: PACER beside its line, your gap above you
    // Labels last so nothing covers them: live paces at the line ends, your gap above you
    const clampX=(x,w)=>Math.max(w/2+4,Math.min(vw-w/2-4,x));
    if(pq){dot(pq.c[0],pq.c[1],8,ORANGE);pill(`PACER ${paceStr(s.pacerPace)}`,clampX(pq.right[0]+48,86),pq.right[1],ORANGE,'#1c1003',13)}
    if(s.youPace!==undefined)pill(paceStr(s.youPace),clampX(yq.left[0]-32,56),yq.left[1],ME,'#06142e',14);
    gapLabel(s.gap,ax,ay-34,16);
  }

  // White disc with an arrow showing the turn relative to the road at that point
  function turnMarker(x,y,t,hd,p){
    const road=Math.atan2(p.tx*hd.y-p.ty*hd.x,p.tx*hd.x+p.ty*hd.y); // road direction on screen (0 = up)
    const a=road+(t.kind==='uturn'?Math.PI:t.angle*Math.PI/180);
    ctx.save();ctx.translate(x,y);ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=6;
    ctx.beginPath();ctx.arc(0,0,13,0,7);ctx.fill();ctx.shadowBlur=0;
    ctx.rotate(a);ctx.fillStyle='#0f172a';ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(6,2);ctx.lineTo(2,2);ctx.lineTo(2,8);ctx.lineTo(-2,8);ctx.lineTo(-2,2);ctx.lineTo(-6,2);ctx.closePath();ctx.fill();
    ctx.restore();
  }

  // ---------- 3D ----------
  function draw3D(s,rear){
    const me=at(s.you),dir=rear?-1:1,z0=me.z;
    // Chase camera: behind you along your direction of travel (smoothed, so corners swing it round
    // gently rather than throwing it sideways), looking past you down the road
    const a=at(s.you-15),b=at(s.you+25);let tx=b.x-a.x,ty=b.y-a.y,tl=Math.hypot(tx,ty);
    if(tl<1){tx=me.tx;ty=me.ty;tl=1}
    tx/=tl;ty/=tl;
    if(!cd)cd={x:tx,y:ty};else{cd.x+=(tx-cd.x)*0.12;cd.y+=(ty-cd.y)*0.12;const l=Math.hypot(cd.x,cd.y)||1;cd.x/=l;cd.y/=l}
    const ahead=at(s.you+dir*45);
    const E=[me.x-cd.x*dir*34,me.y-cd.y*dir*34,12],Tg=[me.x+cd.x*dir*45,me.y+cd.y*dir*45,(ahead.z-z0)*ZE+1];
    let f=[Tg[0]-E[0],Tg[1]-E[1],Tg[2]-E[2]];const fl=Math.hypot(...f);f=f.map(v=>v/fl);
    let r=[f[1],-f[0],0];const rl=Math.hypot(r[0],r[1])||1;r=r.map(v=>v/rl);
    const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]];
    const vw=Math.max(160,W-rgt),vh=Math.max(160,H-top-bot),F=Math.max(vw,vh*0.9)*0.95,cx=vw/2,cy=top+vh*0.36;
    const P=(x,y,z)=>{const v=[x-E[0],y-E[1],z-E[2]],zc=v[0]*f[0]+v[1]*f[1]+v[2]*f[2];if(zc<0.8)return null;return [cx+F*(v[0]*r[0]+v[1]*r[1]+v[2]*r[2])/zc,cy-F*(v[0]*u[0]+v[1]*u[1]+v[2]*u[2])/zc,zc]};
    const onRoad=(d,lift=0)=>{const p=at(d);return P(p.x,p.y,(p.z-z0)*ZE+lift)};

    // Sky and ground split at the horizon
    const hz=P(E[0]+f[0]*1e5/Math.hypot(f[0],f[1]),E[1]+f[1]*1e5/Math.hypot(f[0],f[1]),E[2]);
    const hy=hz?Math.max(-50,Math.min(H+50,hz[1])):H*0.3;
    const sky=ctx.createLinearGradient(0,0,0,hy);sky.addColorStop(0,rgb(SKY_TOP));sky.addColorStop(1,rgb(HORIZON));
    ctx.fillStyle=sky;ctx.fillRect(0,0,W,Math.max(0,hy)+1);
    const ground=ctx.createLinearGradient(0,hy,0,H);ground.addColorStop(0,rgb(mix(GROUND,HORIZON,0.6)));ground.addColorStop(1,rgb(GROUND));
    ctx.fillStyle=ground;ctx.fillRect(0,hy,W,H-hy);

    // Road segments within range, drawn far → near; each first paints the ground beneath it down to
    // the bottom of the screen, so nearer hills hide the road behind them
    const lo=rear?s.you-700:s.you-40,hi=rear?s.you+40:s.you+700,segs=[];
    for(let i=Math.max(0,idxOf(lo)-1);i<Math.min(R.n-1,idxOf(hi)+1);i++){
      const zA=(R.Z[i]-z0)*ZE,zB=(R.Z[i+1]-z0)*ZE;
      const nA=[R.TY[i],-R.TX[i]],nB=[R.TY[i+1],-R.TX[i+1]];
      const LA=P(R.X[i]+nA[0]*HALF,R.Y[i]+nA[1]*HALF,zA),RA=P(R.X[i]-nA[0]*HALF,R.Y[i]-nA[1]*HALF,zA);
      const LB=P(R.X[i+1]+nB[0]*HALF,R.Y[i+1]+nB[1]*HALF,zB),RB=P(R.X[i+1]-nB[0]*HALF,R.Y[i+1]-nB[1]*HALF,zB);
      if(!LA||!RA||!LB||!RB)continue;
      segs.push({i,LA,RA,LB,RB,z:(LA[2]+LB[2])/2,minY:Math.min(LA[1],RA[1],LB[1],RB[1]),x0:Math.min(LA[0],RA[0],LB[0],RB[0]),x1:Math.max(LA[0],RA[0],LB[0],RB[0])});
    }
    segs.sort((a,b)=>b.z-a.z);
    for(const q of segs){
      const fog=Math.min(1,q.z/650);
      ctx.fillStyle=ground; // same as the ground behind: invisible except where it hides road beyond a crest
      ctx.beginPath();ctx.moveTo(q.LA[0],q.LA[1]);ctx.lineTo(q.LB[0],q.LB[1]);ctx.lineTo(q.RB[0],q.RB[1]);ctx.lineTo(q.RA[0],q.RA[1]);
      ctx.lineTo(Math.max(q.RA[0],q.RB[0]),H+5);ctx.lineTo(Math.min(q.LA[0],q.LB[0]),H+5);ctx.closePath();ctx.fill();
      let c=mix(R.C[q.i],HORIZON,fog*0.75);if(R.D[q.i+1]<=s.you)c=mix(c,GROUND,0.5);
      ctx.fillStyle=rgb(c);ctx.strokeStyle=rgb(c);ctx.lineWidth=0.8;
      ctx.beginPath();ctx.moveTo(q.LA[0],q.LA[1]);ctx.lineTo(q.LB[0],q.LB[1]);ctx.lineTo(q.RB[0],q.RB[1]);ctx.lineTo(q.RA[0],q.RA[1]);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle=`rgba(255,255,255,${0.55*(1-fog)})`;ctx.lineWidth=Math.max(1,F*0.12/q.z);
      ctx.beginPath();ctx.moveTo(q.LA[0],q.LA[1]);ctx.lineTo(q.LB[0],q.LB[1]);ctx.moveTo(q.RA[0],q.RA[1]);ctx.lineTo(q.RB[0],q.RB[1]);ctx.stroke();
    }
    // Hidden behind a crest? (a nearer stretch of road rises above this point on screen)
    const hidden=pt=>segs.some(q=>q.z<pt[2]-8&&pt[0]>=q.x0&&pt[0]<=q.x1&&q.minY<pt[1]-3);

    const across=(d,col,w)=>{const p=at(d),z=(p.z-z0)*ZE+0.05,a=P(p.x+p.ty*HALF*1.15,p.y-p.tx*HALF*1.15,z),b=P(p.x-p.ty*HALF*1.15,p.y+p.tx*HALF*1.15,z);if(!a||!b||hidden(a))return null;ctx.save();ctx.shadowColor=col;ctx.shadowBlur=14;ctx.strokeStyle=col;ctx.lineCap='round';ctx.lineWidth=Math.max(2,F*w/a[2]);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();ctx.restore();return a};
    across(R.total,'#ffffff',0.35);across(0,'#22c55e',0.3);

    // Target pace painted on the road ahead (front view)
    if(!rear)for(const m of R.marks){
      if(m.d<s.you+12||m.d>s.you+450||(s.pacer!=null&&Math.abs(m.d-s.pacer)<15))continue;
      const pt=onRoad(m.d,0.1);if(!pt||hidden(pt))continue;
      const size=Math.max(10,Math.min(30,F*2.4/pt[2]));paceText(mmss(m.pace),pt[0],pt[1],size,Math.max(0.35,1-pt[2]/500));
    }

    // Runners, farther one first; each with its line across the road
    const figs=[{d:s.you,col:ME,me:true}];if(s.pacer!=null)figs.push({d:s.pacer,col:ORANGE});
    figs.forEach(o=>{o.base=onRoad(o.d)});
    figs.sort((a,b)=>(b.base?.[2]??-1)-(a.base?.[2]??-1));
    for(const o of figs){
      across(o.d,o.col,o.me?0.26:0.32);
      if(!o.base)continue;
      const head=onRoad(o.d,2.4);if(!head)continue;
      const ghost=!o.me&&hidden(o.base);           // pacer over a crest: shown faintly through the hill
      ctx.save();if(ghost)ctx.globalAlpha=0.4;figure(o.base,head,o.col,F);ctx.restore();
      const lift=Math.max(16,F*0.55/head[2]);
      const side=Math.max(44,F*1.1/head[2]);
      if(o.me){gapLabel(s.gap,head[0],head[1]-lift-4,15);if(s.youPace!==undefined)pill(paceStr(s.youPace),head[0]-side,head[1]+lift*0.4,ME,'#06142e',13)}
      else pill(`PACER ${paceStr(s.pacerPace)}`,head[0]+side+16,head[1],ORANGE,'#1c1003',12,ghost?0.6:1);
    }
    // Pacer out of view: an edge hint
    if(s.pacer!=null){
      const pc=figs.find(o=>!o.me),gap=s.pacer-s.you;
      if(!pc.base||Math.abs(gap)>700){
        const ahead=gap>0,toward=rear?!ahead:ahead;
        pill(`PACER ${Math.round(Math.abs(gap))} m ${ahead?'ahead':'behind'}`,vw/2,toward?Math.max(top+14,hy+18):H-bot-18,ORANGE,'#1c1003');
      }
    }
  }

  // A simple glowing runner: body line from feet to shoulders, head on top
  function figure(base,head,col,F){
    const z=base[2],w=Math.max(5,F*0.6/z),hr=Math.max(5,F*0.34/z);
    ctx.save();ctx.shadowColor=col;ctx.shadowBlur=20;ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineCap='round';
    ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(base[0],base[1]-w/2);ctx.lineTo(head[0],head[1]+hr*1.6);ctx.stroke();
    ctx.beginPath();ctx.arc(head[0],head[1],hr,0,7);ctx.fill();
    ctx.shadowBlur=0;ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(base[0],base[1],w*1.3,w*0.35,0,0,7);ctx.fill();
    ctx.restore();
  }

  return {resize,setRoute,setInsets,draw};
}
