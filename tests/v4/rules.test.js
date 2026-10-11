import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ruleEdits,TYPES} from '../../v4/js/plandoc.js';

// The same expectations coach/eval.py scores the AI against
const E=JSON.parse(readFileSync(new URL('../../coach/eval_cases.json',import.meta.url)));
const easing=(e,w)=>e.op==='reduce_volume_pct'||(e.op==='shift_pace_zone'&&e.direction==='easier')||(e.op==='swap_session'&&['rest','recovery','easy'].includes(e.new_type)&&w.find(s=>s.id===e.session_id)?.type!=='rest');
const harder=e=>(e.op==='shift_pace_zone'&&e.direction==='harder')||(e.op==='swap_session'&&['sub','hills','long'].includes(e.new_type));
export function meets(expect,edits,w){
  const ez=edits.filter(e=>easing(e,w)),hd=edits.filter(harder);
  switch(expect){
    case 'none':return edits.length===0;
    case 'ease':return ez.length>0&&!hd.length;
    case 'ease_next_hard':return !hd.length&&ez.some(e=>e.op==='reduce_volume_pct'||['3-1','3-3'].includes(e.session_id));
    case 'rest_soon':return !hd.length&&edits.some(e=>e.op==='swap_session'&&['rest','recovery'].includes(e.new_type)&&['2-6','3-1'].includes(e.session_id));
    case 'harder':return hd.length>0&&!ez.length;
    case 'not_easier':return ez.length===0;
    case 'cut_week':return !hd.length&&ez.length>0;
    case 'touch_3_1':return edits.some(e=>e.session_id==='3-1'&&!harder(e));
  }
  throw new Error('unknown expectation '+expect);
}
test('rules coach: the fallback meets every post-run eval scenario',()=>{
  const miss=E.plan.filter(c=>!meets(c.expect,ruleEdits(c.feedback,E.window).edits,E.window)).map(c=>`${c.name}: ${JSON.stringify(ruleEdits(c.feedback,E.window).edits)}`);
  assert.deepEqual(miss,[]);
  assert.ok(E.window.every(s=>TYPES[s.type]));
});
