// GPS: fix filtering, distance, km splits and rolling pace. No DOM access, so it can be tested in node.
export const WINDOW=30000; // current pace = last 30 s of movement

// Great-circle distance in metres
export function hav(a,b){const r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lon-a.lon)*r;
  const h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(h))}

// Track state: metres, last GPS point, rolling points, km split times (elapsed ms)
export function createTrack(){
  const s={dist:0,last:null,pts:[],splits:[]};
  // c = coords, ts = fix timestamp, el = pause-aware elapsed ms now
  s.add=(c,ts,el)=>{
    if(c.accuracy>25)return;                       // ignore poor fixes
    const q={lat:c.latitude,lon:c.longitude,t:ts};
    if(!s.last){s.last=q;s.pts.push({t:el,d:s.dist});return}
    const d=hav(s.last,q);
    if(d<3)return;                                 // GPS jitter while standing
    if(d/Math.max((q.t-s.last.t)/1000,1)>10){s.last=q;return} // >36 km/h = glitch
    s.dist+=d;s.last=q;
    s.pts.push({t:el,d:s.dist});
    while(s.dist>=(s.splits.length+1)*1000)s.splits.push(el); // km split times
  };
  // Drop points older than WINDOW; returns {sec,km} covered since the oldest kept point, or null
  s.rolling=t=>{
    s.pts=s.pts.filter(p=>t-p.t<=WINDOW);
    const o=s.pts[0];
    return o?{sec:(t-o.t)/1000,km:(s.dist-o.d)/1000}:null;
  };
  s.reset=()=>{s.dist=0;s.last=null;s.pts=[];s.splits=[]};
  return s;
}

export const watch=(onPos,onErr)=>navigator.geolocation.watchPosition(onPos,onErr,{enableHighAccuracy:true,maximumAge:0});
