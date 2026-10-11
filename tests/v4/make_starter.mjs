// Writes the 10K starter plan (v4/plans/10k-starter.json, a template without dates), the plan
// document's JSON Schema (v4/plans/plan.schema.json) and the schema the coach's plan changes must fit
// (v4/plans/edits.schema.json, which the laptop reads). Run: node tests/v4/make_starter.mjs
import {writeFileSync} from 'node:fs';
import {starter} from './starter.mjs';
import {PLAN_SCHEMA,EDITS_SCHEMA} from '../../v4/js/plandoc.js';
const out=(f,x)=>writeFileSync(new URL('../../v4/plans/'+f,import.meta.url),JSON.stringify(x,null,1)+'\n');
out('10k-starter.json',starter());out('plan.schema.json',PLAN_SCHEMA);out('edits.schema.json',EDITS_SCHEMA);
console.log('wrote the starter plan and the schemas');
