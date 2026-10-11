// Pace calculator: unit conversion, race predictions (Daniels & Gilbert VDOT, and Riegel), training pace
// zones from a race time, and the bounded pace step the in-run coach uses. All pace maths in Pacer comes
// from here: the AI coach only ever names a zone or a direction, never a number.
// Mirrored line for line in coach/pace.py; both are checked against tests/v4/pace_cases.json.
// Paces are seconds per km and distances metres unless a name says otherwise. No DOM: runs under node.

export const MILE=1609.344;
export const DISTANCES={'1500m':1500,mile:MILE,'3k':3000,'5k':5000,'10k':10000,'15k':15000,'10mile':10*MILE,half:21097.5,marathon:42195};
export const DIST_NAMES={'1500m':'1500 m',mile:'Mile','3k':'3K','5k':'5K','10k':'10K','15k':'15K','10mile':'10 miles',half:'Half marathon',marathon:'Marathon'};

// ---- Units ----
export const kmToMiles=km=>km*1000/MILE;
export const milesToKm=mi=>mi*MILE/1000;
export const perKmToPerMile=s=>s*MILE/1000;
export const perMileToPerKm=s=>s*1000/MILE;
export const paceToKmh=s=>3600/s;
export const kmhToPace=kmh=>3600/kmh;
export const paceToMph=s=>3600/perKmToPerMile(s);
export const mphToPace=mph=>perMileToPerKm(3600/mph);

// "41:30", "1:31:35", "41:30.5" or a number of seconds -> seconds (null if it isn't a time)
export function parseDuration(x){
  if(typeof x==='number')return isFinite(x)&&x>0?x:null;
  const m=String(x??'').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/);
  if(!m||+m[3]>=60||(m[1]!=null&&+m[2]>=60))return null;
  return (+(m[1]||0))*3600+(+m[2])*60+(+m[3]);
}
// seconds -> "41:30" or "1:31:35" (rounded to the second)
export function formatDuration(s){
  s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=String(s%60).padStart(2,'0');
  return h?`${h}:${String(m).padStart(2,'0')}:${x}`:`${m}:${x}`;
}
// "4:40/km", "7:30/mi", "7:30 per mile", or "4:40" with a default unit -> seconds per km
export function parsePace(x,unit='km'){
  const m=String(x??'').trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(?:\/|per\s*)?\s*(km|k|kilometre|kilometer|mi|mile)?$/);
  if(!m||+m[2]>=60)return null;
  const s=+m[1]*60+(+m[2]),u=m[3]?(m[3].startsWith('m')?'mi':'km'):unit;
  return u==='mi'?perMileToPerKm(s):s;
}
// seconds per km -> "4:40/km" or "7:30/mi"
export function formatPace(s,unit='km'){
  const v=Math.round(unit==='mi'?perKmToPerMile(s):s);
  return `${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}/${unit}`;
}
// "10k", "5 km", "6.2 mi", "400m", "half", "marathon", "mile" -> metres
export function parseDistance(x){
  const t=String(x??'').trim().toLowerCase().replace(/\s+/g,'');
  const named={'1500m':1500,mile:MILE,'1mile':MILE,'5k':5000,'10k':10000,'15k':15000,'10mile':10*MILE,'10miles':10*MILE,half:21097.5,halfmarathon:21097.5,marathon:42195};
  if(named[t]!=null)return named[t];
  const m=t.match(/^(\d+(?:\.\d+)?)(km|k|mi|miles?|m)$/);
  if(!m)return null;
  const n=+m[1];
  return m[2]==='m'?n:m[2].startsWith('mi')?n*MILE:n*1000;
}

// ---- Fitness: VDOT (Daniels & Gilbert, 1979) ----
// Oxygen cost (ml/kg/min) of running at v metres per minute
export const vo2=v=>-4.60+0.182258*v+0.000104*v*v;
// The fraction of VO2max you can hold for t minutes
export const pctMax=t=>0.8+0.1894393*Math.exp(-0.012778*t)+0.2989558*Math.exp(-0.1932605*t);
// VDOT from a race: distance (m) in time (s)
export function vdot(d,s){const t=s/60;return vo2(d/t)/pctMax(t)}
// The race time (s) over d metres that a VDOT predicts (bisection: VDOT falls as time rises)
export function raceTime(v,d){
  let lo=d/1000*100,hi=d/1000*1200;
  for(let k=0;k<60;k++){const m=(lo+hi)/2;if(vdot(d,m)>v)lo=m;else hi=m}
  return (lo+hi)/2;
}
// The pace (s/km) that costs a fraction f of VDOT (Daniels' training intensities)
export function paceAtPct(v,f){
  const a=0.000104,b=0.182258,c=-4.60-f*v,vel=(-b+Math.sqrt(b*b-4*a*c))/(2*a);
  return 60000/vel;
}
// Riegel's formula: time over d2 from a time over d1 (k = 1.06 is the classic fatigue factor)
export const riegel=(d1,t1,d2,k=1.06)=>t1*Math.pow(d2/d1,k);
// Predicted time over `to` metres from a race of d metres in s seconds
export const predict=(d,s,to)=>raceTime(vdot(d,s),to);
// Predictions for the standard distances, by VDOT and by Riegel
export function predictions(d,s){
  const v=vdot(d,s);
  return Object.entries(DISTANCES).map(([id,m])=>({id,name:DIST_NAMES[id],d:m,time:raceTime(v,m),riegel:riegel(d,s,m),pace:raceTime(v,m)/(m/1000)}));
}

// ---- Training pace zones ----
// Fractions of VDOT, slowest to quickest. `target` is the pace a session aims for; [lo, hi] are the
// zone's limits, which bound every change the coach can make.
export const ZONES=[
  {id:'recovery',name:'Recovery',lo:0.56,hi:0.62,target:0.60,feel:'very easy, barely running'},
  {id:'easy',name:'Easy',lo:0.62,hi:0.72,target:0.67,feel:'conversational'},
  {id:'steady',name:'Steady',lo:0.74,hi:0.82,target:0.78,feel:'marathon effort, relaxed but working'},
  {id:'subthreshold',name:'Sub-threshold',lo:0.83,hi:0.87,target:0.855,feel:'comfortably hard, never straining'},
  {id:'threshold',name:'Threshold',lo:0.87,hi:0.90,target:0.88,feel:'the pace you could hold for about an hour'},
  {id:'interval',name:'Interval',lo:0.95,hi:1.00,target:0.98,feel:'hard, about 3K–5K effort'},
  {id:'repetition',name:'Repetition',lo:1.04,hi:1.10,target:1.07,feel:'fast and relaxed, about mile effort'},
];
export const ZONE_IDS=[...ZONES.map(z=>z.id),'race'];
// Race-pace zone: the predicted pace for the race distance, give or take 1.5 %
const RACE_TOL=0.015;
// Every zone's paces for a VDOT: {id: {id, name, target, fast, slow, feel}} in s/km (fast < slow).
// raceDist: the race the 'race' zone is for; raceTarget: a goal time for it (s), if you have one.
export function zones(v,{raceDist=10000,raceTarget=null}={}){
  const out={};
  for(const z of ZONES)out[z.id]={id:z.id,name:z.name,target:paceAtPct(v,z.target),fast:paceAtPct(v,z.hi),slow:paceAtPct(v,z.lo),feel:z.feel};
  const rp=(raceTarget||raceTime(v,raceDist))/(raceDist/1000);
  out.race={id:'race',name:'Race pace',target:rp,fast:rp*(1-RACE_TOL),slow:rp*(1+RACE_TOL),feel:'goal race effort'};
  return out;
}
// Everything from one race result: VDOT, zones and predictions
export function fromRace(d,s,opts={}){
  const v=vdot(d,s);
  return {vdot:v,zones:zones(v,opts),predictions:predictions(d,s)};
}
// Which zone a pace falls in (the closest zone target if it falls between zones)
export function zoneOf(pace,Z){
  const list=Object.values(Z).filter(z=>z.id!=='race');
  return (list.find(z=>pace>=z.fast&&pace<=z.slow)||list.slice().sort((a,b)=>Math.abs(a.target-pace)-Math.abs(b.target-pace))[0]).id;
}

// ---- The bounded step (in-run "slower" / "faster") ----
export const STEP_PER_MILE=12;            // seconds per mile per step (about 7.5 s/km)
// One step slower (dir +1) or faster (dir -1) from `pace`, kept inside the zone's limits [fast, slow].
// onlySlower: easy runs can only slow down. Returns {pace, changed, limit ('fast'|'slow'|null), by (s/km)}
export function stepPace(pace,dir,zone,{steps=1,onlySlower=false,perMile=STEP_PER_MILE}={}){
  if(dir<0&&onlySlower)return {pace,changed:false,limit:'easy',by:0};
  const want=pace+dir*steps*perMileToPerKm(perMile);
  const lo=Math.min(zone.fast,pace),hi=Math.max(zone.slow,pace); // never forces a jump if already outside
  const next=Math.max(lo,Math.min(hi,want)),limit=dir<0&&next<=lo+0.01&&want<lo?'fast':dir>0&&next>=hi-0.01&&want>hi?'slow':null;
  return {pace:next,changed:Math.abs(next-pace)>0.05,limit,by:next-pace};
}
