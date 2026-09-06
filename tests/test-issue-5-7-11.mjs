#!/usr/bin/env node
// Verification harness for issues #5, #7, #11 (tag resolution by name/ID/path).
//
// Run against a live OmniFocus. Bundle first (output must live in dist/ so that
// '@script.js' resolution finds dist/utils/omnifocusScripts/):
//   npm run build:fast
//   npx esbuild tests/test-issue-5-7-11.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-5-7-11.mjs
//   node dist/test-issue-5-7-11.mjs
//
// Everything it creates is prefixed `_oftest-x-` (tags) / `_of-mcp-test-5` (project)
// and is deleted at the end; the final step verifies nothing is left behind.
// Tag counts are taken over OUR tags only (by name) — flattenedTags.length drifts
// while OmniFocus syncs, so an absolute count is not a stable assertion.

import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { executeOmniFocusScript } from '../src/utils/scriptExecution.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { addProject } from '../src/tools/primitives/addProject.js';
import { batchAddItems } from '../src/tools/primitives/batchAddItems.js';
import { editItem } from '../src/tools/primitives/editItem.js';
import { batchEditItems } from '../src/tools/primitives/batchEditItems.js';
import { getTasksByTag } from '../src/tools/primitives/getTasksByTag.js';
import { batchRemoveItems } from '../src/tools/primitives/batchRemoveItems.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';

const PREFIX = '_oftest-x-';
const PROJECT_NAME = '_of-mcp-test-5';

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`   ${passed ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
}

// Run an ad-hoc OmniJS snippet. executeOmniFocusScript reads a file, so write the
// source to a temp path; the injected `injectedArgs` is available inside the IIFE.
let scratchCounter = 0;
async function runOmniJS(source, args) {
  const path = join(tmpdir(), `oftest-5-7-11-${Date.now()}-${scratchCounter++}.js`);
  writeFileSync(path, source);
  try {
    const result = await executeOmniFocusScript(path, args);
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    if (parsed && parsed.error) throw new Error(`OmniJS error: ${parsed.error}`);
    return parsed;
  } finally {
    try { unlinkSync(path); } catch (_) { /* ignore */ }
  }
}

const SETUP_SCRIPT = `(() => {
  const P = injectedArgs.prefix;
  // Top-level "Dup", then dropped (issue #5 trigger)
  const dropped = new Tag(P + 'Dup');
  dropped.status = Tag.Status.Dropped;
  // Only-dropped name, no active sibling (issue #5 create-new path)
  const solo = new Tag(P + 'Solo');
  solo.status = Tag.Status.Dropped;
  // Two ACTIVE nested tags that share the name "Dup" (issues #7, #11)
  const a = new Tag(P + 'A');
  const aDup = new Tag(P + 'Dup', a.ending);
  const b = new Tag(P + 'B');
  const bDup = new Tag(P + 'Dup', b.ending);
  return JSON.stringify({
    droppedId: dropped.id.primaryKey,
    soloId: solo.id.primaryKey,
    aId: a.id.primaryKey,
    aDupId: aDup.id.primaryKey,
    bId: b.id.primaryKey,
    bDupId: bDup.id.primaryKey
  });
})()`;

// Snapshot: tags on the given items + the list of OUR tags (prefix or garbage names)
const INSPECT_SCRIPT = `(() => {
  const P = injectedArgs.prefix;
  const extraNames = new Set(injectedArgs.extraNames || []);
  const ours = flattenedTags.filter(t => t.name.startsWith(P) || extraNames.has(t.name));
  const out = { ourTags: ours.map(t => t.name + (t.active ? '' : '(dropped)')), items: {} };
  for (const id of injectedArgs.taskIds || []) {
    const t = Task.byIdentifier(id);
    out.items[id] = t ? t.tags.map(tag => ({ id: tag.id.primaryKey, name: tag.name, active: tag.active })) : null;
  }
  for (const id of injectedArgs.projectIds || []) {
    const p = Project.byIdentifier(id);
    out.items[id] = p ? p.tags.map(tag => ({ id: tag.id.primaryKey, name: tag.name, active: tag.active })) : null;
  }
  return JSON.stringify(out);
})()`;

// Force exact tags on tasks by ID so #11 can be tested independently of #5/#7
const SET_TAGS_SCRIPT = `(() => {
  for (const [taskId, tagIds] of Object.entries(injectedArgs.assignments)) {
    const t = Task.byIdentifier(taskId);
    t.clearTags();
    for (const tagId of tagIds) t.addTag(Tag.byIdentifier(tagId));
  }
  return JSON.stringify({ ok: true });
})()`;

const CLEANUP_SCRIPT = `(() => {
  const P = injectedArgs.prefix;
  const extraNames = new Set(injectedArgs.extraNames || []);
  const isOurs = tag => tag.name.startsWith(P) || extraNames.has(tag.name);
  const depth = tag => { let d = 0; let c = tag.parent; while (c) { d++; c = c.parent; } return d; };
  // Delete deepest first so a parent delete never races a child delete
  const victims = flattenedTags.filter(isOurs).sort((x, y) => depth(y) - depth(x));
  const deleted = victims.map(t => t.name);
  victims.forEach(t => deleteObject(t));
  const remaining = flattenedTags.filter(isOurs).map(t => t.name);
  const remainingProjects = flattenedProjects.filter(p => p.name === injectedArgs.projectName).length;
  const remainingTasks = flattenedTasks.filter(t => t.name.startsWith(P)).length;
  return JSON.stringify({ deleted, remaining, remainingProjects, remainingTasks });
})()`;

async function main() {
  console.log('='.repeat(64));
  console.log('ISSUES #5 / #7 / #11 - TAG RESOLUTION HARNESS');
  console.log('='.repeat(64));

  const created = { taskIds: [], projectId: null };
  // Strings the UNFIXED code turns into literal tag names; inspected and cleaned up too.
  const garbageNames = [];
  const inspect = (ids) => runOmniJS(INSPECT_SCRIPT, { prefix: PREFIX, extraNames: garbageNames, ...ids });
  const tagsOf = (snap, id) => (snap.items[id] || []).map(t => `${t.name}${t.active ? '' : '(dropped)'}`).join(',') || 'no tags';

  try {
    console.log('\n0. Fixture setup');
    const pre = await inspect({});
    if (pre.ourTags.length > 0) throw new Error(`Stale test tags present, clean up first: ${pre.ourTags.join(', ')}`);
    const fixture = await runOmniJS(SETUP_SCRIPT, { prefix: PREFIX });
    const dupName = `${PREFIX}Dup`;
    const aPath = `${PREFIX}A > ${PREFIX}Dup`;
    const bPath = `${PREFIX}B > ${PREFIX}Dup`;
    const bogusPath = `${PREFIX}A > ${PREFIX}Nope`;
    garbageNames.push(fixture.aDupId, fixture.bDupId, aPath, bPath, bogusPath);
    let snap = await inspect({});
    const FIXTURE_TAGS = 6;
    console.log(`   dropped Dup=${fixture.droppedId}  A>Dup=${fixture.aDupId}  B>Dup=${fixture.bDupId}`);
    console.log(`   our tags: ${snap.ourTags.join(', ')}`);
    check('fixture created 6 tags', snap.ourTags.length === FIXTURE_TAGS, `${snap.ourTags.length}`);

    // ---- add_project with a tag ID (#7 on add paths) ----
    console.log(`\n1. add_project "${PROJECT_NAME}" with tags: ["${fixture.aDupId}"] (ID of A>Dup)`);
    const proj = await addProject({ name: PROJECT_NAME, tags: [fixture.aDupId] });
    if (!proj.success) throw new Error(`addProject failed: ${proj.error}`);
    created.projectId = proj.projectId;
    snap = await inspect({ projectIds: [proj.projectId] });
    check('(#7) project got A>Dup via tag ID', (snap.items[proj.projectId] || []).some(t => t.id === fixture.aDupId), tagsOf(snap, proj.projectId));
    check('(#7) add_project created no garbage tag', snap.ourTags.length === FIXTURE_TAGS, snap.ourTags.join(', '));

    // ---- (a) add task with tags: ["<name>"] must NOT pick the dropped tag (#5) ----
    console.log(`\n2. add_omnifocus_task with tags: ["${dupName}"] (dropped + 2 active share this name)`);
    const t1 = await addOmniFocusTask({ name: `${PREFIX}task1`, projectId: proj.projectId, tags: [dupName] });
    if (!t1.success) throw new Error(`addOmniFocusTask failed: ${t1.error}`);
    created.taskIds.push(t1.taskId);
    if (t1.warnings) console.log(`   warnings: ${t1.warnings.join(' | ')}`);
    snap = await inspect({ taskIds: [t1.taskId] });
    let t1Tags = snap.items[t1.taskId] || [];
    check('(#5) task1 did NOT get the dropped tag', !t1Tags.some(t => t.id === fixture.droppedId), tagsOf(snap, t1.taskId));
    check('(#5) task1 got an active tag named Dup', t1Tags.some(t => t.active && t.name === dupName));
    check('(#5) no new tag created (active matches existed)', snap.ourTags.length === FIXTURE_TAGS, snap.ourTags.join(', '));
    check('(#5) ambiguity warning returned for the duplicate name', Array.isArray(t1.warnings) && t1.warnings.some(w => /ambiguous/i.test(w)), JSON.stringify(t1.warnings));

    // ---- (a2) only a dropped tag matches -> create a new active one (#5) ----
    console.log(`\n3. add_omnifocus_task with tags: ["${PREFIX}Solo"] (only a dropped tag has this name)`);
    const t3 = await addOmniFocusTask({ name: `${PREFIX}task3`, projectId: proj.projectId, tags: [`${PREFIX}Solo`] });
    if (!t3.success) throw new Error(`addOmniFocusTask failed: ${t3.error}`);
    created.taskIds.push(t3.taskId);
    if (t3.warnings) console.log(`   warnings: ${t3.warnings.join(' | ')}`);
    snap = await inspect({ taskIds: [t3.taskId] });
    const t3Tags = snap.items[t3.taskId] || [];
    check('(#5) task3 did NOT get the dropped Solo tag', !t3Tags.some(t => t.id === fixture.soloId), tagsOf(snap, t3.taskId));
    check('(#5) task3 got a NEW active Solo tag', t3Tags.some(t => t.active && t.name === `${PREFIX}Solo`) && snap.ourTags.length === FIXTURE_TAGS + 1, snap.ourTags.join(', '));
    const EXPECTED_TAGS = FIXTURE_TAGS + 1;

    // ---- (b) edit_item replaceTags by ID (#7) ----
    console.log(`\n4. edit_item replaceTags: ["${fixture.aDupId}"] (tag ID of A>Dup)`);
    let e = await editItem({ id: t1.taskId, itemType: 'task', replaceTags: [fixture.aDupId] });
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('(#7) edit_item succeeded', e.success === true, e.error);
    check('(#7) task1 now has A>Dup (by ID)', t1Tags.some(t => t.id === fixture.aDupId), tagsOf(snap, t1.taskId));
    check('(#7) no garbage tag named after the ID', snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    // ---- (b) batch_edit_items addTags by path, then removeTags by path (#7) ----
    console.log(`\n5. batch_edit_items addTags: ["${bPath}"] then removeTags by the same path`);
    let be = await batchEditItems([{ id: t1.taskId, itemType: 'task', addTags: [bPath] }]);
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('(#7) batch addTags by path succeeded', be.results[0] && be.results[0].success === true, be.results[0] && be.results[0].error);
    check('(#7) task1 now has B>Dup (by path)', t1Tags.some(t => t.id === fixture.bDupId), tagsOf(snap, t1.taskId));
    check('(#7) no garbage tag named after the path', snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    be = await batchEditItems([{ id: t1.taskId, itemType: 'task', removeTags: [bPath] }]);
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('(#7) removeTags by path removed B>Dup only', !t1Tags.some(t => t.id === fixture.bDupId) && t1Tags.some(t => t.id === fixture.aDupId), tagsOf(snap, t1.taskId));

    // ---- (b) unresolvable path must error, not create a tag (#7) ----
    console.log(`\n6. edit_item addTags: ["${bogusPath}"] (path does not exist)`);
    e = await editItem({ id: t1.taskId, itemType: 'task', addTags: [bogusPath] });
    snap = await inspect({ taskIds: [t1.taskId] });
    check('(#7) unresolvable path returns an error', e.success === false, e.error || 'reported success');
    check('(#7) unresolvable path created no tag', snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    // ---- batch_add_items with tags by path (#7 on add paths) ----
    console.log(`\n7. batch_add_items task with tags: ["${bPath}"]`);
    const ba = await batchAddItems([{ type: 'task', name: `${PREFIX}task2`, projectId: proj.projectId, tags: [bPath] }]);
    const t2 = ba.results[0];
    if (!t2 || !t2.success) throw new Error(`batchAddItems failed: ${t2 && t2.error}`);
    created.taskIds.push(t2.id);
    snap = await inspect({ taskIds: [t2.id] });
    check('(#7) task2 got B>Dup via path in batch_add_items', (snap.items[t2.id] || []).some(t => t.id === fixture.bDupId), tagsOf(snap, t2.id));
    check('(#7) batch_add_items created no garbage tag', snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    // ---- (c) get_tasks_by_tag by ambiguous name returns tasks from BOTH tags (#11) ----
    // Pin the tags by ID first so this check does not depend on #5/#7 having passed.
    await runOmniJS(SET_TAGS_SCRIPT, { assignments: { [t1.taskId]: [fixture.aDupId], [t2.id]: [fixture.bDupId] } });
    console.log(`\n8. get_tasks_by_tag tagName "${dupName}" exactMatch (task1 on A>Dup, task2 on B>Dup)`);
    const out = await getTasksByTag({ tagName: dupName, exactMatch: true, hideCompleted: true });
    console.log('   --- output ---');
    console.log(out.split('\n').map(l => '   | ' + l).join('\n'));
    check('(#11) result includes task1 (A>Dup)', out.includes(t1.taskId));
    check('(#11) result includes task2 (B>Dup)', out.includes(t2.id));
    check('(#11) output lists both full tag paths', out.includes(aPath) && out.includes(bPath));
    check('(#11) output flags the name as ambiguous', /ambiguous/i.test(out));

    console.log(`\n8b. get_tasks_by_tag tagName "${bPath}" (path targets one tag)`);
    const outPath = await getTasksByTag({ tagName: bPath, exactMatch: true, hideCompleted: true });
    check('(#11) path search returns only task2', outPath.includes(t2.id) && !outPath.includes(t1.taskId));
  } catch (err) {
    console.log(`\n   HARNESS ERROR: ${err.message}`);
    results.push({ name: 'harness ran to completion', passed: false, detail: err.message });
  } finally {
    console.log('\n9. Cleanup');
    try {
      if (created.taskIds.length > 0) {
        const r = await batchRemoveItems(created.taskIds.map(id => ({ id, itemType: 'task' })));
        console.log(`   removed tasks: ${r.successCount}/${created.taskIds.length}`);
      }
      if (created.projectId) {
        const r = await removeItem({ id: created.projectId, itemType: 'project' });
        console.log(`   removed project: ${r.success ? 'yes' : r.error}`);
      }
      const c = await runOmniJS(CLEANUP_SCRIPT, { prefix: PREFIX, extraNames: garbageNames, projectName: PROJECT_NAME });
      console.log(`   deleted tags: ${c.deleted.join(', ') || '(none)'}`);
      const clean = c.remaining.length === 0 && c.remainingProjects === 0 && c.remainingTasks === 0;
      check('cleanup: no test tags, tasks, or project remain', clean, `tags=${JSON.stringify(c.remaining)} projects=${c.remainingProjects} tasks=${c.remainingTasks}`);
    } catch (err) {
      check('cleanup ran', false, err.message);
    }
  }

  console.log('\n' + '='.repeat(64));
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  results.forEach(r => console.log(`${r.passed ? '  PASS' : '  FAIL'} ${r.name}${!r.passed && r.detail ? ` -- ${r.detail}` : ''}`));
  console.log('-'.repeat(64));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
