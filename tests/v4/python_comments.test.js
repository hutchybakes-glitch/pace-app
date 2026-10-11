import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

// House rule for the laptop code: every line of Python has a plain-English comment line directly above it
test('python: a comment line directly above every line of code',()=>{
  const dir=new URL('../../coach/',import.meta.url),bad=[];
  for(const f of readdirSync(dir).filter(f=>f.endsWith('.py'))){
    const L=readFileSync(new URL(f,dir),'utf8').split(/\r?\n/);
    L.forEach((l,i)=>{const t=l.trim();if(!t||t.startsWith('#'))return;if(!(L[i-1]??'').trim().startsWith('#'))bad.push(`${f}:${i+1}: ${t.slice(0,60)}`)});
  }
  assert.deepEqual(bad,[],bad.join('\n'));
});
