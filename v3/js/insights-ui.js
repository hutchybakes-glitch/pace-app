// The Insights tab: draws what analysis.js learned. All charts are inline SVG.
import {pctAt,effortOf,TYPICAL,RACES,KINDS} from './analysis.js';

const fmt=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const pct=x=>`${Math.abs(x).toFixed(0)} %`;
// Run kinds: the same colours everywhere (Insights, Runs, results)
export const KCOL={race:'#fb923c',tempo:'#facc15',easy:'#4ade80',long:'#2dd4bf',int:'#c084fc'};
const C={you:'#c084fc',typ:'#64748b',grid:'rgba(148,163,184,.14)',txt:'#8796b0',up:'#f87171',down:'#4ade80',blue:'#60a5fa',pacer:'#fb923c'};

// Six axes, 50 = a typical runner; missing scores drawn as a dashed "not known yet"
const AXES=[['climb','Climbing'],['descent','Descending'],['pacing','Pacing'],['endurance','Endurance'],['cadence','Cadence'],['speed','Speed']];
export function radar(s){
  const W=360,cx=180,cy=170,R=118,n=AXES.length,ang=i=>-Math.PI/2+i*2*Math.PI/n,P=(i,v)=>[cx+Math.cos(ang(i))*R*v/100,cy+Math.sin(ang(i))*R*v/100];
  let g=`<defs><radialGradient id="rg" cx="50%" cy="50%" r="60%"><stop offset="0" stop-color="#c084fc" stop-opacity=".15"/><stop offset="1" stop-color="#fb923c" stop-opacity=".55"/></radialGradient></defs>`;
  for(const v of [25,50,75,100])g+=`<polygon points="${AXES.map((_,i)=>P(i,v).join(',')).join(' ')}" fill="none" stroke="${v===50?'rgba(255,255,255,.28)':C.grid}" ${v===50?'stroke-dasharray="4 4"':''}/>`;
  AXES.forEach((_,i)=>{const [x,y]=P(i,100);g+=`<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${C.grid}"/>`});
  const pts=AXES.map(([k],i)=>P(i,s[k]??50));
  g+=`<polygon points="${pts.map(p=>p.join(',')).join(' ')}" fill="url(#rg)" stroke="#e9d5ff" stroke-width="2.5" stroke-linejoin="round"/>`;
  AXES.forEach(([k,name],i)=>{
    const [x,y]=P(i,s[k]??50),[lx,ly]=P(i,128),known=s[k]!=null;
    g+=`<circle cx="${x}" cy="${y}" r="5" fill="${known?'#fff':'#475569'}"/>`;
    g+=`<text x="${lx}" y="${ly-4}" fill="${known?'#e2e8f0':'#64748b'}" font-size="13" font-weight="700" text-anchor="middle">${name}</text>`+
      `<text x="${lx}" y="${ly+12}" fill="${known?'#fff':'#64748b'}" font-size="14" font-weight="800" text-anchor="middle">${known?s[k]:'?'}</text>`;
  });
  return `<svg viewBox="0 0 ${W} 340" role="img" aria-label="Your runner profile">${g}</svg>`;
}

// Your pace change with gradient against a typical runner's, with your data as dots
function hillChart(A){
  const W=640,H=300,L=46,Rr=626,T=16,B=262,g0=-10,g1=10,lo=-30,hi=45;
  const X=g=>L+(g-g0)/(g1-g0)*(Rr-L),Y=p=>T+(hi-p)/(hi-lo)*(B-T);
  let s='';
  for(const p of [-30,-15,0,15,30,45])s+=`<line x1="${L}" x2="${Rr}" y1="${Y(p)}" y2="${Y(p)}" stroke="${p===0?'rgba(255,255,255,.3)':C.grid}"/><text x="${L-8}" y="${Y(p)+4}" fill="${C.txt}" font-size="12" text-anchor="end">${p>0?'+':''}${p}%</text>`;
  for(const g of [-10,-5,0,5,10])s+=`<text x="${X(g)}" y="${B+20}" fill="${C.txt}" font-size="12" text-anchor="middle">${g>0?'+':''}${g}%</text>`;
  s+=`<rect x="${X(0)}" y="${T}" width="${Rr-X(0)}" height="${B-T}" fill="rgba(248,113,113,.05)"/><rect x="${L}" y="${T}" width="${X(0)-L}" height="${B-T}" fill="rgba(74,222,128,.05)"/>`;
  for(const b of A.hills){const p=(b.r-1)*100;if(p<lo||p>hi)continue;s+=`<circle cx="${X(b.grade)}" cy="${Y(p)}" r="${Math.min(9,3+Math.sqrt(b.n))}" fill="${C.you}" fill-opacity=".28"/>`}
  const line=m=>{let d='';for(let g=g0;g<=g1+1e-9;g+=0.25)d+=`${d?'L':'M'}${X(g).toFixed(1)} ${Y(pctAt(m,g)).toFixed(1)}`;return d};
  s+=`<path d="${line(TYPICAL)}" fill="none" stroke="${C.typ}" stroke-width="3" stroke-dasharray="7 6"/>`;
  s+=`<path d="${line(A.model)}" fill="none" stroke="${C.you}" stroke-width="4" stroke-linecap="round"/>`;
  s+=`<text x="${X(-9.6)}" y="${T+16}" fill="${C.down}" font-size="12" font-weight="700">DOWNHILL</text><text x="${X(9.6)}" y="${T+16}" fill="${C.up}" font-size="12" font-weight="700" text-anchor="end">UPHILL</text>`;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="How much slower or quicker you run by gradient">${s}</svg>`;
}

// Form over time: every run as a dot at its 10 km-equivalent pace (hills taken out), coloured by kind,
// and your form (the strongest of the last six weeks) as the line. Quicker is higher.
function fitnessChart(A){
  const per=A.per.slice(-60),W=640,H=250,L=56,Rr=620,T=16,B=206;
  if(per.length<2)return '';
  const t0=per[0].run.started,t1=Math.max(per.at(-1).run.started,t0+864e5),fs=per.map(x=>x.form);
  let lo=Math.min(...fs),hi=Math.min(Math.max(...per.map(x=>x.eq)),lo*1.32);const pad=Math.max(4,(hi-lo)*0.08);lo-=pad;hi+=pad;
  const X=t=>L+(t-t0)/(t1-t0)*(Rr-L),Y=p=>T+(Math.min(p,hi)-lo)/(hi-lo)*(B-T);
  let s='';
  for(const p of [lo+pad,(lo+hi)/2,hi-pad])s+=`<line x1="${L}" x2="${Rr}" y1="${Y(p)}" y2="${Y(p)}" stroke="${C.grid}"/><text x="${L-8}" y="${Y(p)+4}" fill="${C.txt}" font-size="12" text-anchor="end">${fmt(p)}</text>`;
  // form: a step line (it only moves when a run beats it, or the best drops out of the six weeks)
  let d='';per.forEach((x,i)=>{const px=X(x.run.started).toFixed(1),py=Y(x.form).toFixed(1);d+=i?`H${px}V${py}`:`M${px} ${py}`});
  s+=`<path d="${d}V${B}H${X(t0)}Z" fill="url(#fg)"/><path d="${d}" fill="none" stroke="${C.blue}" stroke-width="3" stroke-linejoin="round"/>`;
  for(const x of per)s+=`<circle cx="${X(x.run.started).toFixed(1)}" cy="${Y(x.eq).toFixed(1)}" r="${x.kind==='race'?6:4.5}" fill="${KCOL[x.kind]||C.blue}" fill-opacity="${x.kind==='race'?1:.75}" stroke="#0d1529" stroke-width="2"/>`;
  const day=ms=>new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short'});
  s+=`<text x="${L}" y="${B+24}" fill="${C.txt}" font-size="12">${day(t0)}</text><text x="${Rr}" y="${B+24}" fill="${C.txt}" font-size="12" text-anchor="end">${day(t1)}</text>`;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your form over time, with every run by kind"><defs><linearGradient id="fg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${C.blue}" stop-opacity=".3"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></linearGradient></defs>${s}</svg>`;
}
const kindKey=A=>{const n={};for(const x of A.per)n[x.kind]=(n[x.kind]||0)+1;
  return `<div class="lg">${Object.keys(KCOL).filter(k=>n[k]).map(k=>`<span><i class="kdot" style="background:${KCOL[k]}"></i>${KINDS[k].name} ${n[k]}</span>`).join('')}<span><i style="background:${C.blue}"></i>Form</span></div>`};

// Cadence against pace, with your line
function cadenceChart(c){
  const W=640,H=240,L=50,Rr=620,T=14,B=200,P=c.points.filter(p=>p.v>1.6&&p.v<7);if(P.length<5)return '';
  const vs=P.map(p=>p.v),cs=P.map(p=>p.c),v0=Math.min(...vs)-0.1,v1=Math.max(...vs)+0.1,lo=Math.min(...cs)-4,hi=Math.max(...cs)+4;
  const X=v=>L+(v-v0)/(v1-v0)*(Rr-L),Y=x=>T+(hi-x)/(hi-lo)*(B-T);
  let s='';
  for(const x of [lo+4,(lo+hi)/2,hi-4])s+=`<line x1="${L}" x2="${Rr}" y1="${Y(x)}" y2="${Y(x)}" stroke="${C.grid}"/><text x="${L-8}" y="${Y(x)+4}" fill="${C.txt}" font-size="12" text-anchor="end">${Math.round(x)}</text>`;
  for(const p of P.slice(-600))s+=`<circle cx="${X(p.v).toFixed(1)}" cy="${Y(p.c).toFixed(1)}" r="2.6" fill="${p.g>3?C.up:p.g<-3?C.down:'#a5b4fc'}" fill-opacity=".5"/>`;
  s+=`<line x1="${X(v0)}" y1="${Y(c.at(v0))}" x2="${X(v1)}" y2="${Y(c.at(v1))}" stroke="#fff" stroke-width="3"/>`;
  for(const v of [v0+0.1,(v0+v1)/2,v1-0.1])s+=`<text x="${X(v)}" y="${B+20}" fill="${C.txt}" font-size="12" text-anchor="middle">${fmt(1000/v)}/km</text>`;
  return `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your cadence against pace">${s}</svg>`;
}

const bar=(name,v,col)=>v==null?`<div class="scorebar"><span>${name}</span><div class="tr"></div><b style="color:#64748b">?</b></div>`
  :`<div class="scorebar"><span>${name}</span><div class="tr"><i style="width:${v}%;background:${col}"></i></div><b>${v}</b></div>`;

// el: container; A: analyse() result; o: {meOn, onMe(on), runsNeeded}
export function renderInsights(el,A,o={}){
  if(!A.ready){
    el.innerHTML=`<div class="card ins-empty"><div class="big">🧬</div><h2>Your Runner DNA</h2><p>Pacer learns how <b>you</b> run: how hills slow you, how you use descents, how evenly you pace and how your cadence changes. Run a route with Pacer, or import a run from Strava or Garmin, and it appears here.</p>
      <div class="bar"><i style="width:${Math.min(100,(A.runs/(A.need||1))*100)}%"></i></div><small class="note">${A.runs} of ${A.need} run${A.need>1?'s':''} with GPS and a route</small></div>`;
    return;
  }
  const m=A.model,s=A.scores,t=A.type,up5=pctAt(m,5),dn5=pctAt(m,-5),tu5=pctAt(TYPICAL,5),td5=pctAt(TYPICAL,-5);
  const conf=A.segs<200?'Early days: this sharpens with every run.':A.segs<800?'Getting a clear picture.':'Based on plenty of your running.';
  let h=`<div class="card dna"><div class="eyebrow">Your Runner DNA</div><div class="type">${t.icon}</div><h2>${t.name}</h2><p>${t.desc}</p>${radar(s)}
    <div class="meta2">Learned from ${A.runs} run${A.runs>1?'s':''} · ${A.km.toFixed(0)} km · ${A.segs} stretches of 100 m. ${conf} 50 = a typical runner.</div></div>`;

  // hills
  h+=`<div class="card ins"><h3>⛰️ How hills affect you</h3>
    <p class="lead">Up a 5 % climb you slow by <b>${pct(up5)}</b> (typical runner: ${pct(tu5)}). Down a 5 % descent you're <b>${pct(dn5)} quicker</b> (typical: ${pct(td5)}).</p>
    ${hillChart(A)}
    <div class="lg"><span><i style="background:${C.you}"></i>You</span><span><i style="background:${C.typ}"></i>Typical runner</span><span>● your stretches, by gradient</span></div>
    ${bar('Climbing',s.climb,'linear-gradient(90deg,#fca5a5,#ef4444)')}${bar('Descending',s.descent,'linear-gradient(90deg,#86efac,#16a34a)')}
    <div class="mepacer"><span><b>“Like you” pacer:</b> a pacer that takes the hills exactly as you do, so the gap shows only your fitness on the day, not your hill style.</span><button id="ins-me" class="switch ${o.meOn?'on':''}" role="switch" aria-checked="${!!o.meOn}"></button></div></div>`;

  // form, bests and predictions
  const tr=A.trend,first=A.per[0]?.form;
  h+=`<div class="card ins"><h3>📈 Form</h3>
    <p class="lead">${A.form?`Right now you're worth about <b>${fmt(A.form*10)}</b> for 10 km on the flat (<b>${fmt(A.form)}/km</b>)`:`No runs in the last six weeks: your form fades from view`}.${tr==null?'':Math.abs(tr)<1?' Holding steady.':tr<0?` Getting quicker: <b>${Math.abs(tr).toFixed(1)} s/km a month</b>.`:` ${tr.toFixed(1)} s/km a month slower lately.`}${A.form&&first&&first-A.form>=2?` That's <b>${fmt((first-A.form)*10)}</b> quicker over 10 km than when you started.`:''}</p>
    ${fitnessChart(A)}${kindKey(A)}
    <p class="note">Every run as the 10 km pace it was worth, hills taken out; the line is your strongest of the last six weeks. Easy runs sit well below it, as they should.</p>
    ${A.predict.length?`<div class="h sp">Race predictions · flat course</div><div class="preds">${A.predict.map(p=>`<div><span>${p.name}</span><b>${fmt(p.t)}</b><small>${fmt(p.t/(p.d/1000))}/km</small></div>`).join('')}</div>
    <p class="note">From your strongest recent run (Riegel's formula). Hilly races take longer: race their course here and the pacer works it out.</p>`:''}
    ${bar('Speed',s.speed,'linear-gradient(90deg,#93c5fd,#2563eb)')}</div>`;
  if(o.bests?.length)h+=`<div class="card ins"><h3>🏅 Personal bests</h3><p class="lead">Your quickest time over each distance, anywhere inside a run. Tap one to see the run.</p><div class="pbs">${o.bests.map(b=>`<button data-run="${b.run.id}"><span>${b.name}</span><b>${fmt(b.t)}</b><small>${fmt(b.t/(b.d/1000))}/km · ${new Date(b.run.started).toLocaleDateString(undefined,{day:'numeric',month:'short'})}</small><small>${esc(b.run.route?.name||'')}</small></button>`).join('')}</div></div>`;

  // pacing
  if(A.cv!=null||A.fade!=null){
    const rf=A.raceFade;
    h+=`<div class="card ins"><h3>⏱️ Pacing</h3><div class="facts">
      ${rf!=null?`<div><i>🏁</i><span>${rf>1.5?`In your <b>${A.nRaces} races</b> the last third runs <b>${rf.toFixed(1)} % slower</b> than the first, hills taken out: you go out too hard. A pacer on even effort, or the Negative splitter, banks that time back.`:rf<-1?`In your <b>${A.nRaces} races</b> you finish <b>${Math.abs(rf).toFixed(1)} % quicker</b> than you start: patient, and strong late.`:`In your <b>${A.nRaces} races</b> you hold your effort evenly to the line. That's exactly how to race.`}</span></div>`:''}
      ${A.cv!=null?`<div><i>〰️</i><span>Your km-by-km effort varies by <b>${A.cv.toFixed(1)} %</b> in a typical hard run, hills taken out. ${A.cv<2.5?'Remarkably even.':A.cv<4.5?'Fairly even.':'Quite up and down: the pacer can smooth that out.'}</span></div>`:''}
      ${A.fade!=null&&rf==null?`<div><i>${A.fade>2?'📉':A.fade<-1?'🚀':'➡️'}</i><span>${A.fade>2?`You typically fade: the last third <b>${A.fade.toFixed(1)} % slower</b> than the first. Try the Negative splitter pacer.`:A.fade<-1?`You finish strong: the last third <b>${Math.abs(A.fade).toFixed(1)} % quicker</b> than the first.`:'You hold your effort to the end.'}</span></div>`:''}
    </div>${bar('Pacing',s.pacing,'linear-gradient(90deg,#fde68a,#f59e0b)')}${bar('Endurance',s.endurance,'linear-gradient(90deg,#fdba74,#ea580c)')}</div>`;
  }

  // cadence
  const c=A.cadence;
  if(c){
    const at=v=>Math.round(c.at(v)),v4=1000/240,v5=1000/300;
    h+=`<div class="card ins"><h3>👟 Cadence and stride</h3>
      <p class="lead">At 5:00/km you run at about <b>${at(v5)} steps a minute</b>, at 4:00/km about <b>${at(v4)}</b>.${c.b>=1?` That's ${c.b.toFixed(1)} more steps a minute for each m/s quicker${c.b<4?': you speed up mostly by lengthening your stride.':'.'}`:''}</p>
      ${cadenceChart(c)}
      <div class="lg"><span><i style="background:#a5b4fc"></i>flat</span><span><i style="background:${C.up}"></i>climbs</span><span><i style="background:${C.down}"></i>descents</span></div>
      <div class="facts">
        ${c.up!=null?`<div><i>↗️</i><span>On climbs your cadence goes ${c.up>=0?'up':'down'} by <b>${Math.abs(c.up).toFixed(0)} spm</b>${c.strideUp?` and your stride shortens to <b>${(c.strideUp*100).toFixed(0)} %</b> of your flat stride`:''}. ${c.up>=1?'Good: quick, short steps uphill.':'Try shorter, quicker steps uphill.'}</span></div>`:''}
        ${c.down!=null?`<div><i>↘️</i><span>On descents your cadence ${c.down<-2?`drops by <b>${Math.abs(c.down).toFixed(0)} spm</b>: you're overstriding, which brakes and loads the quads. Keep it quick and light.`:`holds within <b>${Math.abs(c.down).toFixed(0)} spm</b>: nicely quick and light.`}</span></div>`:''}
      </div>${bar('Cadence',s.cadence,'linear-gradient(90deg,#c4b5fd,#7c3aed)')}</div>`;
  }else h+=`<div class="card ins"><h3>👟 Cadence and stride</h3><p class="lead">Run with Pacer (it counts your steps with the phone's motion sensor) or import runs from a watch that records cadence, and your cadence profile appears here.</p></div>`;

  el.innerHTML=h;
  el.querySelector('#ins-me')?.addEventListener('click',()=>o.onMe?.(!o.meOn));
  el.querySelectorAll('.pbs button').forEach(b=>b.onclick=()=>o.onRun?.(+b.dataset.run));
}

// A few lines about one run, for its result page: what kind of run it was, how it compared with how you
// usually run, and any best efforts set in it. pbs: [{name, d, t}] bests set in this run
export function runFacts(A,r,flat,pbs=[]){
  const out=[];
  for(const b of pbs)out.push(`<div><i>🏅</i><span>New ${b.name} best: <b>${fmt(b.t)}</b> (${fmt(b.t/(b.d/1000))}/km).</span></div>`);
  const per=A?.ready&&flat?A.per.find(x=>x.run.id===r.id):null;
  if(per){
    const better=A.per.filter(x=>x.eq<per.eq).length,k=KINDS[per.kind];
    out.push(`<div><i>${k.icon}</i><span>${per.kind==='race'||per.kind==='tempo'?`${k.name} effort: worth <b>${fmt(per.eq*10)}</b> for 10 km on the flat${better===0&&A.per.length>1?', <b>your strongest effort yet</b>':`, #${better+1} of your ${A.per.length} runs`}.`
      :`${k.name} run: <b>${Math.round((per.ratio-1)*100)} %</b> off your best effort, hills taken out.${per.ratio<1.15?' A bit quick for an easy day.':' Nicely easy.'}`}</span></div>`);
    if(per.fade!=null)out.push(`<div><i>${per.fade>2?'📉':per.fade<-1?'🚀':'➡️'}</i><span>${per.fade>2?`Faded <b>${per.fade.toFixed(1)} %</b> over the last third.`:per.fade<-1?`Finished <b>${Math.abs(per.fade).toFixed(1)} %</b> quicker than you started.`:'Held your effort to the end.'}</span></div>`);
  }
  return out.length?`<div class="h">This run</div><div class="facts">${out.join('')}</div>`:'';
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export {RACES,effortOf};
