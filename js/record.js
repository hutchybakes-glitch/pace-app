// Run records: what is saved for each GPS fix, and summary stats for the history list.
// A run record is {id, started, saved, status:'active'|'done', running, sim, elapsed, dist, splits,
//   rd, rsplits, route:{id,name,src,pts}|null, segs, pace, S, amber, fixes:[[...FIX]]}

// Field order of each saved fix: wall-clock ms, elapsed ms, position, accuracy m, GPS distance m,
// route distance m, segment id, current pace s/km, target pace s/km, band green|amber|red
export const FIX=['ts','t','lat','lon','acc','d','rd','seg','cur','tgt','band'];
export const I=Object.fromEntries(FIX.map((k,i)=>[k,i]));

// Elapsed ms, distance m (route distance on a route run), average pace s/km, and the fraction of
// moving time spent in the green band (route runs; gaps over 30 s between fixes are skipped)
export function summarise(r){
  const dist=r.route?r.rd:r.dist,km=dist/1000;
  let inT=0,allT=0;
  if(r.route)for(let i=1;i<r.fixes.length;i++){
    const a=r.fixes[i-1],dt=r.fixes[i][I.t]-a[I.t];
    if(a[I.band]==null||dt<=0||dt>30000)continue;
    allT+=dt;if(a[I.band]==='green')inT+=dt;
  }
  return {elapsed:r.elapsed,dist,avg:km>0.005?r.elapsed/1000/km:null,inBand:allT?inT/allT:null};
}

// Whether a run recorded enough to be worth keeping
export const worthKeeping=r=>r.fixes.length>=2&&(r.route?r.rd:r.dist)>=50;
