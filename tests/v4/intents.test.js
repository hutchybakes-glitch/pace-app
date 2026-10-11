import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {matchIntent,INTENTS} from '../../v4/js/intents.js';

const cases=JSON.parse(readFileSync(new URL('../../coach/eval_cases.json',import.meta.url))).intent;

test('intents: the phone\'s keyword fallback gets every in-run eval scenario right',()=>{
  const wrong=cases.filter(c=>matchIntent(c.text).intent!==c.expect).map(c=>`${c.text} -> ${matchIntent(c.text).intent} (want ${c.expect})`);
  assert.deepEqual(wrong,[]);
  assert.ok(cases.every(c=>INTENTS.includes(c.expect)));
});
test('intents: safety first, and a few more phrasings',()=>{
  for(const [t,w] of [['my knee hurts, slow down','pain'],['how am I doing, I feel strong','status'],['slow down please','slower'],['speed up','faster'],['ok','none'],['I could go quicker','faster'],['ease off a bit','slower'],['my hamstring feels tight and sharp','pain']])
    assert.equal(matchIntent(t).intent,w,t);
});
