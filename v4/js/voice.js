// Your voice, mid-run. iPhone home-screen web apps can't use the browser's speech recognition (Apple
// disables it there), so Pacer records a short clip itself and the laptop turns it into words with
// Whisper (free, open source). Recording: tap the mic, speak, and it stops by itself after a pause (or
// at 8 seconds). The clip is 16 kHz mono WAV, about 32 kB a second, and is never stored.
// Without the laptop: the browser's own recognition where it exists (Safari in a tab, Chrome), otherwise
// the keyboard's dictation mic into a text box. Speaking back uses speech synthesis (coach.js).

// Can this browser record? (getUserMedia works in iPhone home-screen apps)
export const canRecord=()=>!!navigator.mediaDevices?.getUserMedia&&!!(window.AudioContext||window.webkitAudioContext);
// The browser's own speech recognition, if it has one (not in iPhone home-screen apps)
export const nativeRecognition=()=>window.SpeechRecognition||window.webkitSpeechRecognition||null;

// 16-bit mono WAV from float samples at `rate`
export function encodeWav(samples,rate=16000){
  const n=samples.length,b=new ArrayBuffer(44+n*2),v=new DataView(b),w=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i))};
  w(0,'RIFF');v.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++){const s=Math.max(-1,Math.min(1,samples[i]));v.setInt16(44+i*2,s<0?s*0x8000:s*0x7fff,true)}
  return new Blob([b],{type:'audio/wav'});
}
// Down to 16 kHz (averaging, which also filters)
export function downsample(x,from,to=16000){
  if(from===to)return x;
  const r=from/to,n=Math.floor(x.length/r),out=new Float32Array(n);
  for(let i=0;i<n;i++){const a=Math.floor(i*r),b=Math.min(x.length,Math.floor((i+1)*r));let s=0;for(let j=a;j<b;j++)s+=x[j];out[i]=s/Math.max(1,b-a)}
  return out;
}

// One clip: start() asks for the mic and records; it ends by itself after ~1.2 s of quiet once you've
// spoken, or at maxMs, or when you call stop(). Resolves to {wav, ms, spoke} (spoke: was there any voice).
// onLevel(0..1) shows the input level.
export async function recordClip({maxMs=8000,quietMs=1200,onLevel=()=>{}}={}){
  const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
  const AC=window.AudioContext||window.webkitAudioContext,ac=new AC(),src=ac.createMediaStreamSource(stream),proc=ac.createScriptProcessor(4096,1,1);
  const chunks=[],t0=performance.now();let spoke=false,lastLoud=t0,noise=0.01,done=null;
  const finished=new Promise(res=>done=res);
  proc.onaudioprocess=e=>{
    const x=e.inputBuffer.getChannelData(0);chunks.push(new Float32Array(x));
    let s=0;for(let i=0;i<x.length;i++)s+=x[i]*x[i];const rms=Math.sqrt(s/x.length),now=performance.now();
    if(!spoke)noise=noise*0.9+rms*0.1;                       // learn the background (wind, traffic) before you speak
    if(rms>Math.max(0.02,noise*3)){spoke=true;lastLoud=now}
    onLevel(Math.min(1,rms*8));
    if(now-t0>maxMs||(spoke&&now-lastLoud>quietMs))done();
  };
  src.connect(proc);proc.connect(ac.destination);
  const stop=async()=>{
    proc.disconnect();src.disconnect();stream.getTracks().forEach(t=>t.stop());
    const n=chunks.reduce((a,c)=>a+c.length,0),all=new Float32Array(n);let o=0;for(const c of chunks){all.set(c,o);o+=c.length}
    const rate=ac.sampleRate;await ac.close().catch(()=>{});
    return {wav:encodeWav(downsample(all,rate)),ms:Math.round(n/rate*1000),spoke};
  };
  return {done:finished.then(stop),stop:()=>done()};
}

// The browser's own recognition (where it exists): resolves to the words heard ('' if none)
export function listenNative({lang='en-GB',timeout=8000}={}){
  const R=nativeRecognition();if(!R)return Promise.reject(new Error('no speech recognition here'));
  return new Promise((res,rej)=>{
    const r=new R();r.lang=lang;r.interimResults=false;r.maxAlternatives=1;let got='';
    const t=setTimeout(()=>{try{r.stop()}catch(e){}},timeout);
    r.onresult=e=>{got=e.results[0]?.[0]?.transcript||''};
    r.onerror=e=>{clearTimeout(t);rej(new Error(e.error||'recognition error'))};
    r.onend=()=>{clearTimeout(t);res(got)};
    r.start();
  });
}
