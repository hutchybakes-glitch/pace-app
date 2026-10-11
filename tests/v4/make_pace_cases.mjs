// Writes tests/v4/pace_cases.json: input/output pairs from the JS calculator, which coach/pace.py must
// reproduce (run: node tests/v4/make_pace_cases.mjs). The JS itself is checked against Daniels' tables.
import {writeFileSync} from 'node:fs';
import * as P from '../../v4/js/pace.js';
const races=[[5000,1200],[5000,1500],[10000,2490],[10000,3000],[21097.5,5400],[42195,12600],[1609.344,330],[3000,660]];
const cases={
  vdot:races.map(([d,s])=>({d,s,vdot:P.vdot(d,s)})),
  raceTime:[30,35,40,45,50,55,60,70].flatMap(v=>[1500,5000,10000,21097.5,42195].map(d=>({v,d,s:P.raceTime(v,d)}))),
  riegel:races.map(([d,s])=>({d,s,to:10000,t:P.riegel(d,s,10000)})),
  zones:[35,45.6,50,60].map(v=>({v,raceDist:10000,zones:P.zones(v,{raceDist:10000})})),
  zonesGoal:[{v:46,raceDist:10000,raceTarget:2700,zones:P.zones(46,{raceDist:10000,raceTarget:2700})}],
  units:{perKmToPerMile:[[300,P.perKmToPerMile(300)]],perMileToPerKm:[[480,P.perMileToPerKm(480)]],kmToMiles:[[10,P.kmToMiles(10)]],milesToKm:[[26.2,P.milesToKm(26.2)]],
    paceToKmh:[[300,P.paceToKmh(300)]],kmhToPace:[[12,P.kmhToPace(12)]],paceToMph:[[300,P.paceToMph(300)]],mphToPace:[[7.5,P.mphToPace(7.5)]]},
  parseDuration:['41:30','1:31:35','5:03.5','0:59','61:00','1:60:00','abc','',':30','12'].map(x=>[x,P.parseDuration(x)]),
  formatDuration:[59.6,61,2490,5495,36000].map(x=>[x,P.formatDuration(x)]),
  parsePace:[['4:40/km','km'],['7:30/mi','km'],['7:30 per mile','km'],['5:00','mi'],['5:00','km'],['4:75','km'],['fast','km']].map(([x,u])=>[x,u,P.parsePace(x,u)]),
  formatPace:[[280,'km'],[280,'mi'],[299.6,'km']].map(([x,u])=>[x,u,P.formatPace(x,u)]),
  parseDistance:['10k','5 km','6.2 mi','400m','half','marathon','mile','3 miles','ten'].map(x=>[x,P.parseDistance(x)]),
  stepPace:[[320,1,'easy',false],[320,-1,'easy',true],[300,-1,'easy',false],[262,-1,'subthreshold',false],[262,1,'subthreshold',false],[268,1,'subthreshold',false]].map(([p,dir,z,os])=>{
    const Z=P.zones(50);return {pace:p,dir,zone:z,onlySlower:os,zoneFast:Z[z].fast,zoneSlow:Z[z].slow,out:P.stepPace(p,dir,Z[z],{onlySlower:os})}}),
};
writeFileSync(new URL('./pace_cases.json',import.meta.url),JSON.stringify(cases,null,1));
console.log('wrote',Object.keys(cases).length,'groups');
