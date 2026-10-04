// Weather: the forecast for the race (Open-Meteo, free, no key) and how it changes the pacer's run.
//   heat & humidity  the runners' temperature + dew point rule (°F sum → % slower), smoothed; full sun
//                    adds to the felt heat; the cost builds over the first hour as the body stores heat
//   cold             a little slower below 5 °C
//   wind             per 10 m of road, the head/tail component for that stretch's direction, scaled from
//                    10 m height to runner height and shelter, through air resistance ∝ (speed + headwind)²:
//                    a headwind costs more than the same tailwind gives back
//   rain             wet descents give back half their usual benefit (more braking)
// Pure except fetchWeather, so it runs under node --test.

export const SHELTER={open:0.75,some:0.55,sheltered:0.35}; // 10 m wind → wind a runner feels
const toF=c=>c*9/5+32;
// temperature + dew point (°F) → % slower: a smooth version of the common pacing table
const HEAT=[[100,0],[110,1],[120,2],[130,3],[140,4.5],[150,6],[160,8],[170,10],[180,12],[200,16]];

export function heatPct(tempC,dewC,rad=0){
  const s=toF(tempC)+toF(dewC)+Math.max(0,rad)/100; // full sun (~800 W/m²) feels ~8 °F hotter
  let p=0;
  if(s>HEAT[0][0]){
    p=HEAT.at(-1)[1];
    for(let i=1;i<HEAT.length;i++)if(s<=HEAT[i][0]){const [a,pa]=HEAT[i-1],[b,pb]=HEAT[i];p=pa+(pb-pa)*(s-a)/(b-a);break}
  }
  if(tempC<5)p+=Math.min(3,(5-tempC)*0.15);
  return p;
}

// Pace multiplier for a headwind w (m/s at runner height, − = tailwind) at running speed v (m/s).
// Air resistance is ~2 % of the cost of running at 3.3 m/s, growing with speed².
export function windFactor(v,w){
  const a=0.02*(v/3.33)**2,r=v+w;
  return 1+a*(r*Math.abs(r)-v*v)/(v*v);
}

// Hourly forecast around startMs: {time[ms], temp[°C], dew[°C], rh[%], wind[m/s at 10 m], dir[° from], rain[mm/h], rad[W/m²]}
export async function fetchWeather(lat,lon,startMs,fetchFn=fetch){
  const day=ms=>new Date(ms).toISOString().slice(0,10);
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`+
    `&hourly=temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,shortwave_radiation`+
    `&wind_speed_unit=ms&timezone=GMT&start_date=${day(startMs-6*3600e3)}&end_date=${day(startMs+30*3600e3)}`;
  const r=await fetchFn(url);
  if(!r.ok)throw new Error(r.status===400?'No forecast for that time yet (forecasts go up to 16 days ahead)':`Weather unavailable (HTTP ${r.status})`);
  const h=(await r.json()).hourly;
  if(!h?.time?.length)throw new Error('Weather unavailable');
  return {lat,lon,fetched:Date.now(),time:h.time.map(t=>Date.parse(t+'Z')),temp:h.temperature_2m,dew:h.dew_point_2m,
    rh:h.relative_humidity_2m,wind:h.wind_speed_10m,dir:h.wind_direction_10m,rain:h.precipitation,rad:h.shortwave_radiation};
}

// Conditions at time ms, interpolated between hours (wind direction through its vector)
export function at(w,ms){
  const T=w.time;let i=0;
  if(ms<=T[0])i=0;else if(ms>=T.at(-1))i=T.length-2;else while(T[i+1]<ms)i++;
  const f=Math.max(0,Math.min(1,(ms-T[i])/((T[i+1]-T[i])||1))),L=a=>(a[i]??0)+((a[i+1]??a[i]??0)-(a[i]??0))*f;
  const rad=d=>d*Math.PI/180,u=k=>w.wind[k]*Math.sin(rad(w.dir[k])),v=k=>w.wind[k]*Math.cos(rad(w.dir[k]));
  const uu=u(i)+(u(i+1)-u(i))*f,vv=v(i)+(v(i+1)-v(i))*f;
  return {temp:L(w.temp),dew:L(w.dew),rh:L(w.rh),wind:L(w.wind),dir:(Math.atan2(uu,vv)*180/Math.PI+360)%360,rain:L(w.rain),rad:L(w.rad)};
}

// Bearing (° from north) of the road at each route point, over ±20 m
export function bearings(pts){
  const k=Math.cos(pts[0].lat*Math.PI/180);
  return pts.map((p,i)=>{const a=pts[Math.max(0,i-2)],b=pts[Math.min(pts.length-1,i+2)];return (Math.atan2((b.lon-a.lon)*k,b.lat-a.lat)*180/Math.PI+360)%360});
}

// Per route point: pace multiplier from the weather, the heat %, the headwind felt (m/s, − = tail) and wet.
// times = seconds from the start at each point; v = running speed (m/s)
export function weatherFactors(pts,times,w,startMs,{shelter='some',v=3.33}={}){
  const br=bearings(pts),sh=SHELTER[shelter]??SHELTER.some,f=[],heat=[],head=[],wet=[];
  for(let i=0;i<pts.length;i++){
    const t=times[i],c=at(w,startMs+t*1000);
    const h=heatPct(c.temp,c.dew,c.rad)*(0.6+0.4*Math.min(1,t/3600));
    const hw=c.wind*sh*Math.cos((c.dir-br[i])*Math.PI/180);
    heat.push(h);head.push(hw);wet.push(c.rain>=0.3);
    f.push((1+h/100)*windFactor(v,hw));
  }
  return {f,heat,head,wet};
}

// Stretches of road (≥ 300 m) where the wind felt is over 1 m/s head- or tailwind: [{from,to,kind}].
// Stretches of the same kind less than `join` m apart are joined.
export function windStretches(d,head,min=300,join=250){
  const out=[];let s=null;
  const kind=x=>x>1?'head':x<-1?'tail':null;
  for(let i=0;i<d.length;i++){
    const k=kind(head[i]);
    if(s&&k!==s.kind){if(d[i]-s.from>=min)out.push({...s,to:d[i]});s=null}
    if(!s&&k)s={from:d[i],kind:k};
  }
  if(s&&d.at(-1)-s.from>=min)out.push({...s,to:d.at(-1)});
  return out.reduce((a,x)=>{const l=a.at(-1);if(l&&l.kind===x.kind&&x.from-l.to<join)l.to=x.to;else a.push({...x});return a},[]);
}

export const compass16=b=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(b/22.5)%16];
export const mph=ms=>ms*2.23694;
