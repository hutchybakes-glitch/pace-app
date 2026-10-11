// The training plan as a fixed, versioned JSON document, and the only ways the coach may change it.
// Plan: weeks > days > sessions (type, distance or reps, target pace zone, notes), written out of the
// programme training.js builds. Changes are small JSON edits (swap_session, move_session,
// reduce_volume_pct, shift_pace_zone) proposed by the AI coach (or the rule-based coach when the laptop
// is away), checked here by code, shown to you, and kept only if you accept them. Accepted changes are
// stored as revisions and replayed onto the programme every time it's drawn.
// Rules every change must keep: a week's distance moves by at most 10 % (resting more is always allowed),
// no two hard days back to back, nothing in the past, tests and race day untouchable, and every pace comes
// from the pace calculator's zones. No DOM: runs under node --test.
import {ZONE_IDS} from './pace.js';
import {KINDS,HARD,standardSession,dayNum} from './training.js';

export const SCHEMA_NAME='pacer.plan',SCHEMA_VERSION=1;
export const MAX_EDITS=4,VOL_CAP=0.10;
export const DOW3=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
// Each session type: its default pace zone, the zones the coach may move it between, and whether it's locked
export const TYPES={
  rest:{zone:null,zones:[]},
  recovery:{zone:'recovery',zones:['recovery']},
  easy:{zone:'easy',zones:['recovery','easy']},
  strides:{zone:'easy',zones:['recovery','easy']},
  hillsprints:{zone:'easy',zones:['recovery','easy']},
  long:{zone:'easy',zones:['recovery','easy','steady']},
  sub:{zone:'subthreshold',zones:['steady','subthreshold','threshold']},
  hills:{zone:'interval',zones:['threshold','interval']},
  sharpener:{zone:'race',zones:['subthreshold','race']},
  rehearsal:{zone:'race',zones:['steady','subthreshold','race']},
  test:{zone:'race',zones:['race'],locked:true},
  race:{zone:'race',zones:['race'],locked:true},
};
// What a session can be swapped to
export const SWAP_TO=['rest','recovery','easy','strides','long','sub','hills'];
export const OPS=['swap_session','move_session','reduce_volume_pct','shift_pace_zone'];

// The plan document's JSON Schema (draft 2020-12): what toDoc writes and validateDoc checks
const sessionSchema={type:'object',required:['id','type','zone','hard'],additionalProperties:false,properties:{
  id:{type:'string'},type:{enum:Object.keys(TYPES)},title:{type:'string'},
  distance_m:{type:['number','null'],minimum:0},duration_s:{type:['number','null'],minimum:0},
  reps:{type:['object','null'],required:['count','length_m','rest_s'],properties:{count:{type:'integer',minimum:1},length_m:{type:'number',minimum:50},rest_s:{type:'number',minimum:0}}},
  zone:{enum:[...ZONE_IDS,null]},pace_s_per_km:{type:['number','null']},km:{type:'number',minimum:0},hard:{type:'boolean'},notes:{type:'string'},changed:{type:'boolean'}}};
export const PLAN_SCHEMA={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'pacer.plan/1',title:'Pacer training plan',type:'object',
  required:['schema','version','plan','weeks'],properties:{
    schema:{const:SCHEMA_NAME},version:{const:SCHEMA_VERSION},
    plan:{type:'object',required:['name','revision'],properties:{name:{type:'string'},revision:{type:'integer',minimum:1},
      race:{type:['object','null'],properties:{name:{type:'string'},distance_m:{type:'number'},date:{type:['string','null']}}},
      fitness:{type:['object','null'],properties:{vdot:{type:'number'},from:{type:'string'}}},units:{const:'km'}}},
    weeks:{type:'array',minItems:1,items:{type:'object',required:['week','phase','days'],properties:{
      week:{type:'integer',minimum:1},start:{type:['string','null']},phase:{enum:['base','build','peak','taper']},test:{type:'boolean'},focus:{type:'string'},target_km:{type:'number'},
      days:{type:'array',minItems:1,maxItems:7,items:{type:'object',required:['day','sessions'],properties:{date:{type:['string','null']},day:{enum:DOW3},sessions:{type:'array',items:sessionSchema}}}}}}},
    changes:{type:'array',items:{type:'object',required:['revision','edits'],properties:{revision:{type:'integer'},at:{type:'string'},source:{enum:['model','rules','you']},say:{type:'string'},edits:{type:'array'}}}}}};
// The edits the coach may propose (the model's reply is held to this exact shape)
export const EDITS_SCHEMA={type:'object',required:['edits','say'],additionalProperties:false,properties:{
  edits:{type:'array',maxItems:MAX_EDITS,items:{type:'object',required:['op'],properties:{
    op:{enum:OPS},session_id:{type:'string'},new_type:{enum:SWAP_TO},to_date:{type:'string'},week:{type:'integer'},pct:{type:'number'},direction:{enum:['easier','harder']}}}},
  say:{type:'string'}}};

const iso=ms=>{const d=new Date(ms),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`};
const r1=x=>Math.round(x*10)/10;
export const zoneOfSession=s=>s.zone??TYPES[s.kind]?.zone??null;

// ---- The document ----
// P: a programme from training.js (with any accepted changes applied). meta: {name, race:{name, distance_m,
// date (ms)}, vdot, from, revision, changes}. dated: false writes a template (days without dates).
export function toDoc(P,meta={},{dated=true}={}){
  const sessionDoc=d=>{
    const t=d.kind,z=zoneOfSession(d),reps=d.reps?{count:d.reps,length_m:d.len,rest_s:Math.round(d.rest)}:null;
    return {id:d.key,type:t,title:d.title,distance_m:reps||t==='rest'||d.dist==null?null:Math.round(d.dist),duration_s:null,reps,zone:z,pace_s_per_km:z&&d.pace?Math.round(d.pace):null,
      km:r1(d.km||0),hard:!!d.hard,notes:t==='rest'?d.why:d.what||'',...(d.changed?{changed:true}:{})};
  };
  return {schema:SCHEMA_NAME,version:SCHEMA_VERSION,
    plan:{name:meta.name||'Training plan',revision:meta.revision||1,units:'km',
      race:meta.race?{name:meta.race.name,distance_m:meta.race.distance_m,date:dated&&meta.race.date?iso(meta.race.date):null}:null,
      fitness:meta.vdot?{vdot:r1(meta.vdot),from:meta.from||'estimate'}:null},
    weeks:P.weeks.map((w,i)=>({week:i+1,start:dated?iso(w.monday):null,phase:w.phase,test:!!w.test,focus:w.focus,target_km:r1(w.K),
      days:w.days.filter(d=>!d.pre).map(d=>({date:dated?iso(d.date):null,day:DOW3[d.i],sessions:[sessionDoc(d)]}))})),
    changes:(meta.changes||[]).map(c=>({revision:c.rev,at:new Date(c.at).toISOString(),source:c.source,say:c.say||'',edits:c.edits}))};
}

// Check a document against the schema. Returns a list of problems (empty if it's valid).
export function validateDoc(doc){
  const err=[];
  const chk=(v,s,path)=>{
    if(s.const!==undefined&&v!==s.const)return err.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if(s.enum&&!s.enum.includes(v))return err.push(`${path}: ${JSON.stringify(v)} is not one of ${s.enum.join(', ')}`);
    if(s.type){const ts=[].concat(s.type),ok=ts.some(t=>t==='null'?v===null:t==='array'?Array.isArray(v):t==='integer'?Number.isInteger(v):t==='object'?v&&typeof v==='object'&&!Array.isArray(v):typeof v===t);
      if(!ok)return err.push(`${path}: should be ${ts.join(' or ')}`)}
    if(v===null||typeof v!=='object'){if(typeof v==='number'&&s.minimum!=null&&v<s.minimum)err.push(`${path}: below ${s.minimum}`);return}
    if(Array.isArray(v)){if(s.minItems&&v.length<s.minItems)err.push(`${path}: needs at least ${s.minItems}`);if(s.maxItems&&v.length>s.maxItems)err.push(`${path}: at most ${s.maxItems}`);if(s.items)v.forEach((x,i)=>chk(x,s.items,`${path}[${i}]`));return}
    for(const k of s.required||[])if(!(k in v))err.push(`${path}.${k}: missing`);
    if(s.additionalProperties===false)for(const k of Object.keys(v))if(!(k in (s.properties||{})))err.push(`${path}.${k}: not allowed`);
    for(const [k,ps] of Object.entries(s.properties||{}))if(k in v)chk(v[k],ps,`${path}.${k}`);
  };
  chk(doc,PLAN_SCHEMA,'plan');
  // beyond the schema: unique ids, rest days have no zone, everything else has one its type allows
  const ids=new Set();
  for(const w of doc.weeks||[])for(const d of w.days||[])for(const s of d.sessions||[]){
    if(ids.has(s.id))err.push(`session ${s.id}: duplicate id`);ids.add(s.id);
    const T=TYPES[s.type];if(!T)continue;
    if(s.type==='rest'?s.zone!==null:!T.zones.includes(s.zone))err.push(`session ${s.id}: zone ${s.zone} not allowed for ${s.type}`);
  }
  return err;
}

// ---- Changes ----
const weekKm=w=>w.days.filter(d=>!d.pre).reduce((a,d)=>a+(d.km||0),0);
const clone=P=>({...P,weeks:P.weeks.map(w=>({...w,days:w.days.map(d=>({...d,main:d.main&&[...d.main],extras:d.extras&&[...d.extras]}))}))});
const label=d=>d.kind==='rest'?'Rest':`${d.title}${d.what&&d.kind!=='test'&&d.kind!=='race'?` ${d.what}`:''}`;
const dayLabel=d=>new Date(d.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});

// Apply proposed edits to a programme, one at a time; any edit that breaks a rule is left out, with the
// reason. ctx: {Z (zones from pace.js), pc (training paces), racePace, now (ms)}.
// Returns {P (the programme with the valid edits), results:[{edit, ok, why | summary}]}
export function applyEdits(P0,edits,ctx){
  let P=clone(P0);const results=[],today=dayNum(ctx.now??Date.now());
  const list=Array.isArray(edits)?edits:[];
  const all=Q=>Q.weeks.flatMap(w=>w.days).filter(d=>!d.pre);
  const find=(Q,id)=>{for(const [wi,w] of Q.weeks.entries()){const d=w.days.find(x=>x.key===id&&!x.pre);if(d)return {d,w,wi}}return null};
  const hardPairs=Q=>{const A=all(Q).filter(d=>dayNum(d.date)>=today),out=new Set();for(let i=1;i<A.length;i++)if(A[i].hard&&A[i-1].hard&&dayNum(A[i].date)-dayNum(A[i-1].date)===1)out.add(A[i-1].key+'|'+A[i].key);return out};
  const pairs0=hardPairs(P0);
  list.forEach((e,n)=>{
    const bad=why=>results.push({edit:e,ok:false,why});
    if(n>=MAX_EDITS)return bad(`At most ${MAX_EDITS} changes at a time.`);
    if(!e||!OPS.includes(e.op))return bad(`Unknown change "${e?.op}".`);
    const Q=clone(P),before=Q.weeks.map(weekKm);let summary,restful=false,touched=[];
    if(e.op==='reduce_volume_pct'){
      const wi=(e.week|0)-1,w=Q.weeks[wi];if(!w)return bad(`There is no week ${e.week}.`);
      let pct=Number(e.pct);if(!(pct>0))return bad('The reduction has to be more than 0 %.');
      const capped=pct>VOL_CAP*100;pct=Math.min(pct,VOL_CAP*100);
      const fut=w.days.filter(d=>!d.pre&&dayNum(d.date)>=today&&!TYPES[d.kind]?.locked&&d.kind!=='rest');
      if(!fut.length)return bad(`Week ${e.week} has nothing left to shorten.`);
      let cut=weekKm(w)*pct/100;
      // shorten easy running first (in half kilometres, never under 3 km), then a rep off the biggest session
      for(let g=0;g<200&&cut>=0.5;g++){ // (never more than asked: the cut stays within 10 %)
        const ez=fut.filter(d=>d.dist&&!d.reps&&['easy','recovery','strides','long','hillsprints'].includes(d.kind)&&d.dist>3000).sort((a,b)=>b.dist-a.dist)[0];
        if(ez){ez.dist-=500;ez.km-=0.5;ez.what=(ez.what||'').replace(/^[\d.]+ km/,`${r1(ez.dist/1000)} km`);if(ez.main?.[0])ez.main[0]=ez.main[0].replace(/^[\d.]+ km/,`${r1(ez.dist/1000)} km`);ez.changed=true;cut-=0.5;continue}
        const rp=fut.filter(d=>d.reps>3).sort((a,b)=>b.reps*b.len-a.reps*a.len)[0];
        if(rp&&rp.len/1000<=cut){rp.reps--;rp.km-=rp.len/1000;rp.what=(rp.what||'').replace(/^\d+ ×/,`${rp.reps} ×`);rp.changed=true;cut-=rp.len/1000;continue}
        break;
      }
      const drop=before[wi]-weekKm(w);if(drop<0.2)return bad(`Week ${e.week} can't be shortened any further.`);
      touched=[wi];summary=`Week ${wi+1}: ${r1(before[wi])} → ${r1(weekKm(w))} km (−${Math.round(drop/before[wi]*100)} %${capped?', capped at 10 %':''})`;
    }else{
      const f=find(Q,String(e.session_id??''));if(!f)return bad(`There is no session "${e.session_id}".`);
      const {d,wi}=f;
      if(dayNum(d.date)<today)return bad(`${dayLabel(d)} has already gone.`);
      if(TYPES[d.kind]?.locked)return bad(`${d.title} can't be changed: tests and race day are fixed.`);
      const was=label(d);touched=[wi];
      if(e.op==='swap_session'){
        if(!SWAP_TO.includes(e.new_type))return bad(`Can't swap to "${e.new_type}".`);
        if(e.new_type===d.kind)return bad(`${dayLabel(d)} is already ${KINDS[d.kind].name.toLowerCase()}.`);
        // the same distance as the session it replaces (warm-up included), so the week's volume holds
        const km=d.kind==='rest'?6:Math.max(3,d.km||6);
        const ns=standardSession(e.new_type,{km,pc:ctx.pc,racePace:ctx.racePace,from:d.kind==='rest'?null:d.title});
        for(const k of ['reps','len','rest','dist','min','repWhat','hill','what','main','title','zone','swapped','adapted'])delete d[k];
        Object.assign(d,ns,{i:d.i,date:d.date,key:d.key,extras:d.extras||[],changed:true});
        restful=['rest','recovery'].includes(e.new_type);
        summary=`${dayLabel(d)}: ${was} → ${label(d)}`;
      }else if(e.op==='move_session'){
        const to=Q.weeks[wi].days.find(x=>!x.pre&&iso(x.date)===e.to_date);
        if(!to)return bad(`${e.to_date} isn't in the same week as ${dayLabel(d)}.`);
        if(to===d)return bad('That\'s the same day.');
        if(dayNum(to.date)<today)return bad(`${dayLabel(to)} has already gone.`);
        if(TYPES[to.kind]?.locked)return bad(`${to.title} can't be moved.`);
        const A={...d},B={...to},pos=x=>({i:x.i,date:x.date,key:x.key});
        Object.assign(d,B,pos(A),{changed:true});Object.assign(to,A,pos(B),{changed:true});
        for(const k of Object.keys(d))if(!(k in B)&&!['i','date','key','changed'].includes(k))delete d[k];
        for(const k of Object.keys(to))if(!(k in A)&&!['i','date','key','changed'].includes(k))delete to[k];
        summary=`${was} moves from ${dayLabel(d)} to ${dayLabel(to)}`;
      }else{ // shift_pace_zone
        if(!['easier','harder'].includes(e.direction))return bad('Shift the zone "easier" or "harder".');
        const T=TYPES[d.kind],z=zoneOfSession(d);if(!T.zones.length)return bad('A rest day has no pace.');
        // the type's zones from slowest to quickest, by today's paces
        const L=T.zones.slice().sort((a,b)=>ctx.Z[b].target-ctx.Z[a].target),i=L.indexOf(z),j=i+(e.direction==='harder'?1:-1);
        if(j<0||j>=L.length)return bad(`${d.title} is already as ${e.direction==='harder'?'hard':'easy'} as it can be.`);
        const nz=L[j],old=d.pace;d.zone=nz;d.pace=ctx.Z[nz].target;d.changed=true;
        if(d.main?.length)d.main=[...d.main,`Pace zone changed to ${ctx.Z[nz].name.toLowerCase()}: about ${mmss(d.pace)}/km (was ${mmss(old)})`];
        summary=`${dayLabel(d)}: ${d.title} ${e.direction} → ${ctx.Z[nz].name} zone, about ${mmss(d.pace)}/km`;
      }
    }
    // the rules, checked on the result
    const pairs=hardPairs(Q);for(const p of pairs)if(!pairs0.has(p)){const [x,y]=p.split('|').map(k=>find(Q,k).d);return bad(`That puts two hard days back to back (${dayLabel(x)} and ${dayLabel(y)}).`)}
    for(const wi of touched){
      const a=before[wi],b=weekKm(Q.weeks[wi]);if(!a)continue;
      if(b>a*(1+VOL_CAP)+0.05)return bad(`That would add ${Math.round((b/a-1)*100)} % to week ${wi+1}: the limit is 10 %.`);
      if(b<a*(1-VOL_CAP)-0.05&&!restful)return bad(`That would take ${Math.round((1-b/a)*100)} % off week ${wi+1}: the limit is 10 % (only swapping to rest or recovery can go further).`);
    }
    P=Q;results.push({edit:e,ok:true,summary});
  });
  return {P,results};
}
const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};

// Replay every accepted change onto a freshly built programme (changes that no longer fit are skipped)
export function replay(P,changes,ctx){
  let Q=P;for(const c of changes||[])Q=applyEdits(Q,c.edits,{...ctx,now:0}).P;return Q;
}

// The part of the plan the coach is shown: the next `days` days, compact
export function window(P,now,days=10){
  const t=dayNum(now);
  return P.weeks.flatMap((w,wi)=>w.days.filter(d=>!d.pre&&dayNum(d.date)>=t&&dayNum(d.date)<t+days).map(d=>({id:d.key,date:iso(d.date),day:DOW3[d.i],week:wi+1,type:d.kind,
    title:d.kind==='rest'?'Rest':d.title,km:r1(d.km||0),zone:zoneOfSession(d),hard:!!d.hard})));
}

// ---- The rule-based coach (when the laptop is away, and the baseline the AI is scored against) ----
// f: {session (type), rpe, how ('plan'|'easy'|'hard'|'cut'), legs, energy, pain, note}; win: window(…).
// Returns {edits, say}: pain or illness rests the next two days; a session too hard or heavy legs with low
// energy turns the next hard session easy; a busy week is cut by 10 %; a session clearly too easy makes the
// next one of its kind a zone harder. Otherwise nothing changes.
const ILL=/\b(cold|flu|ill|sick|fever|covid|virus|chest infection|sore throat|unwell)\b/,BUSY=/\b(busy|no time|short on time|work is|travell?ing|shorter runs|can'?t run on|away (this|next) week)\b/;
export function ruleEdits(f,win){
  const note=String(f.note||'').toLowerCase(),e=KINDS[f.session]?.rpe,open=s=>s.type!=='rest'&&!TYPES[s.type]?.locked;
  const day0=win[0]?dayNum(new Date(win[0].date+'T12:00').getTime()):0,within=(s,n)=>dayNum(new Date(s.date+'T12:00').getTime())-day0<n;
  if(f.pain||ILL.test(note)){
    const two=win.filter(s=>open(s)&&within(s,2));
    return {edits:two.map(s=>({op:'swap_session',session_id:s.id,new_type:'rest'})),
      say:f.pain?'Pain is a signal to back off: two days off, then an easy run to see how it feels. If it\'s still there, get it looked at before any hard running.':'Training through illness slows you down for longer: rest until you feel better, then ease back in.'};
  }
  const tired=f.how==='cut'||f.how==='hard'||((f.legs==='heavy'||f.legs==='sore')&&f.energy==='low')||(e&&e[1]&&f.rpe>=e[1]+2);
  if(tired){const h=win.find(s=>s.hard&&open(s)&&within(s,4));
    if(h)return {edits:[{op:'swap_session',session_id:h.id,new_type:'easy'}],say:'You\'re carrying fatigue, so the next hard session becomes an easy run: an easy day now pays off more than a hard one run tired.'};
    return {edits:[{op:'reduce_volume_pct',week:win[0]?.week??1,pct:10}],say:'You\'re carrying fatigue: a slightly lighter week to absorb the work.'}}
  if(BUSY.test(note)){const s=win.find(x=>open(x)&&/tuesday|monday|wednesday|thursday|friday|saturday|sunday/.test(note)&&note.includes(new Date(x.date+'T12:00').toLocaleDateString('en-GB',{weekday:'long'}).toLowerCase()));
    if(s)return {edits:[{op:'swap_session',session_id:s.id,new_type:'rest'}],say:`No problem: ${(s.title||s.type).toLowerCase()} on ${s.day} becomes a rest day. Don't try to squeeze it in elsewhere.`};
    return {edits:[{op:'reduce_volume_pct',week:win[0]?.week??1,pct:10}],say:'A busy week: the easy running is trimmed so the key sessions still fit.'}}
  if(f.how==='easy'&&HARD.has(f.session)&&e&&f.rpe<=e[0]){const n=win.find(s=>s.type===f.session&&open(s));
    if(n)return {edits:[{op:'shift_pace_zone',session_id:n.id,direction:'harder'}],say:'That was easier than it should be, so the next one moves up a zone. Your next test will confirm the new fitness.'}}
  return {edits:[],say:'Nothing to change: keep going as planned.'};
}
