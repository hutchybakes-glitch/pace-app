import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';

// Every v4 module parses (the browser-only ones are only loaded, never run)
test('modules: every v4 script loads',async()=>{
  for(const f of readdirSync(new URL('../../v4/js/',import.meta.url)).filter(f=>f.endsWith('.js')&&f!=='app.js'))
    await assert.doesNotReject(import(`../../v4/js/${f}`),f);
});
// app.js needs a browser to run, but it must at least parse as a module
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('modules: app.js parses',()=>{
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',fileURLToPath(new URL('../../v4/js/app.js',import.meta.url))],{stdio:'pipe'}));
});
