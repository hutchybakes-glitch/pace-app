// Voice coach: decides what to say during a run (createCoach, pure: runs under node --test) and says
// it (createSpeaker: speech synthesis plus short tones, browser only).
//
// Cues, most urgent first (pri 3 interrupts anything quieter):
//   3  turns ("Turn left in 200 metres", "… now"), off route / back on route
//   2  pace changes ahead (marks on the road changing ≥ 8 s/km, ≥ 300 m apart), lead changes (3 s
//      clear, ≥ 60 s apart), km splits
//   1  gap every 5 s it moves, drifting off the pacer's pace for 30 s, halfway, last km
// Levels: 'key' = turns, off route, pace changes, lead changes, km splits; 'full' adds the rest.
import {timeAt,paceAt} from './pacer.js';
import {turnText} from './nav.js';

const mmss=s=>{s=Math.round(s);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
const hms=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`};
const secs=s=>{s=Math.round(s);if(s<60)return `${s} second${s===1?'':'s'}`;const m=Math.floor(s/60),r=s%60;return `${m} minute${m>1?'s':''}${r?` ${r} second${r===1?'':'s'}`:''}`};
export const gapPhrase=g=>Math.abs(g)<1?'Level with the pacer':`${secs(Math.abs(g))} ${g>0?'ahead':'behind'}`;

// P: pacer; turns: nav turns; marks: pace marks [{d,pace}]; level: 'key' | 'full'
export function createCoach({P,turns,marks,level='full'}){
  const said=new Set();
  let splits=0,lead=null,leadAt=-1e9,paceAtD=-1e9,gapStep=0,gapAt=-1e9,driftFrom=null,driftAt=-1e9,off=false,offFrom=null,offSaid=false;
  const total=P.total;

  // s: {rd m, t s, gap s (+ = you ahead), cur s/km or null, splits [your elapsed s at each km],
  //     off bool, uturnHere bool (physically at the turnaround), proj s or null}
  // Returns [{key, text, pri, tone}] to say now.
  function update(s){
    const out=[];
    const add=(key,lvl,pri,text,tone)=>{if(said.has(key))return;said.add(key);if(lvl==='full'&&level!=='full')return;out.push({key,text,pri,tone})};

    // Turns: once ~200 m out (or as soon as we're closer, if a run starts near one), then "now"
    // Turns within 80 m of each other are announced together: "Turn left, then sharp left, in 200 metres"
    turns.forEach((tn,i)=>{
      const left=tn.d-s.rd;if(left<=0)return;
      if(left<=210&&left>40&&!said.has('t'+i)){
        const nx=turns[i+1],pair=nx&&nx.d-tn.d<=80;
        const what=pair?`${turnText(tn)}, then ${turnText(nx).replace(/^Turn /,'').toLowerCase()},`:turnText(tn);
        if(pair)said.add('t'+(i+1));
        add('t'+i,'key',3,`${what} in ${left>175?200:Math.max(50,Math.round(left/50)*50)} metres`,'turn');
      }
      if(left<=30&&(tn.kind!=='uturn'||s.uturnHere))add('n'+i,'key',3,tn.kind==='uturn'?'Turn around now':`${turnText(tn)} now`,'turn');
    });

    // Pace changes ahead: about 100 m before a mark whose pace differs by 6 s/km or more from now
    // Wording follows what the road does: "Climb ahead" (slower), "Climb eases" (gentler climb, quicker)…
    marks.forEach((m,i)=>{
      const left=m.d-s.rd;if(left<=40||left>140||said.has('m'+i))return;
      const now=paceAt(P,s.rd),dp=m.pace-now;
      if(Math.abs(dp)<8||m.d-paceAtD<300){said.add('m'+i);return}
      const g=P.grade[Math.min(P.grade.length-1,Math.round(m.d/10))],slower=dp>0;
      const what=g>1?(slower?'Climb ahead. ':'Climb eases. '):g<-1?(slower?'Downhill eases. ':'Downhill ahead. '):'';
      paceAtD=m.d;
      add('m'+i,'key',2,`${what}Pacer ${slower?'eases to':'picks up to'} ${mmss(m.pace)}`,slower?'down':'up');
    });

    // Km splits: yours, the pacer's, and where that leaves you
    if(s.splits.length>splits){
      splits=s.splits.length;const k=splits,you=s.splits[k-1]-(s.splits[k-2]||0),pc=timeAt(P,k*1000)-timeAt(P,(k-1)*1000);
      add('k'+k,'key',2,`Kilometre ${k}. ${mmss(you)}. Pacer ${mmss(pc)}. ${gapPhrase(s.gap)}.`,'split');
    }

    // Lead changes (with 1.5 s of hysteresis so it doesn't flap when you're level)
    const nl=s.gap>=3?'you':s.gap<=-3?'pacer':lead;
    if(lead&&nl!==lead&&s.t-leadAt>=60){leadAt=s.t;add('l'+s.t.toFixed(0),'key',2,nl==='you'?"You've passed the pacer":'The pacer has passed you',nl==='you'?'pass':'passed')}
    if(nl!==lead&&lead===null)leadAt=s.t;
    lead=nl;

    // Gap, every time it grows past another 5 s (at most every 45 s)
    const step=Math.floor(Math.abs(s.gap)/5)*5;
    if(step<5)gapStep=0;
    else if(step!==gapStep&&s.t-gapAt>=45){gapStep=step;gapAt=s.t;add('g'+s.t.toFixed(0),'full',1,`${secs(step)} ${s.gap>0?'ahead of':'behind'} the pacer`)}

    // Drifting off the pacer's pace here for 30 s (at most every 90 s)
    const target=paceAt(P,s.rd);
    if(s.cur&&Math.abs(s.cur-target)>10){
      driftFrom??=s.t;
      if(s.t-driftFrom>=30&&s.t-driftAt>=90){driftAt=s.t;driftFrom=null;
        add('d'+s.t.toFixed(0),'full',1,s.cur>target?`A little slow here. Pacer pace ${mmss(target)}`:`Quicker than the plan here. Pacer pace ${mmss(target)}`)}
    }else driftFrom=null;

    // Milestones
    const proj=s.proj?` On course for ${hms(s.proj)}.`:'';
    if(s.rd>=total/2)add('half','full',1,`Halfway. ${hms(s.t)}. ${gapPhrase(s.gap)}.${proj}`);
    if(total>1500&&total-s.rd<=1000)add('last','full',1,`Last kilometre. ${gapPhrase(s.gap)}.${proj}`);

    // Off route: after 8 s off, and when back on
    if(s.off&&!off)offFrom=s.t;
    off=s.off;
    if(off&&!offSaid&&s.t-offFrom>=8){offSaid=true;out.push({key:'off'+s.t,text:'Off route',pri:3,tone:'turn'})}
    if(!off&&offSaid){offSaid=false;out.push({key:'on'+s.t,text:'Back on route',pri:3})}

    return out.sort((a,b)=>b.pri-a.pri);
  }
  return {update,setLevel:l=>{level=l}};
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
  // Tones: two quick equal beeps = turn; rising = pick up / you passed; falling = ease / pacer passed
  const TONES={turn:[880,880],up:[660,990],down:[990,660],pass:[523,659,784],passed:[784,659,523],split:[740],start:[523,784]};
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
