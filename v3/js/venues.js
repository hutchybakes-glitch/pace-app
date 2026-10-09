// Where to run each session of a training plan, from your own routes, with the reason. The race course
// shapes it: its main climb picks the hill for hill reps, its hilliest stretch hosts the sub-threshold
// reps that teach you to hold effort over hills, and the tests and rehearsals run on the course itself.
// routes: [{id, name, pts (every 10 m, with ele)}]. Distances m. No DOM: runs under node --test.

const sm=pts=>pts.map((_,i)=>{let s=0,n=0;for(let j=Math.max(0,i-5);j<=Math.min(pts.length-1,i+5);j++)if(pts[j].ele!=null){s+=pts[j].ele;n++}return n?s/n:0});
const len=r=>r.pts.at(-1).d;
const kmS=m=>(m/1000).toFixed(1);
// Climb per km (how hilly a route is)
export const hilliness=r=>{let c=0;const e=sm(r.pts);for(let i=1;i<e.length;i++)c+=Math.max(0,e[i]-e[i-1]);return c/(len(r)/1000)};
// Average gradient (%) of the stretch [from, from + L] of a route
export function gradeOf(r,from,L){const e=sm(r.pts),a=Math.round(from/10),b=Math.min(e.length-1,Math.round((from+L)/10));return b>a?(e[b]-e[a])/((b-a)*10)*100:0}
// The climbs of a route: stretches where the gradient (over 100 m) stays at 1.5 % or more, at least L
// long and averaging min % or more, biggest gain first
export function climbs(r,{min=2.5,L=150}={}){
  const e=sm(r.pts),n=e.length,g=i=>{const a=Math.max(0,i-5),b=Math.min(n-1,i+5);return b>a?(e[b]-e[a])/((b-a)*10)*100:0};
  const out=[];let i=0;
  while(i<n){
    if(g(i)<1.5){i++;continue}
    let j=i;while(j<n-1&&(g(j+1)>=1.5||(j+6<n&&g(j+5)>=1.5&&g(j+3)>=0)))j++;   // (dips under 50 m don't end it)
    const d=(j-i)*10,gr=d?(e[j]-e[i])/d*100:0;if(d>=L&&gr>=min)out.push({from:i*10,len:d,grade:gr,gain:e[j]-e[i]});
    i=j+1;
  }
  return out.sort((a,b)=>b.gain-a.gain);
}
// The stretch of length L on any of the routes whose gradient is closest to `target` % (steepest if
// target is null), at least 3 %: {route, from, grade}
export function bestHill(routes,L,target=null){
  let best=null;
  for(const r of routes){const e=sm(r.pts),k=Math.round(L/10);
    for(let i=0;i+k<e.length;i+=3){const g=(e[i+k]-e[i])/L*100;if(g<3)continue;const sc=target==null?-g:Math.abs(g-target);if(!best||sc<best.sc)best={sc,route:r,from:i*10,grade:g}}}
  return best;
}
// The hilliest stretch of length L on a route (most climbing within it): {from, gain}
function hilliestStretch(r,L){
  const e=sm(r.pts),k=Math.round(L/10),up=[0];for(let i=1;i<e.length;i++)up.push(up[i-1]+Math.max(0,e[i]-e[i-1]));
  let best={from:0,gain:-1};for(let i=0;i+k<e.length;i+=5){const g=up[i+k]-up[i];if(g>best.gain)best={from:i*10,gain:g}}
  return best;
}
const flattest=(routes,L)=>{const ok=routes.filter(r=>len(r)>=L-30);return (ok.length?ok:routes).slice().sort((a,b)=>hilliness(a)-hilliness(b))[0]};
const closest=(routes,L)=>{const ok=routes.filter(r=>len(r)>=L*0.85);return ok.length?ok.sort((a,b)=>Math.abs(len(a)-L)-Math.abs(len(b)-L))[0]:routes.slice().sort((a,b)=>len(b)-len(a))[0]};

// What a session needs from where it's run: only the course tests need the course; everything else can be
// run anywhere, and the route is a suggestion
export const ANYWHERE={flat:'Anywhere reasonably flat: then pace equals effort.',course:'Anywhere. Some hills help you practise holding effort over them, but flat ground does the same job for your threshold.',
  rolling:'Anywhere. Some hills help you practise holding effort over them, but flat ground does the same job for your threshold.',
  hill:'Any hill of about 4–8 %, around 200 m long.','hill-short':'Anywhere, with a short, steep hill for the sprints.','course-part':'Best on the course itself; otherwise any route with a few hills, at race pace.',
  'course-start':'Anywhere flat or gently rolling.','course-full':'The full race course: that is the test.','flat-5k':'Any flat 5 km.','long-rolling':'Anywhere.','long-flat':'Anywhere.',any:'Anywhere.'};
// Where to run a session. v: the session's venue hint {type, len}; s: the session (reps, len…);
// course: the race course route (or null). Returns {route, how ('full'|'part'|'int'), from, len, dir, note
// (the suggestion and why), anywhere (what any route needs)}
export function venueFor(v,s,routes,course){
  const out=venueFor0(v,s,routes,course);if(out)out.anywhere=ANYWHERE[v.type]||ANYWHERE.any;return out;
}
function venueFor0(v,s,routes,course){
  if(!routes.length)return null;
  // without the course, its sessions run on whatever route you're using
  if(!course&&v.type.startsWith('course'))v={...v,type:{course:'rolling','course-part':'any','course-start':'flat','course-full':'any-full'}[v.type]};
  if(v.type==='any-full'){const r=closest(routes,s.dist||10000);return {route:r,how:'full',len:len(r),note:`${r.name}.`}}
  const main=course?climbs(course)[0]:null,all=course&&!routes.includes(course)?[...routes,course]:routes;
  const full=(r,note)=>({route:r,how:'full',len:len(r),note});
  const part=(r,L,note)=>len(r)>L+50?{route:r,how:'part',len:L,note}:full(r,note);
  const reps=(r,from,dir,note)=>({route:r,how:'int',from,len:Math.min(s.len,len(r)-from),dir,note});
  switch(v.type){
    case 'course-full':if(course)return full(course,`The full ${course.name}: the course itself, every hill.`);break;
    case 'course-part':if(course)return part(course,v.len,`The first ${kmS(v.len)} km of ${course.name}, at race pace over its real hills.`);break;
    case 'course-start':if(course)return reps(course,0,'alternate',`The opening stretch of ${course.name}, there and back: race pace on the ground you'll start on.`);break;
    case 'course':if(course&&s.reps){const h=hilliestStretch(course,s.len);
      return reps(course,h.from,'alternate',`${course.name}, ${kmS(h.from)}–${kmS(h.from+s.len)} km: its hilliest stretch, there and back, so one rep climbs and the next descends. The pacer keeps the effort even.`)}break;
    case 'rolling':if(s.reps){const r=all.slice().sort((a,b)=>hilliness(b)-hilliness(a))[0],h=hilliestStretch(r,s.len);
      if(hilliness(r)<4)return reps(r,0,'alternate',`${r.name}: flat, which does just as much for your threshold.`);
      return reps(r,h.from,'alternate',`${r.name}, ${kmS(h.from)} km on, there and back: ${all.length>1?'your hilliest stretch, so you practise holding effort over hills':'its hilliest stretch'}.`)}break;
    case 'hill':{ // match the course's steepest real climb (hill reps want 4–8 %)
      const steep=course?climbs(course).sort((a,b)=>b.grade-a.grade)[0]:null,target=steep?Math.max(4,Math.min(8,steep.grade)):6,h=bestHill(all,s.len||200,target);
      if(h)return reps(h.route,Math.round(h.from/10)*10,'same',`${h.route.name}, from ${kmS(h.from)} km: ${s.len||200} m at ${h.grade.toFixed(1)} %${steep?`, ${h.route===course&&Math.abs(h.from-steep.from)<=steep.len?`the course's own steepest climb`:`the closest match to ${course.name}'s steepest climb (${steep.grade.toFixed(1)} % at ${kmS(steep.from)} km)`}`:''}. Jog back down to the same spot each time.`);
      const r=flattest(routes,s.len);return {...reps(r,0,'same',`None of your routes has a real hill: run these as 45–60 s hard efforts on ${r.name}, jogging back.`)}}
    case 'hill-short':{const h=bestHill(all,100,null),r=h?h.route:closest(routes,s.dist||5000);
      return {...full(closest(routes,s.dist||5000),h?`Easy run anywhere; do the sprints on ${h.route.name} at ${kmS(h.from)} km, its steepest 100 m (${h.grade.toFixed(1)} %).`:'Easy run anywhere; do the sprints on the steepest short hill you can find.'),hillAt:h?{route:r.id,from:h.from}:null}}
    case 'flat':{const r=flattest(routes,s.len||v.len||1000);return s.reps?reps(r,0,(s.len||0)>=600?'alternate':'same',`${r.name}: your flattest route, so pace equals effort and you can hold sub-threshold precisely.`):part(r,s.dist,`${r.name}: flat and steady.`)}
    case 'flat-5k':{const r=flattest(routes,5000);return part(r,5000,`${r.name}: your flattest route, for a fair time trial.`)}
    case 'long-rolling':{const ok=all.filter(r=>len(r)>=(v.len||10000)*0.8),r=(ok.length?ok:all).slice().sort((a,b)=>hilliness(b)-hilliness(a))[0];
      return part(r,v.len,`${r.name}: rolling, like the race, so climbing on tired legs becomes normal.${len(r)<(v.len||0)*0.95?` It's ${kmS(len(r))} km: add the rest on another loop.`:''}`)}
    case 'long-flat':{const r=closest(routes.filter(x=>hilliness(x)<=Math.min(...routes.map(hilliness))+4),v.len||10000)||closest(routes,v.len);
      return part(r,v.len,`${r.name}: flat and steady for an easy long run.${len(r)<(v.len||0)*0.95?` It's ${kmS(len(r))} km: add the rest on another loop.`:''}`)}
  }
  const r=closest(routes,s.dist||v.len||5000);return part(r,s.dist||v.len||len(r),`${r.name}.`);
}
