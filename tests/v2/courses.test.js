import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGPX,resample} from '../../v2/js/route.js';
import {slice,isLoop,laps,session,pointAt,cuesWithin} from '../../v2/js/courses.js';
import {buildPacer,paceAt,timeAt,effortTime,PROFILES} from '../../v2/js/pacer.js';

const load=f=>resample(parseGPX(fs.readFileSync(new URL('../fixtures/'+f,import.meta.url),'utf8')).pts);
const close=(a,b,e,m='')=>assert.ok(Math.abs(a-b)<=e,`${m} ${a} vs ${b}`);

test('courses: part of a route is the first stretch, with its hills',()=>{
  const pts=load('ribble-valley-10k-2023.gpx'),p=slice(pts,0,6000);
  close(p.at(-1).d,6000,0.01);assert.ok(p.every((q,i)=>i===p.length-1||Math.abs(q.d-i*10)<1e-9),'every 10 m');close(p[0].lat,pts[0].lat,1e-6);
  close(pointAt(p,3000).ele,pointAt(pts,3000).ele,1.5,'ele at 3 km');
  assert.deepEqual(cuesWithin([{d:100},{d:7000}],0,6000).map(c=>c.d),[100]);
});

test('courses: reversed stretch runs the other way: uphill becomes downhill',()=>{
  const pts=load('outback-hill.gpx'),up=slice(pts,500,1500),down=slice(pts,500,1500,true);
  close(up.at(-1).d,1000,12);close(down.at(-1).d,1000,12);
  assert.ok(up.at(-1).ele>up[0].ele+30&&down.at(-1).ele<down[0].ele-30);
  close(down[0].lat,up.at(-1).lat,1e-6);
});

test('courses: laps of a loop; an out-and-back is not a loop... unless it finishes at the start',()=>{
  const lap=load('three-laps.gpx').slice(0,121),one=resample(lap.map(p=>({lat:p.lat,lon:p.lon,ele:p.ele})));
  assert.ok(isLoop(one));
  const five=laps(one,5);close(five.at(-1).d,one.at(-1).d*5,30,'5 laps');
  close(pointAt(five,one.at(-1).d*2+250).ele,pointAt(one,250).ele,1.5,'lap 3 matches lap 1');
  assert.ok(!isLoop(slice(one,0,600)));
});

test('courses: a negative-split pacer over 5 laps gets quicker lap by lap',()=>{
  const one=resample(load('three-laps.gpx').slice(0,121).map(p=>({lat:p.lat,lon:p.lon,ele:p.ele}))),five=laps(one,5),L=one.at(-1).d;
  const P=buildPacer(five,25*60,{climb:'average',descent:'average',strategy:'negative'});
  const lapT=[0,1,2,3,4].map(i=>timeAt(P,(i+1)*L)-timeAt(P,i*L));
  for(let i=1;i<5;i++)assert.ok(lapT[i]<lapT[i-1],`lap ${i+1} ${lapT[i]} < lap ${i} ${lapT[i-1]}`);
});

test('courses: interval sessions: repeats from the same start, there and back, or the route split up',()=>{
  const pts=load('outback-hill.gpx');
  const same=session(pts,{kind:'repeat',from:500,len:1000,reps:8,dir:'same',pace:270,step:0});
  assert.equal(same.length,8);assert.ok(same.every(r=>!r.reverse&&r.from===500&&r.to===1500&&r.grade>3));
  const alt=session(pts,{kind:'repeat',from:500,len:1000,reps:4,dir:'alternate',pace:270,step:-2});
  assert.deepEqual(alt.map(r=>r.reverse),[false,true,false,true]);assert.ok(alt[1].grade<-3);
  assert.deepEqual(alt.map(r=>r.pace),[270,268,266,264]);
  const split=session(load('ribble-valley-10k-2023.gpx'),{kind:'split',len:1000,pace:280});
  assert.equal(split.length,10);close(split.at(-1).to,10070,30);assert.ok(split.at(-1).len>1000); // last 70 m joins the last rep
});

test('courses: rep targets at a flat-equivalent pace: uphill takes longer, downhill less',()=>{
  const pts=load('outback-hill.gpx'),up=slice(pts,500,1500),down=slice(pts,500,1500,true),flat=slice(pts,0,450),p={climb:'average',descent:'average',strategy:'even'};
  const tu=effortTime(up,300,p),td=effortTime(down,300,p),tf=effortTime(flat,300,p);
  close(tf,300*0.45,2,'flat');assert.ok(tu>330&&td<290,`up ${tu} down ${td}`);
});
