// The phone's link to the laptop coach (coach/run.py on your laptop, reached through a free Cloudflare
// quick tunnel). You enter the pairing code once; the laptop posts its current address to a private
// ntfy.sh topic named from a hash of that code, so the app finds it by itself each time the laptop starts.
// You can also type the address in. Every call carries the code; if the laptop can't be reached the app
// says so straight away and the in-run assistant falls back to its own rules (intents.js).
import {opt} from './store.js';

const RELAY='https://ntfy.sh';
export const normCode=c=>String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// The private topic for a code (the same hash run.py uses)
export async function topicOf(code){
  const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('pacer:'+normCode(code)));
  return 'pacer-'+[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,32);
}
const withTimeout=(ms,f)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);return f(c.signal).finally(()=>clearTimeout(t))};

// onChange(state) is called whenever the link's state changes.
// state: {code, url, status: 'off' (no code) | 'finding' | 'ok' | 'down', loaded, voice, checked (ms), error}
export function createLaptop(onChange=()=>{}){
  const st={code:opt.get('laptop:code',''),manual:opt.get('laptop:url',''),found:opt.get('laptop:found',''),status:'off',loaded:false,voice:'off',checked:0,error:null,downUntil:0};
  const pub=()=>({code:st.code,url:base(),status:st.status,loaded:st.loaded,voice:st.voice,checked:st.checked,error:st.error,manual:!!st.manual});
  const set=p=>{Object.assign(st,p);onChange(pub())};
  const base=()=>(st.manual||st.found||'').replace(/\/+$/,'');
  if(st.code)st.status='finding';

  // Where is the laptop now? (the newest address on the private topic)
  async function discover(){
    if(!st.code)return null;
    try{
      const topic=await topicOf(st.code),r=await withTimeout(8000,s=>fetch(`${RELAY}/${topic}/json?poll=1&since=24h`,{signal:s,cache:'no-store'}));
      const lines=(await r.text()).trim().split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(m=>m?.event==='message');
      const m=lines.at(-1);let url=null;try{url=JSON.parse(m.message).url}catch(e){}
      if(url&&/^https:\/\/[a-z0-9.-]+$/i.test(url)){st.found=url;opt.set('laptop:found',url);return url}
    }catch(e){}
    return null;
  }
  // A call to the laptop. kind: 'json' (body is an object) or 'wav' (body is a Blob)
  async function call(path,{body=null,kind='json',timeout=12000,method=body==null?'GET':'POST'}={}){
    if(!st.code)throw new Error('no pairing code');
    if(Date.now()<st.downUntil)throw new Error('laptop unreachable');
    const go=url=>withTimeout(timeout,s=>fetch(url+path,{method,signal:s,cache:'no-store',
      headers:{Authorization:'Bearer '+normCode(st.code),...(body!=null?{'Content-Type':kind==='wav'?'audio/wav':'application/json'}:{})},
      body:body==null?undefined:kind==='wav'?body:JSON.stringify(body)}));
    let url=base(),r=null,err=null;
    if(!url)url=await discover();
    if(url)try{r=await go(url)}catch(e){err=e}
    // the address may have changed since (the laptop restarted): look it up and try once more
    if(!r&&!st.manual&&err?.name!=='AbortError'){const u2=await discover();if(u2&&u2!==url)try{r=await go(u2);err=null}catch(e){err=e}}
    if(!r){set({status:'down',error:err?.name==='AbortError'?'too slow to answer':'can\'t reach the laptop',downUntil:Date.now()+(err?.name==='AbortError'?0:20000)});throw err||new Error('no address')}
    if(r.status===401){set({status:'down',error:'wrong pairing code'});throw new Error('wrong pairing code')}
    const j=await r.json().catch(()=>({}));
    if(!r.ok){if(r.status>=500)set({error:j.error||`laptop error ${r.status}`});throw new Error(j.error||`HTTP ${r.status}`)}
    if(st.status!=='ok')set({status:'ok',error:null,downUntil:0});
    return j;
  }
  async function check(){
    if(!st.code){set({status:'off'});return pub()}
    set({status:st.status==='ok'?'ok':'finding',downUntil:0});
    try{const h=await call('/health',{timeout:8000});set({status:'ok',loaded:!!h.loaded,voice:h.voice||'off',checked:Date.now(),error:null})}catch(e){if(st.status!=='down')set({status:'down',error:String(e.message||e)})}
    return pub();
  }
  return {
    get state(){return pub()},
    get ready(){return st.status==='ok'},
    setCode(c){st.code=normCode(c)?String(c).trim().toUpperCase():'';opt.set('laptop:code',st.code);st.found='';opt.set('laptop:found','');return check()},
    setUrl(u){st.manual=String(u||'').trim();opt.set('laptop:url',st.manual);return check()},
    check,discover,
    // load the model (and Whisper) now, so replies during the run are quick
    warm:()=>call('/warm',{body:{},timeout:60000}).then(j=>{set({loaded:!!j.loaded,voice:j.voice||st.voice});return j}).catch(()=>null),
    intent:(text,source='text')=>call('/intent',{body:{text,source},timeout:14000}),
    voice:wav=>call('/voice',{body:wav,kind:'wav',timeout:20000}),
    // a plan review takes up to a minute: it's started, then checked on every few seconds
    async plan(payload,{maxMs=150000}={}){
      const {job}=await call('/plan',{body:payload,timeout:15000}),t0=Date.now();
      while(Date.now()-t0<maxMs){
        await new Promise(r=>setTimeout(r,2500));
        let j;try{j=await call('/job?id='+job,{timeout:10000})}catch(e){if(/wrong pairing|no such job/.test(e.message))throw e;continue} // a dropped signal: try again
        if(j.status==='done')return j;if(j.status==='error')throw new Error(j.error||'the model failed');
      }
      throw new Error('the coach took too long');
    },
    log:ev=>call('/log',{body:ev,timeout:8000}).catch(()=>null),
  };
}
