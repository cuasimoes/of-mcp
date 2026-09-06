#!/usr/bin/env node
// Verification harness for issue #13: list_custom_perspectives format 'rules'.
// Read-only against the live OmniFocus database — creates nothing.
//
// Run twice: first against the pre-change build (captures simple/detailed
// baselines under dist/), then against the fixed build (diffs the baselines
// and checks the rules format).
//
// Bundle + run:
//   npx esbuild tests/test-issue-13.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-13.mjs \
//   && node dist/test-issue-13.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listCustomPerspectives } from '../src/tools/primitives/listCustomPerspectives.js';
import { executeOmniFocusScript } from '../src/utils/scriptExecution.js';

const distDir = dirname(fileURLToPath(import.meta.url));
const baselinePath = (fmt) => join(distDir, `test-issue-13-baseline-${fmt}.txt`);

let failures = 0;
function check(cond, msg) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} - ${msg}`);
  if (!cond) failures++;
}

console.log('='.repeat(60));
console.log('ISSUE #13 — list_custom_perspectives rules format');
console.log('='.repeat(60));

// 1. simple / detailed must be byte-identical to the pre-change baseline
for (const fmt of ['simple', 'detailed']) {
  const out = await listCustomPerspectives({ format: fmt });
  const path = baselinePath(fmt);
  if (!existsSync(path)) {
    writeFileSync(path, out);
    console.log(`  captured baseline for '${fmt}' -> ${path}`);
  } else {
    const baseline = readFileSync(path, 'utf8');
    check(baseline === out, `'${fmt}' output is byte-identical to baseline`);
  }
}

// 2. raw script output: every perspective carries rules[] or rulesError
const scriptResult = await executeOmniFocusScript('@listCustomPerspectives.js', {});
const raw = typeof scriptResult === 'string' ? JSON.parse(scriptResult) : scriptResult;
check(raw.success === true, `script succeeded (count=${raw.count})`);
const allHaveState = raw.perspectives.every(
  (p) => Array.isArray(p.archivedFilterRules) || typeof p.rulesError === 'string'
);
check(allHaveState, 'every perspective has archivedFilterRules[] or rulesError');
const withRules = raw.perspectives.filter((p) => Array.isArray(p.archivedFilterRules) && p.archivedFilterRules.length > 0).length;
const noRules = raw.perspectives.filter((p) => Array.isArray(p.archivedFilterRules) && p.archivedFilterRules.length === 0).length;
const errored = raw.perspectives.filter((p) => typeof p.rulesError === 'string').length;
console.log(`  states: ${withRules} with rules, ${noRules} with no rules, ${errored} unreadable`);

// 3. rendered rules format
const rendered = await listCustomPerspectives({ format: 'rules' });
check(!rendered.startsWith('❌'), "'rules' format renders without error");
check(rendered.includes('Aggregation:'), "'rules' output shows aggregation");

console.log('\n--- rendered output, first 3 perspectives ---');
const sections = rendered.split('\n\n');
console.log(sections.slice(0, 4).join('\n\n'));
console.log('--- end ---\n');

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
