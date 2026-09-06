#!/usr/bin/env node
// Verification harness for issue #12: list_tags must render the tag tree to any depth
// and the number of rendered entries must equal the reported count.
//
// Creates `_oftest-12-a` > `_oftest-12-b` > `_oftest-12-c` (depth 3) via OmniJS,
// runs the listTags primitive, asserts the depth-3 tag is rendered and that
// rendered entries == count, then deletes the test tags and verifies they are gone.
//
// Run (from the worktree root, after `npm run build:fast`):
//   npx esbuild tests/test-issue-12.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-12.mjs \
//   && node dist/test-issue-12.mjs

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listTags } from '../src/tools/primitives/listTags.js';
import { executeOmniFocusScript } from '../src/utils/scriptExecution.js';

const PREFIX = '_oftest-12-';

// executeOmniFocusScript accepts an absolute path, so raw OmniJS snippets are
// written to temp files and run through the same wrapper the primitives use.
async function runOmniJS(name, source) {
  const file = join(tmpdir(), `oftest12_${name}_${Date.now()}.js`);
  writeFileSync(file, source);
  try {
    const result = await executeOmniFocusScript(file);
    return typeof result === 'string' ? JSON.parse(result) : result;
  } finally {
    unlinkSync(file);
  }
}

const SETUP = `(() => {
  try {
    const existing = flattenedTags.filter(t => t.name.startsWith('${PREFIX}'));
    if (existing.length > 0) {
      return JSON.stringify({ success: false, error: 'stale ${PREFIX}* tags present: ' + existing.map(t => t.name).join(', ') });
    }
    const a = new Tag('${PREFIX}a');
    const b = new Tag('${PREFIX}b', a);
    const c = new Tag('${PREFIX}c', b);
    return JSON.stringify({
      success: true,
      ids: { a: a.id.primaryKey, b: b.id.primaryKey, c: c.id.primaryKey },
      parents: { b: b.parent ? b.parent.name : null, c: c.parent ? c.parent.name : null }
    });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})();`;

const TEARDOWN = `(() => {
  try {
    const targets = flattenedTags.filter(t => t.name.startsWith('${PREFIX}'));
    // Deleting a parent cascades to its children, and a cascaded-away Tag throws on
    // any later access. Sort by real depth (deepest first) so each delete hits a leaf.
    const depthOf = t => { let d = 0; for (let p = t.parent; p; p = p.parent) d++; return d; };
    targets.sort((x, y) => depthOf(y) - depthOf(x));
    const deleted = [];
    for (const t of targets) {
      const name = t.name; // unreadable after deleteObject
      deleteObject(t);
      deleted.push(name);
    }
    const remaining = flattenedTags.filter(t => t.name.startsWith('${PREFIX}')).map(t => t.name);
    return JSON.stringify({ success: true, deleted, remaining });
  } catch (e) {
    return JSON.stringify({ success: false, error: String(e) });
  }
})();`;

function countRenderedEntries(output) {
  return output.split('\n').filter(line => /^\s*(•|└─)\s/.test(line)).length;
}

function reportedCount(output) {
  const m = output.match(/^Found (\d+) tags?/m);
  return m ? Number(m[1]) : NaN;
}

async function main() {
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  PASS' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  console.log('='.repeat(60));
  console.log('ISSUE #12: list_tags depth + count agreement');
  console.log('='.repeat(60));

  // try starts before setup so a throw mid-setup still reaches the teardown,
  // which deletes whatever `_oftest-12-*` tags exist regardless of how far setup got.
  try {
    console.log('\n1. Creating test tags (depth 3)...');
    const setup = await runOmniJS('setup', SETUP);
    if (!setup.success) {
      throw new Error(`Setup failed: ${setup.error}`);
    }
    console.log(`   ids: ${JSON.stringify(setup.ids)}  parents: ${JSON.stringify(setup.parents)}`);
    check('depth-3 chain created', setup.parents.b === `${PREFIX}a` && setup.parents.c === `${PREFIX}b`);

    console.log('\n2. Running listTags primitive...');
    const output = await listTags({ includeDropped: false, showTaskCounts: false });
    const rendered = countRenderedEntries(output);
    const reported = reportedCount(output);
    console.log(`   reported=${reported} rendered=${rendered}`);

    const testLines = output.split('\n').filter(l => l.includes(PREFIX));
    console.log('   test-tag lines:');
    for (const l of testLines) console.log(`     ${JSON.stringify(l)}`);

    check('depth-1 tag rendered', output.includes(`[ID: ${setup.ids.a}]`));
    check('depth-2 tag rendered', output.includes(`[ID: ${setup.ids.b}]`));
    check('depth-3 tag rendered', output.includes(`[ID: ${setup.ids.c}]`));
    check('rendered entries == reported count', rendered === reported, `${rendered} vs ${reported}`);

    const lineC = testLines.find(l => l.includes(`[ID: ${setup.ids.c}]`)) || '';
    const lineB = testLines.find(l => l.includes(`[ID: ${setup.ids.b}]`)) || '';
    const indent = l => (l.match(/^\s*/) || [''])[0].length;
    check('depth-3 indented deeper than depth-2', lineC !== '' && indent(lineC) > indent(lineB), `${indent(lineB)} -> ${indent(lineC)}`);
  } finally {
    console.log('\n3. Cleaning up test tags...');
    const teardown = await runOmniJS('teardown', TEARDOWN);
    if (!teardown.success) {
      console.error(`   Teardown failed: ${teardown.error}`);
    } else {
      console.log(`   deleted: ${teardown.deleted.join(', ')}`);
    }
    check('test tags removed', teardown.success && teardown.remaining.length === 0,
      teardown.remaining && teardown.remaining.length ? `remaining: ${teardown.remaining.join(', ')}` : '');
  }

  const failed = results.filter(r => !r.ok).length;
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${results.length - failed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Harness failed:', err);
  process.exit(1);
});
