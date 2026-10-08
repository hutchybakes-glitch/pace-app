import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGPX,resample} from '../../v2/js/route.js';
import {importRun,hasTimes,sameRoute} from '../../v2/js/import.js';
import {ghostFromRun,timeAt,paceAt} from '../../v2/js/pacer.js';

const read=f=>parseGPX(fs.readFileSync(new URL('../fixtures/'+f,import.meta.url),'utf8'));
const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);

test('import: a GPX with times is a run; one without is just a route',()=>{
  assert.ok(hasTimes(read('timed-outback.gpx').timed));
  assert.ok(!hasTimes(read('outback-hill.gpx').timed));
});

test('import: the run keeps its paces (5:00, 6:00 up the climb), with the 60 s stop taken out',()=>{
  const g=read('timed-outback.gpx'),route=resample(g.pts),r=importRun(g.timed,route);
  // 0.5 km and 4.5 km at 5:00, 2.0 km of climb at 6:00, no stop: 27:00
  close(r.elapsed/1000,27*60,6,'moving time');close(r.paused/1000,60,2,'stop');
  assert.ok(r.complete);close(r.rd,route.at(-1).d,30);
  close((r.rsplits[1]-r.rsplits[0])/1000,360,4,'km 2 (climb)');close((r.rsplits[3]-r.rsplits[2])/1000,300,4,'km 4');
  // and as a ghost it runs those paces
  const G=ghostFromRun(route,r.fixes,r.elapsed/1000);
  close(G.finish,r.elapsed/1000,1);close(paceAt(G,1500),360,8,'ghost on the climb');close(paceAt(G,3500),300,8,'ghost later');
  // cadence 172, stride = speed / cadence
  const f=r.fixes[100];assert.equal(f[8],172);close(f[9],(1000/f[7])/(172/60),0.02);
});

test('import: recognises a route you already have',()=>{
  const g=read('timed-outback.gpx'),pts=resample(g.pts),other=resample(read('ribble-valley-10k-2023.gpx').pts);
  const mine={id:7,pts:resample(read('outback-hill.gpx').pts)};
  assert.equal(sameRoute([{id:1,pts:other},mine],pts),mine);
  assert.equal(sameRoute([{id:1,pts:other}],pts),null);
});
