// Voice coach: a race companion whose job is to keep you with the pacer. createCoach decides what to
// say (pure: runs under node --test); createSpeaker says it (speech synthesis plus short tones).
//
// It reads the road ahead from the pacer's plan and talks about pace, never directions:
//   3  terrain changes ~50 m ahead: "Descent in 50 metres, gradually getting steeper. Pacer picking up
//      to 3:44 at the steepest point."
//   2  long steady stretches as you enter them ("Long flat stretch, 600 metres. Pacer holding 3:49."),
//      km splits, lead changes, catching-up advice when you're behind
//   1  regular updates on where you are against the pacer, halfway, last km, final 400 m
// Behind, it looks for the next stretch that suits your pacer profile's strengths (descents for a strong
// descender, climbs for a strong climber, flats for a flat-road runner) or tells you the pace that
// closes the gap. Ahead, it tells you by how much and how fast it's growing, without pushing you on.
// Styles (what kind of coach), described to the runner in STYLES below:
//   relaxed    the commentator: states what's happening and what's coming, never pushes
//   moderate   the coach: helps you stay with the pacer using your strengths, no pressure when it's away
//   assertive  the pacemaker: holds you to the plan, corrects drift, reins you in when you're ahead
// Levels (how much it talks): 'key' = terrain changes, splits, lead changes, fewer updates; 'full' adds the rest.
import {timeAt,paceAt,distAt} from './pacer.js';

const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const hms=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const secs=s=>{s=Math.round(s);if(s<60)return `${s} second${s===1?'':'s'}`;const m=Math.floor(s/60),r=s%60;return `${m} minute${m>1?'s':''}${r?` ${r} second${r===1?'':'s'}`:''}`};
const metres=m=>m>=1000?`${(m/1000).toFixed(1)} kilometres`:`${Math.max(50,Math.round(m/50)*50)} metres`;
export const gapPhrase=g=>Math.abs(g)<1?'Level with the pacer':`${secs(Math.abs(g))} ${g>0?'ahead':'behind'}`;

// ---- Reading the road: the route as plain-English stretches ----
const RANK=g=>g>=6?3:g>=3?2:g>=1?1:g<=-6?-3:g<=-3?-2:g<=-1?-1:0;
const KIND={'-3':'steep descent','-2':'descent','-1':'gentle downhill','0':'flat stretch','1':'gentle rise','2':'climb','3':'steep climb'};

// Stretches of at least minLen m by grade: [{d0,d1,len,rank,kind,steep:{d,grade,pace},trend,pace0,paceMin,paceMax}]
// trend: 'steepening' (steepest point well into it), 'easing' (steepest near the start) or 'steady'
export function sections(P,{minLen=150}={}){
  const n=P.d.length;let runs=[];
  for(let i=0;i<n-1;i++){const r=RANK(P.grade[i]),L=runs.at(-1);if(L&&L.rank===r)L.i1=i+1;else runs.push({i0:i,i1:i+1,rank:r})}
  const len=x=>P.d[x.i1]-P.d[x.i0];
  for(;;){ // fold the shortest short stretch into the neighbour closest in steepness, then rejoin equals
    runs=runs.reduce((a,x)=>{const L=a.at(-1);if(L&&L.rank===x.rank)L.i1=x.i1;else a.push({...x});return a},[]);
    let k=-1;runs.forEach((x,i)=>{if(len(x)<minLen&&(k<0||len(x)<len(runs[k])))k=i});
    if(k<0||runs.length<2)break;
    const x=runs[k],L=runs[k-1],R=runs[k+1],into=!R||(L&&Math.abs(L.rank-x.rank)<=Math.abs(R.rank-x.rank))?k-1:k+1;
    const a=Math.min(k,into);runs.splice(a,2,{i0:runs[a].i0,i1:runs[a+1].i1,rank:runs[into].rank});
  }
  return runs.map(x=>{
    let si=x.i0;for(let i=x.i0;i<=x.i1;i++)if(x.rank>=0?P.grade[i]>P.grade[si]:P.grade[i]<P.grade[si])si=i;
    const f=(P.d[si]-P.d[x.i0])/Math.max(1,len(x)),sl=P.pace.slice(x.i0,x.i1+1);
    const trend=x.rank===0?'steady':f>0.55?'steepening':f<0.25?'easing':'steady';
    return {d0:P.d[x.i0],d1:P.d[x.i1],len:len(x),rank:x.rank,kind:KIND[x.rank],
      steep:{d:P.d[si],grade:P.grade[si],pace:P.pace[si]},trend,pace0:P.pace[Math.min(x.i1,x.i0+2)],paceMin:Math.min(...sl),paceMax:Math.max(...sl)};
  });
}

// Which stretches suit this runner for making up time
function strengths(prof){
  const up=prof?.climb==='strong',down=prof?.descent==='strong',flat=prof?.climb==='weak'&&prof?.descent==='cautious';
  if(flat)return r=>r===0;
  if(up&&down)return r=>Math.abs(r)>=2;
  if(up)return r=>r>=2;
  return r=>r<=-1; // strong or average descenders: downhill is free speed
}

// The three coaching styles, as shown to the runner before they choose
export const STYLES=[
  {id:'relaxed',name:'Relaxed',who:'The commentator',
   desc:"Tells you what's happening and what's coming up: the road ahead, the pacer's pace, the gap and your own pace. It never tells you to speed up or slow down: you run your own race.",
   example:'Climb in 50 metres. Pacer easing to 5:20. Pacer 6 seconds ahead. You\'re running 5:08, pacer 5:02.'},
  {id:'moderate',name:'Moderate',who:'The coach',
   desc:"Helps you stay with the pacer without nagging. If you drop back it points out where to win time back, using your pacer profile's strengths. If you're well ahead it says there's no need to push. If the pacer gets away: relax if you're tired, lift it if you feel good.",
   example:'Pacer 2 seconds ahead. Downhill in 300 metres, your chance to close the gap.'},
  {id:'assertive',name:'Assertive',who:'The pacemaker',
   desc:"Holds you to the plan. It calls you back as soon as your pace drifts outside your colour band, tells you exactly what to run to get back on the pacer, and reins you in if you get ahead. Talks more often.",
   example:"Too fast here. Ease to 5:00. 6 seconds ahead of the plan, don't bank time early."},
];
// Seconds between position updates [when off the pacer, when level] by style and level
const EVERY={relaxed:{full:[120,180],key:[240,Infinity]},moderate:{full:[90,150],key:[150,Infinity]},assertive:{full:[60,120],key:[90,180]}};

// P: pacer; prof: profile traits ({climb, descent}) for advice; level: 'key' | 'full';
// style: 'relaxed' | 'moderate' | 'assertive'; band: the pace colour band (s/km), for assertive corrections
export function createCoach({P,prof,level='full',style='moderate',band=5}){
  const S=sections(P),good=strengths(prof),said=new Set(),total=P.total;
  let splits=0,lead=null,leadAt=-1e9,lastTalk=-1e9,lastUpdate=-1e9,gaps=[],hillPace=null,tipsGiven=new Set(),driftFrom=null,driftAt=-1e9,awayCount=0,bigAhead=0;
  const typical=x=>{const v=P.pace.filter((_,i)=>P.d[i]>=x.d0&&P.d[i]<=x.d1).sort((a,b)=>a-b);return v[Math.floor(v.length/2)]};
  const secAt=d=>S.find(x=>d>=x.d0&&d<x.d1)||S.at(-1);
  const verb=(to,from)=>to<from-2?'picking up to':to>from+2?'easing to':'holding';

  // s: {rd m, t s, gap s (+ = you ahead), cur s/km or null, splits [your elapsed s at each km], proj s or null}
  // Returns [{key, text, pri, tone}] to say now.
  function update(s){
    const out=[];
    const add=(key,lvl,pri,text,tone)=>{if(said.has(key))return;said.add(key);if(lvl==='full'&&level!=='full')return;out.push({key,text,pri,tone});lastTalk=s.t};
    gaps.push({t:s.t,g:s.gap});gaps=gaps.filter(x=>s.t-x.t<=40);
    const here=secAt(s.rd),pNow=paceAt(P,s.rd);

    // 1. Terrain change ~50 m ahead. A hill (consecutive stretches going the same way) is announced
    //    once, as a whole: how it builds and the pacer's pace at its steepest. Within a hill, only a big
    //    change of steepness gets a short call.
    S.forEach((x,i)=>{
      if(i===0||x===here)return;
      const left=x.d0-s.rd;if(left<=15||left>55)return;
      const prev=S[i-1];if(x.rank===prev.rank)return;
      const sign=Math.sign(x.rank),within=sign!==0&&Math.sign(prev.rank)===sign;
      if(within){
        const dp=x.steep.pace-paceAt(P,x.d0-20);if(Math.abs(dp)<8||(hillPace!=null&&Math.abs(x.steep.pace-hillPace)<4))return;
        add('a'+i,'key',3,`${Math.abs(x.rank)>Math.abs(prev.rank)?'Getting steeper':'Easing off'} in ${Math.round(left/10)*10} metres. Pacer ${verb(x.steep.pace,pNow)} ${mmss(x.steep.pace)}.`,dp<0?'up':'down');
        return;
      }
      let j=i;while(sign!==0&&S[j+1]&&Math.sign(S[j+1].rank)===sign)j++;   // the whole hill
      const hill=S.slice(i,j+1),top=hill.reduce((a,y)=>Math.abs(y.steep.grade)>Math.abs(a.steep.grade)?y:a,x);
      const maxRank=hill.reduce((a,y)=>Math.abs(y.rank)>Math.abs(a)?y.rank:a,x.rank);
      const key=sign===0?typical(x):top.steep.pace;hillPace=sign===0?null:key;
      if(Math.abs(maxRank)<2&&Math.abs(key-pNow)<4)return;                  // small change: not worth a cue
      const far=(top.steep.d-x.d0)/Math.max(1,hill.at(-1).d1-x.d0);
      const tr=sign===0?'':far>0.55?', gradually getting steeper':far<0.25?', steepest at the start':'';
      const where=sign!==0&&Math.abs(key-paceAt(P,x.d0+30))>3?' at the steepest point':'';
      const name=sign===0&&x.len>=600?'long flat stretch':KIND[maxRank],cap=t=>t[0].toUpperCase()+t.slice(1),inM=`${Math.round(left/10)*10} metres`;
      said.add('e'+x.d0); // its entry call is covered by this one
      // flats say how long they last: "In 50 metres, flat stretch for 450 metres." Hills say how they build.
      const head=sign===0&&x.len>=400?`In ${inM}, ${name} for ${metres(x.len)}`:`${cap(name)} in ${inM}${tr}`;
      add('a'+i,'key',3,`${head}. Pacer ${verb(key,pNow)} ${mmss(key)}${where}.`,key<pNow-2?'up':key>pNow+2?'down':'split');
    });

    // 2. Long steady stretches, as you enter them
    if(s.rd-here.d0<40&&here.len>=400&&Math.abs(here.rank)<=1){
      const long=here.len>=600&&here.rank===0?'Long flat stretch':here.kind[0].toUpperCase()+here.kind.slice(1);
      add('e'+here.d0,'full',2,`${long}, ${metres(here.len)}. Pacer holding ${mmss(typical(here))}.`);
    }

    // 3. Km splits
    if(s.splits.length>splits){
      splits=s.splits.length;const k=splits,you=s.splits[k-1]-(s.splits[k-2]||0),pc=timeAt(P,k*1000)-timeAt(P,(k-1)*1000);
      add('k'+k,'key',2,`Kilometre ${k}. ${mmss(you)}. Pacer ${mmss(pc)}. ${gapPhrase(s.gap)}.`,'split');
      lastUpdate=s.t;
    }

    // 4. Lead changes (3 s clear, at most a minute apart)
    const nl=s.gap>=3?'you':s.gap<=-3?'pacer':lead;
    if(lead&&nl!==lead&&s.t-leadAt>=60){
      leadAt=s.t;lastUpdate=s.t;
      const text=style==='relaxed'?(nl==='you'?"You're ahead of the pacer now.":'The pacer is ahead now.')
        :style==='assertive'?(nl==='you'?"You're ahead of the pacer. Settle back onto the plan.":'The pacer has passed you. Back on it, now.')
        :(nl==='you'?"You've passed the pacer":'The pacer has passed you');
      add('l'+s.t.toFixed(0),'key',2,text,nl==='you'?'pass':'passed');
    }
    if(nl!==lead&&lead===null)leadAt=s.t;
    lead=nl;

    // 5. Assertive: correct drift off the target pace here once it has held for 20 s (every 45 s at most).
    //    Only near the plan (bigger gaps get the regular update instead), and only when it hurts: slow
    //    when you're not ahead of the plan, fast when you're not behind it.
    if(style==='assertive'&&s.cur&&s.rd>200){
      const off=s.cur-pNow;
      if(Math.abs(off)>band&&(off>0?s.gap<2&&s.gap>-5:s.gap>-2&&s.gap<5)){
        driftFrom??=s.t;
        if(s.t-driftFrom>=20&&s.t-driftAt>=45&&s.t-lastTalk>=10){
          driftAt=s.t;driftFrom=null;lastTalk=s.t;
          out.push({key:'d'+s.t.toFixed(0),pri:2,tone:off>0?'up':'down',text:off>0?`Too slow here. Target ${mmss(pNow)}.`:`Too fast here. Ease to ${mmss(pNow)}.`});
        }
      }else driftFrom=null;
    }

    // 6. Where you are against the pacer, with advice for the style: not on top of other cues
    const level_=Math.abs(s.gap)<1.5,every=EVERY[style][level][level_?1:0];
    if(s.t-lastUpdate>=every&&s.t-lastTalk>=(style==='assertive'?20:12)&&s.rd>200&&total-s.rd>400){
      const text=position(s,here,pNow);
      if(text){lastUpdate=s.t;out.push({key:'u'+s.t.toFixed(0),text,pri:Math.abs(s.gap)>=1.5?2:1});lastTalk=s.t}
    }

    // 7. Milestones
    const proj=s.proj?` On course for ${hms(s.proj)}.`:'';
    if(s.rd>=total/2)add('half','full',1,`Halfway. ${hms(s.t)}. ${gapPhrase(s.gap)}.${proj}`);
    if(total>1500&&total-s.rd<=1000)add('last','full',1,`Last kilometre. ${gapPhrase(s.gap)}.${proj}`);
    if(total>800&&total-s.rd<=400)add('fin','key',2,style==='relaxed'
      ?`Final 400 metres. ${gapPhrase(s.gap)}.`
      :s.gap>=1?`Final 400 metres. ${secs(s.gap)} up on the pacer. Bring it home.`
      :s.gap<=-1?`Final 400 metres. Pacer ${secs(-s.gap)} ahead. ${style==='assertive'?'Go now, everything to the line.':"Everything you've got."}`
      :'Final 400 metres. Level with the pacer. Race it to the line.');

    return out.sort((a,b)=>b.pri-a.pri);
  }

  // The update itself, in the coach's style: gap, which way it's moving, pace against the pacer, and
  // (moderate/assertive) what to do about it
  function position(s,here,pNow){
    const g=s.gap,old=gaps[0],trend=old&&s.t-old.t>=20?(g-old.g)/((s.t-old.t)/60):0; // s of gap per minute
    const pacerPace=paceAt(P,distAt(P,s.t)),diff=s.cur?pacerPace-s.cur:0;          // + = you're quicker
    const paces=s.cur?` You're running ${mmss(s.cur)}, pacer ${mmss(pacerPace)}.`:'';
    if(Math.abs(g)<1.5){awayCount=0;return style==='assertive'?`On the plan. Hold ${mmss(pNow)} here.`:`Right with the pacer. ${mmss(pNow)} here.`}

    // Relaxed: just the facts
    if(style==='relaxed')return `${g>0?`${secs(g)} ahead of the pacer.`:`Pacer ${secs(-g)} ahead.`}${paces}`;

    // Assertive: back to the plan, now
    if(style==='assertive'){
      if(g>0){
        if(g>=5)return `${secs(g)} ahead of the plan. Ease back to ${mmss(pNow)}, don't bank time early.`;
        return `${secs(g)} ahead. Good. Hold ${mmss(pNow)}.`;
      }
      const D=Math.min(400,total-s.rd),need=D>100?((timeAt(P,s.rd+D)-timeAt(P,s.rd))+g)/(D/1000):pNow;
      return `Pacer ${secs(-g)} ahead. Pick it up: ${mmss(Math.max(need,pNow-25))} for the next ${metres(D)}.`;
    }

    // Moderate: encourage, suggest, never nag
    if(g>0){
      awayCount=0;bigAhead=g>=10?bigAhead+1:0;
      if(bigAhead>=2)return [`Still ${secs(g)} up. Nice and comfortable.`,`${secs(g)} in hand. Run relaxed.`][bigAhead%2];
      if(diff<-3)return `${secs(g)} ahead. Pacer gaining on you, ${Math.round(-diff)} seconds a kilometre quicker right now.`;
      if(g>=10&&diff>3)return `Big gap forming, ${secs(g)} ahead of the pacer and ${Math.round(diff)} seconds a kilometre quicker. No need to push harder. If you feel good, keep it rolling.`;
      if(g>=10)return `${secs(g)} ahead of the pacer. Plenty in hand, stay relaxed.`;
      return `${secs(g)} ahead of the pacer.${diff>3?` You're ${Math.round(diff)} seconds a kilometre quicker.`:''}${trend>1.5?' Gap widening.':''}`;
    }
    // Behind. If the pacer keeps getting away, take the pressure off rather than repeating the same push.
    awayCount=trend<-0.5?awayCount+1:0;
    const lead=`Pacer ${secs(-g)} ahead.`,next=S.find(x=>x.d0>s.rd&&x.d0-s.rd<=500&&good(x.rank));
    const chance=next&&!tipsGiven.has(next.d0)?next:null;
    if(-g>=20&&awayCount>=2){
      awayCount=0;
      return `${lead} No pressure. If you're tired, settle into a rhythm you can hold.${chance?` If you feel good, lift it on the ${chance.kind} in ${metres(chance.d0-s.rd)}.`:''}`;
    }
    const hold=trend<-1?" Don't let the gap grow.":trend>1?' Closing in, keep it going.':'';
    let tip='';
    if(good(here.rank)&&here.d1-s.rd>150&&!tipsGiven.has(here.d0)){tipsGiven.add(here.d0);tip=` Use this ${here.kind} to close the gap.`}
    else if(chance){tipsGiven.add(chance.d0);tip=` ${chance.kind[0].toUpperCase()+chance.kind.slice(1)} in ${metres(chance.d0-s.rd)}, your chance to close the gap.`}
    else{
      const D=Math.min(1000,total-s.rd);
      if(D>200){
        const need=((timeAt(P,s.rd+D)-timeAt(P,s.rd))+g)/(D/1000); // g < 0: less time than the pacer
        tip=need>pNow-15?` Run ${mmss(need)} for the next ${D>=1000?'kilometre':metres(D)} to catch up.`:' Stay steady and claw it back bit by bit.';
      }
    }
    return lead+hold+tip;
  }
  return {update,setLevel:l=>{level=l},setStyle:x=>{style=x},sections:S};
}

// ---------------------------------------------------------------------------------------------
// Speaker: a small queue over speech synthesis, with tones. Must be unlocked from a tap (iOS).
// Low-priority cues older than 10 s are dropped; a pri-3 cue cuts off anything quieter.
export function createSpeaker(){
  let ac=null,keep=null,voice=null,q=[],cur=null,timer=null,muted=false,opts={tones:true,rate:1};
  const synth=()=>window.speechSynthesis;

  function pickVoice(){
    const vs=synth()?.getVoices()||[];
    voice=vs.find(v=>/en-GB/i.test(v.lang)&&/local|enhanced|premium/i.test(v.name+v.voiceURI))||vs.find(v=>/en-GB/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null;
  }
  // A silent looping <audio> keeps the page's audio session in playback mode, so tones aren't muted
  // by the ringer switch and speech isn't cut short
  function silentWav(){
    const n=8000,b=new Uint8Array(44+n),v=new DataView(b.buffer),w=(o,s)=>[...s].forEach((c,i)=>b[o+i]=c.charCodeAt(0));
    w(0,'RIFF');v.setUint32(4,36+n,true);w(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,8000,true);v.setUint32(28,8000,true);v.setUint16(32,1,true);v.setUint16(34,8,true);w(36,'data');v.setUint32(40,n,true);b.fill(128,44);
    let s='';b.forEach(x=>s+=String.fromCharCode(x));return 'data:audio/wav;base64,'+btoa(s);
  }
  function unlock(){
    try{
      if(!ac){const AC=window.AudioContext||window.webkitAudioContext;if(AC)ac=new AC()}
      ac?.resume();
      if(!keep){keep=new Audio(silentWav());keep.loop=true;keep.volume=0.01}
      keep.play().catch(()=>{});
      if(synth()){pickVoice();if(!voice&&synth().onvoiceschanged!==undefined)synth().onvoiceschanged=pickVoice;synth().speak(new SpeechSynthesisUtterance(''))}
    }catch(e){}
  }
  // Tones: rising = pick up / you passed; falling = ease off / pacer passed
  const TONES={up:[660,990],down:[990,660],pass:[523,659,784],passed:[784,659,523],split:[740],start:[523,784]};
  function tone(kind){
    const f=TONES[kind];if(!f||!ac||!opts.tones)return 0;
    const t0=ac.currentTime+0.02;
    f.forEach((hz,i)=>{
      const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=hz;
      const a=t0+i*0.16;g.gain.setValueAtTime(0,a);g.gain.linearRampToValueAtTime(0.35,a+0.015);g.gain.exponentialRampToValueAtTime(0.001,a+0.14);
      o.connect(g).connect(ac.destination);o.start(a);o.stop(a+0.15);
    });
    return f.length*160+120;
  }
  function pump(){
    if(cur||!q.length||muted)return;
    const now=Date.now();q=q.filter(c=>c.pri>=3||now-c.at<10000);
    const c=q.shift();if(!c)return;
    cur=c;const wait=tone(c.tone);
    setTimeout(()=>{
      if(cur!==c)return;
      const s=synth();if(!s){done();return}
      const u=new SpeechSynthesisUtterance(c.text);if(voice)u.voice=voice;u.lang=voice?.lang||'en-GB';u.rate=opts.rate;
      u.onend=u.onerror=done;s.speak(u);
      clearTimeout(timer);timer=setTimeout(done,c.text.length*90/opts.rate+2500); // iOS sometimes skips onend
    },wait);
  }
  function done(){clearTimeout(timer);cur=null;setTimeout(pump,250)}
  function play(list){
    for(const c of list){
      if(c.pri>=3&&cur&&cur.pri<3){synth()?.cancel();q=q.filter(x=>x.pri>=3);cur=null}
      q.push({...c,at:Date.now()});
    }
    q.sort((a,b)=>b.pri-a.pri);pump();
  }
  const say=(text,pri=2,tn)=>play([{text,pri,tone:tn}]);
  function setMuted(m){muted=m;if(m){synth()?.cancel();q=[];cur=null}}
  return {unlock,play,say,setMuted,setOpts:o=>{opts={...opts,...o}},get muted(){return muted}};
}
