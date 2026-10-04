import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {detectTurns,cueTurns,turnsFor,nextTurn,inDist,turnText} from '../js/nav.js';
import {parseGPX,resample} from '../js/route.js';

const M=1/111195,LAT=51,K=Math.cos(LAT*Math.PI/180);
// Route through metre waypoints [east,north], sampled every 10 m
function route(way){
  const pts=[];let d=0;
  for(let w=1;w<way.length;w++){
    const [x0,y0]=way[w-1],[x1,y1]=way[w],L=Math.hypot(x1-x0,y1-y0);
    for(let s=w===1?0:10;s<=L;s+=10)pts.push({d:d+s,lat:LAT+(y0+(y1-y0)*s/L)*M,lon:(x0+(x1-x0)*s/L)*M/K});
    d+=L;
  }
  return pts;
}
const ll=(e,n)=>({lat:LAT+n*M,lon:e*M/K});

test('detectTurns: right-angle turns, 45° bends, U-turn',()=>{
  const t=detectTurns(route([[0,0],[0,500],[-500,500],[-500,1000],[-400,1100],[-400,1600],[-390,1000]]));
  assert.deepEqual(t.map(x=>x.dir+' '+x.kind),['left turn','right turn','right slight','left slight','right uturn']);
  assert.ok(Math.abs(t[0].d-500)<=10&&Math.abs(t[1].d-1000)<=10);
});

test('cueTurns: in route order on an out-and-back, text kept, start/finish dropped',()=>{
  const pts=route([[0,0],[0,500],[300,500],[300,800],[310,800],[310,500],[10,500],[10,0]]);
  const cues=[{...ll(0,0),text:'Start on High St'},{...ll(5,500),text:'Turn right onto Mill Lane'},{...ll(305,800),text:'Turn around'},{...ll(5,500),text:'Turn left'},{...ll(10,0),text:'FINISH'}];
  const t=cueTurns(pts,cues);
  assert.deepEqual(t.map(x=>x.text),['Turn right onto Mill Lane','Turn around','Turn left']);
  assert.ok(t[0].d<600&&t[2].d>1500,'the junction is used on the way out and on the way back');
  assert.ok(t[0].angle>0&&t[2].angle<0);
});

test('real route: plotaroute cues placed in order near real bends',()=>{
  const xml=fs.readFileSync(new URL('./fixtures/ribble-valley-10k-2023.gpx',import.meta.url),'utf8'),g=parseGPX(xml);
  assert.equal(g.cues.length,12);
  const t=turnsFor({pts:resample(g.pts),cues:g.cues});
  assert.equal(t.length,10);
  for(let i=1;i<t.length;i++)assert.ok(t[i].d>t[i-1].d);
  assert.equal(t.at(-1).text,'Turn left onto New Lane');
  assert.ok(Math.abs(t.find(x=>/sharp/.test(x.text)&&x.d>5000).d-5760)<60);
});

test('nextTurn / inDist / turnText',()=>{
  const turns=[{d:500},{d:900}];
  assert.equal(nextTurn(turns,0).d,500);assert.equal(nextTurn(turns,497).d,900);assert.equal(nextTurn(turns,950),null);
  assert.equal(inDist(15),'now');assert.equal(inDist(87),'in 90 m');assert.equal(inDist(412),'in 400 m');assert.equal(inDist(1240),'in 1.2 km');
  assert.equal(turnText({kind:'sharp',dir:'left',text:''}),'Turn sharp left');assert.equal(turnText({kind:'uturn',dir:'right',text:''}),'Turn around');
});
