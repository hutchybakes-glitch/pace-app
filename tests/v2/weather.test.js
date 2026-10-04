import {test} from 'node:test';
import assert from 'node:assert/strict';
import {heatPct,windFactor,at,bearings,weatherFactors,windStretches,fetchWeather,compass16} from '../../v2/js/weather.js';
import {buildPacer,paceAt,PROFILES} from '../../v2/js/pacer.js';

const M=1/111195,K=Math.cos(51*Math.PI/180);
const close=(a,b,e)=>assert.ok(Math.abs(a-b)<=e,`${a} vs ${b}`);
// Out 2.5 km north, back 2.5 km south (8 m apart), flat
const outBack=[];for(let d=0;d<=5000;d+=10){const n=d<=2500?d:5000-d,e=d<=2500?0:8;outBack.push({d,lat:51+n*M,lon:e*M/K,ele:0})}
// Steady weather all day: temp, dew, wind (m/s) from dir, rain
const steady=(temp,dew,wind,dir,rain=0,rad=0)=>{const time=[];for(let h=0;h<48;h++)time.push(Date.UTC(2026,9,4)+h*3600e3);
  const k=v=>time.map(()=>v);return {time,temp:k(temp),dew:k(dew),rh:k(60),wind:k(wind),dir:k(dir),rain:k(rain),rad:k(rad)}};
const START=Date.UTC(2026,9,4,9);

test('heat: temperature + dew point table, sun adds, cold costs a little',()=>{
  close(heatPct(10,5),0,1e-9);                 // 50 + 41 °F = 91 → 0 %
  close(heatPct(20,15),2.7,1e-9);              // 68 + 59 = 127 °F: 70 % of the way from 2 % to 3 %
  assert.ok(heatPct(28,22)>5);                 // hot and muggy
  assert.ok(heatPct(20,15,800)>heatPct(20,15,0));
  close(heatPct(0,-5),0.75,1e-9);
});

test('wind: a headwind costs more than the same tailwind gives back',()=>{
  const head=windFactor(3.33,3)-1,tail=1-windFactor(3.33,-3);
  assert.ok(head>0.04&&head<0.07,`${head}`);assert.ok(tail>0.01&&tail<head/2,`${tail}`);
  close(windFactor(3.33,0),1,1e-12);
});

test('at: interpolates between hours, wind direction through north',()=>{
  const w=steady(10,5,5,350);w.dir[1]=10;
  const c=at(w,w.time[0]+1800e3);close(c.dir,0,0.5);close(c.temp,10,1e-9);
});

test('bearings and wind stretches on an out-and-back',()=>{
  const b=bearings(outBack);close(b[50],0,1);close(b[400],180,1);
  const f=weatherFactors(outBack,outBack.map(p=>p.d/3.33),steady(12,6,6,0),START,{shelter:'open'}); // from the north
  const st=windStretches(outBack.map(p=>p.d),f.head);
  assert.deepEqual(st.map(s=>s.kind),['head','tail']);close(st[0].to,2500,30);
});

test('pacer with wind, keep target: same finish, slower into the wind, net cost reported',()=>{
  const prof=PROFILES[0],plain=buildPacer(outBack,1500,prof);
  const P=buildPacer(outBack,1500,prof,{cond:{w:steady(12,6,7,0),start:START,shelter:'open',mode:'keep'}});
  close(P.finish,1500,1e-6);
  assert.ok(paceAt(P,1200)>paceAt(plain,1200)&&paceAt(P,3800)<paceAt(plain,3800));
  assert.ok(P.wx.costPct>0.3,`${P.wx.costPct}`);  // headwind costs more than the tailwind gives
  close(P.wx.suggested,1500*(1+P.wx.costPct/100),0.01);
});

test('pacer in the heat, adjust mode: the finish moves by the cost; keep mode holds it',()=>{
  const prof=PROFILES[0],w=steady(26,20,0,0);
  const A=buildPacer(outBack,1500,prof,{cond:{w,start:START,shelter:'some',mode:'adjust'}});
  const Kp=buildPacer(outBack,1500,prof,{cond:{w,start:START,shelter:'some',mode:'keep'}});
  assert.ok(A.finish>1500*1.03,`${A.finish}`);close(A.finish,A.wx.suggested,0.5);close(Kp.finish,1500,1e-6);
  assert.ok(paceAt(Kp,4800)>paceAt(Kp,200),'heat builds: slower late than early at the same effort');
});

test('rain: wet descents give back less',()=>{
  const hill=[];for(let d=0;d<=3000;d+=10)hill.push({d,lat:51+d*M,lon:0,ele:d<1500?d*0.05:75-(d-1500)*0.05});
  const dry=buildPacer(hill,900,PROFILES[0],{cond:{w:steady(12,6,0,0),start:START,mode:'keep'}});
  const wet=buildPacer(hill,900,PROFILES[0],{cond:{w:steady(12,6,0,0,2),start:START,mode:'keep'}});
  assert.ok(paceAt(wet,2200)>paceAt(dry,2200));assert.ok(wet.wx.wet);
});

test('fetchWeather builds the request and parses the hours',async()=>{
  let url='';
  const w=await fetchWeather(53.87,-2.41,START,async u=>{url=u;return {ok:true,json:async()=>({hourly:{time:['2026-10-04T09:00','2026-10-04T10:00'],
    temperature_2m:[11,12],dew_point_2m:[7,7],relative_humidity_2m:[75,72],wind_speed_10m:[5,6],wind_direction_10m:[225,230],precipitation:[0,0],shortwave_radiation:[200,300]}})}});
  assert.match(url,/latitude=53\.8700&longitude=-2\.4100/);assert.match(url,/wind_speed_unit=ms/);
  assert.equal(w.time[0],START);assert.equal(compass16(225),'SW');
  await assert.rejects(fetchWeather(0,0,START,async()=>({ok:false,status:400})),/16 days/);
});

test('windStretches joins nearby stretches of the same kind',()=>{
  const d=[],h=[];for(let x=0;x<=3000;x+=10){d.push(x);h.push(x<1000?2:x<1100?0:x<2000?2:-2)}
  assert.deepEqual(windStretches(d,h).map(s=>[s.kind,s.from,s.to]),[['head',0,2000],['tail',2000,3000]]);
});
