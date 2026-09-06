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
  // Dropped PARENT with an active child: child.active stays true, only
  // effectiveActive reflects the parent's status (issue #5 canonical repro)
  const parent = new Tag(P + 'P');
  const kid = new Tag(P + 'Kid', parent.ending);
  parent.status = Tag.Status.Dropped;
  return JSON.stringify({
    droppedId: dropped.id.primaryKey,
    soloId: solo.id.primaryKey,
    aId: a.id.primaryKey,
    aDupId: aDup.id.primaryKey,
    bId: b.id.primaryKey,
    bDupId: bDup.id.primaryKey,
    parentId: parent.id.primaryKey,
    kidId: kid.id.primaryKey,
    kidActive: kid.active,
    kidEffectiveActive: kid.effectiveActive
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
    // 11 chars, no digit/_/-/inner uppercase: must be treated as a NAME, not an ID
    const ELEVEN_CHAR_NAME = 'Oftestphoto';
    garbageNames.push(fixture.aDupId, fixture.bDupId, aPath, bPath, bogusPath, ELEVEN_CHAR_NAME);
    let snap = await inspect({});
    const FIXTURE_TAGS = 8;
    console.log(`   dropped Dup=${fixture.droppedId}  A>Dup=${fixture.aDupId}  B>Dup=${fixture.bDupId}`);
    console.log(`   dropped parent P=${fixture.parentId}  P>Kid=${fixture.kidId} (active=${fixture.kidActive}, effectiveActive=${fixture.kidEffectiveActive})`);
    console.log(`   our tags: ${snap.ourTags.join(', ')}`);
    check('fixture created 8 tags', snap.ourTags.length === FIXTURE_TAGS, `${snap.ourTags.length}`);
    check('fixture: child of dropped parent has active=true but effectiveActive=false', fixture.kidActive === true && fixture.kidEffectiveActive === false);

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
    check('(#5) creation warning returned for Solo', Array.isArray(t3.warnings) && t3.warnings.some(w => /created/i.test(w)), JSON.stringify(t3.warnings));

    // ---- (a3) dropped PARENT, active child: child.active is true but it must not be used (#5) ----
    console.log(`\n3b. add_omnifocus_task with tags: ["${PREFIX}Kid"] (only match is under a DROPPED parent)`);
    const t4 = await addOmniFocusTask({ name: `${PREFIX}task4`, projectId: proj.projectId, tags: [`${PREFIX}Kid`] });
    if (!t4.success) throw new Error(`addOmniFocusTask failed: ${t4.error}`);
    created.taskIds.push(t4.taskId);
    if (t4.warnings) console.log(`   warnings: ${t4.warnings.join(' | ')}`);
    snap = await inspect({ taskIds: [t4.taskId] });
    const t4Tags = snap.items[t4.taskId] || [];
    check('(#5) task4 did NOT get the child of the dropped parent', !t4Tags.some(t => t.id === fixture.kidId), tagsOf(snap, t4.taskId));
    check('(#5) task4 got a NEW Kid tag (count +1) with a creation warning', t4Tags.some(t => t.name === `${PREFIX}Kid` && t.id !== fixture.kidId) && snap.ourTags.length === FIXTURE_TAGS + 2 && Array.isArray(t4.warnings) && t4.warnings.some(w => /created/i.test(w)), `${snap.ourTags.join(', ')} warnings=${JSON.stringify(t4.warnings)}`);

    // ---- 11-char plain name must be created, not rejected as an ID (#7 heuristic) ----
    console.log(`\n3c. add_omnifocus_task with tags: ["${ELEVEN_CHAR_NAME}"] (11 chars, looks like a word not an ID)`);
    const t5 = await addOmniFocusTask({ name: `${PREFIX}task5`, projectId: proj.projectId, tags: [ELEVEN_CHAR_NAME] });
    check('(#7) 11-char plain name is accepted', t5.success === true, t5.error);
    if (t5.success) created.taskIds.push(t5.taskId);
    snap = await inspect({ taskIds: t5.success ? [t5.taskId] : [] });
    check('(#7) 11-char plain name was created and attached', t5.success && (snap.items[t5.taskId] || []).some(t => t.name === ELEVEN_CHAR_NAME) && snap.ourTags.length === FIXTURE_TAGS + 3, snap.ourTags.join(', '));
    const EXPECTED_TAGS = FIXTURE_TAGS + 3;

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

    // ---- replaceTags + addTags together: addTags is ignored by the apply step, so it must not create a stray tag ----
    console.log(`\n6b. edit_item replaceTags: ["${fixture.aDupId}"] + addTags: ["${PREFIX}Stray"] together`);
    e = await editItem({ id: t1.taskId, itemType: 'task', replaceTags: [fixture.aDupId], addTags: [`${PREFIX}Stray`] });
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('replaceTags+addTags succeeded and left only A>Dup', e.success === true && t1Tags.length === 1 && t1Tags[0].id === fixture.aDupId, `${e.error || ''} ${tagsOf(snap, t1.taskId)}`);
    check('replaceTags+addTags created no stray tag', !snap.ourTags.includes(`${PREFIX}Stray`) && snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    // ---- empty reference must be an error, not "replace everything with nothing" ----
    console.log(`\n6c. edit_item replaceTags: [""]`);
    e = await editItem({ id: t1.taskId, itemType: 'task', replaceTags: [''] });
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('empty tag reference returns an error and leaves tags untouched', e.success === false && t1Tags.some(t => t.id === fixture.aDupId), `${e.error || 'reported success'} ${tagsOf(snap, t1.taskId)}`);

    // ---- removeTags by name must reach a DROPPED tag that is on the item (#5 cleanup path) ----
    console.log(`\n6d. pin dropped Dup on task1, then edit_item removeTags: ["${dupName}"]`);
    await runOmniJS(SET_TAGS_SCRIPT, { assignments: { [t1.taskId]: [fixture.aDupId, fixture.droppedId] } });
    e = await editItem({ id: t1.taskId, itemType: 'task', removeTags: [dupName] });
    snap = await inspect({ taskIds: [t1.taskId] });
    t1Tags = snap.items[t1.taskId] || [];
    check('removeTags by name removed the dropped tag from the item', e.success === true && !t1Tags.some(t => t.id === fixture.droppedId), `${e.error || ''} ${tagsOf(snap, t1.taskId)}`);
    check('removeTags reports tags (removed)', e.success === true && /tags \(removed\)/.test(e.changedProperties || ''), e.changedProperties);

    // ---- removeTags of something not on the item: warning, no "tags (removed)" ----
    console.log(`\n6e. edit_item removeTags: ["${PREFIX}Solo"] (not on task1)`);
    e = await editItem({ id: t1.taskId, itemType: 'task', removeTags: [`${PREFIX}Solo`] });
    check('removeTags miss: success with warning, no tags (removed)', e.success === true && !/tags \(removed\)/.test(e.changedProperties || '') && Array.isArray(e.warnings) && e.warnings.length > 0, `changed=${e.changedProperties} warnings=${JSON.stringify(e.warnings)}`);

    // ---- batch_add_items with tags by path (#7 on add paths) ----
    console.log(`\n7. batch_add_items task with tags: ["${bPath}"]`);
    const ba = await batchAddItems([{ type: 'task', name: `${PREFIX}task2`, projectId: proj.projectId, tags: [bPath] }]);
    const t2 = ba.results[0];
    if (!t2 || !t2.success) throw new Error(`batchAddItems failed: ${t2 && t2.error}`);
    created.taskIds.push(t2.id);
    snap = await inspect({ taskIds: [t2.id] });
    check('(#7) task2 got B>Dup via path in batch_add_items', (snap.items[t2.id] || []).some(t => t.id === fixture.bDupId), tagsOf(snap, t2.id));
    check('(#7) batch_add_items created no garbage tag', snap.ourTags.length === EXPECTED_TAGS, snap.ourTags.join(', '));

    console.log(`\n7b. batch_add_items project with tags: ["zzzzzzzzz_9"] (ID-shaped, does not exist)`);
    const baBad = await batchAddItems([{ type: 'project', name: `${PREFIX}badproj`, tags: ['zzzzzzzzz_9'] }]);
    const badRes = baBad.results[0] || {};
    check('(#7) ID-shaped miss fails the item and the failure carries type', badRes.success === false && badRes.type === 'project', JSON.stringify(badRes));

    console.log(`\n7c. get_tasks_by_tag tagId of the DROPPED Dup (pinned on task3), includeDropped not set`);
    await runOmniJS(SET_TAGS_SCRIPT, { assignments: { [t3.taskId]: [fixture.droppedId] } });
    const outDropped = await getTasksByTag({ tagId: fixture.droppedId, hideCompleted: true });
    check('tagId resolves a dropped tag without includeDropped and reports its path', outDropped.includes(t3.taskId) && outDropped.includes(`**Matched tags**: ${dupName}`), outDropped.split('\n').slice(0, 4).join(' / '));

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
