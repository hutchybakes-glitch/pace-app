import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGPX,resample} from '../../v3/js/route.js';
import {importRun} from '../../v3/js/import.js';
import {ghostFromRun,timeAt} from '../../v3/js/pacer.js';
import {encodeChallenge,decodeChallenge,challengeRoute,challengeRun,timeAtD} from '../../v3/js/share.js';

const read=f=>parseGPX(fs.readFileSync(new URL('../fixtures/'+f,import.meta.url),'utf8'));
const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);

test('challenge: a run survives the link: same course, same time at every point',async()=>{
  const g=read('timed-outback.gpx'),route=resample(g.pts),run=importRun(g.timed,route);
  run.complete=true;
  const code=await encodeChallenge(route,run,{who:'Sam',name:'Out and back'});
  assert.match(code,/^[A-Za-z0-9_-]+$/,'URL-safe');
  assert.ok(code.length<4000,`link length ${code.length}`);
  const c=await decodeChallenge(code);
  assert.equal(c.who,'Sam');assert.equal(c.name,'Out and back');assert.equal(c.started,run.started);
  close(c.elapsed,run.elapsed/1000,0.1);close(c.D,route.at(-1).d,0.1);
  const pts=challengeRoute(c);
  close(pts.at(-1).d,route.at(-1).d,0.5,'distance kept');
  for(const d of [0,1000,2500,4000])close(pts[d/10].lat,route[d/10].lat,2e-5);
  close(pts[150].ele,route[150].ele,1.5,'elevation');
  // the ghost runs it exactly as the original
  const r=challengeRun(c,pts),G=ghostFromRun(pts,r.fixes,r.elapsed/1000),G0=ghostFromRun(route,run.fixes,run.elapsed/1000);
  for(const d of [500,1500,2600,3900])close(timeAt(G,d),timeAt(G0,d),1.5,`time at ${d} m`);
  close(G.finish,run.elapsed/1000,0.2,'finish');
  assert.equal(r.imported.who,'Sam');assert.equal(r.rsplits.length,Math.floor(route.at(-1).d/1000));
  close(r.rsplits[1]/1000,timeAtD(run,2000),1.5,'2 km split');
});

test('challenge: a 10 km route stays a reasonable link; junk is refused',async()=>{
  const g=read('ribble-valley-10k-2023.gpx'),route=resample(g.pts);
  // a made-up even 5:00/km run of it
  const fixes=route.map(p=>[0,p.d*300,p.lat,p.lon,5,p.d,p.d,300,null,null,p.d]);
  const run={started:1,elapsed:route.at(-1).d*300,rd:route.at(-1).d,complete:true,fixes};
  const code=await encodeChallenge(route,run,{who:'Jo'});
  assert.ok(code.length<6000,`10 km link ${code.length}`);
  const c=await decodeChallenge(code);close(challengeRoute(c).at(-1).d,route.at(-1).d,0.5);
  await assert.rejects(decodeChallenge('AAAA'));
  await assert.rejects(decodeChallenge('not a code!'));
});
