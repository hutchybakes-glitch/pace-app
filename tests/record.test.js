import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FIX,I,summarise,worthKeeping} from '../js/record.js';

const fix=(t,band)=>{const f=new Array(FIX.length).fill(null);f[I.t]=t;f[I.band]=band;return f};

test('summarise: free run uses GPS distance, no band stat',()=>{
  const s=summarise({route:null,dist:5000,rd:0,elapsed:1500000,fixes:[fix(0),fix(1000)]});
  assert.equal(s.dist,5000);assert.equal(s.avg,300);assert.equal(s.inBand,null);
});

test('summarise: route run uses route distance; in-band share is time-weighted, long gaps skipped',()=>{
  const fixes=[fix(0,'green'),fix(30000,'red'),fix(40000,'green'),fix(50000,null),fix(60000,'green'),fix(160000,'red')];
  const s=summarise({route:{},dist:9000,rd:10000,elapsed:3000000,fixes});
  assert.equal(s.dist,10000);assert.equal(s.avg,300);
  assert.equal(s.inBand,40/50); // green 0–30 + 40–50 of 50 s banded; 60→160 gap skipped, null skipped
});

test('worthKeeping: needs 2 fixes and 50 m',()=>{
  assert.equal(worthKeeping({route:null,dist:40,fixes:[fix(0),fix(1)]}),false);
  assert.equal(worthKeeping({route:null,dist:60,fixes:[fix(0)]}),false);
  assert.equal(worthKeeping({route:{},rd:60,dist:0,fixes:[fix(0),fix(1)]}),true);
});
