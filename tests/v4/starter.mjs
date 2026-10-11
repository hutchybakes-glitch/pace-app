// The 10K starter plan: ten weeks, four runs a week from about 25 km, a 10 km time trial on the first
// Sunday and every four weeks, Norwegian-style (two sub-threshold sessions, hills, a long run)
import {programme,mondayOf,addDays} from '../../v4/js/training.js';
import {toDoc} from '../../v4/js/plandoc.js';
export const STARTER_CFG=m0=>({start:m0,raceDate:addDays(m0,7*9+6)+9*3600e3,dist:'10k',days:4,km:25,longKm:10,firstTest:addDays(m0,6)+9*3600e3,course:false});
export function starter(){
  const m0=mondayOf(new Date(2027,0,4).getTime()),P=programme(STARTER_CFG(m0),{vdot:45});
  return toDoc(P,{name:'10K starter plan',race:{name:'10K',distance_m:10000},vdot:45,from:'template'},{dated:false});
}
