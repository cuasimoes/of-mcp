#!/usr/bin/env node
// Issue #9: edit_item / batch_edit_items silently ignore newSequential on tasks (action groups).
// Creates _of-mcp-test-9 with an action group of 3 children, flips the group to sequential
// via editItem, then back to parallel and to sequential again via batchEditItems, checking
// both the group's `sequential` flag and the children's Available/Blocked status.
//
// Run: npm run build:fast, then
//   npx esbuild tests/test-issue-9.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-9.mjs \
//   && node dist/test-issue-9.mjs

import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addProject } from '../src/tools/primitives/addProject.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { editItem } from '../src/tools/primitives/editItem.js';
import { batchEditItems } from '../src/tools/primitives/batchEditItems.js';
import { filterTasks } from '../src/tools/primitives/filterTasks.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';
import { executeOmniFocusScript } from '../src/utils/scriptExecution.js';

const PROJECT_NAME = '_of-mcp-test-9';
const CHILD_NAMES = ['_oftest-9-child-1', '_oftest-9-child-2', '_oftest-9-child-3'];

// Direct read of the group's sequential flag and each child's status, bypassing caches.
const PROBE_SCRIPT = `(() => {
  const args = typeof injectedArgs !== 'undefined' ? injectedArgs : {};
  const group = Task.byIdentifier(args.groupId);
  if (!group) return JSON.stringify({ success: false, error: 'group not found' });
  // sharedUtils.js is only prepended for scripts living next to lib/, so map status locally
  const statusMap = {
    [Task.Status.Available]: 'Available', [Task.Status.Blocked]: 'Blocked',
    [Task.Status.Completed]: 'Completed', [Task.Status.Dropped]: 'Dropped',
    [Task.Status.DueSoon]: 'DueSoon', [Task.Status.Next]: 'Next', [Task.Status.Overdue]: 'Overdue'
  };
  const statusName = (s) => (statusMap[s] || 'Unknown');
  return JSON.stringify({
    success: true,
    sequential: group.sequential,
    children: group.children.map(c => ({ name: c.name, status: statusName(c.taskStatus) }))
  });
})();`;

const probePath = join(tmpdir(), `of-mcp-test-9-probe-${process.pid}.js`);
writeFileSync(probePath, PROBE_SCRIPT);

async function probe(groupId) {
  const raw = await executeOmniFocusScript(probePath, { groupId });
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

const results = [];
function record(test, passed, detail) {
  results.push({ test, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'} ${test}${detail ? ` — ${detail}` : ''}`);
}

async function assertGroupState(label, groupId, projectId, expectSequential) {
  const state = await probe(groupId);
  if (!state.success) {
    record(`${label}: probe`, false, state.error);
    return;
  }
  const statuses = state.children.map(c => `${c.name}=${c.status}`).join(', ');
  record(`${label}: group.sequential === ${expectSequential}`, state.sequential === expectSequential, `sequential=${state.sequential}`);

  const first = state.children[0];
  const rest = state.children.slice(1);
  const blockedRest = rest.every(c => c.status === 'Blocked');
  const availableRest = rest.every(c => c.status !== 'Blocked');
  if (expectSequential) {
    record(`${label}: first child available, others Blocked`, first.status !== 'Blocked' && blockedRest, statuses);
  } else {
    record(`${label}: no child Blocked`, first.status !== 'Blocked' && availableRest, statuses);
  }

  // Cross-check through the public filterTasks path (Blocked filter)
  const blockedOut = await filterTasks({ projectId, taskStatus: ['Blocked'] });
  const blockedNames = CHILD_NAMES.filter(n => blockedOut.includes(n));
  const expectedBlocked = expectSequential ? CHILD_NAMES.slice(1) : [];
  record(`${label}: filterTasks Blocked = [${expectedBlocked.join(', ')}]`,
    JSON.stringify(blockedNames) === JSON.stringify(expectedBlocked), `got [${blockedNames.join(', ')}]`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ISSUE #9 — newSequential on tasks (action groups)');
  console.log('='.repeat(60));

  let projectId = null;
  let groupId = null;

  try {
    console.log('\n1. Setup');
    const proj = await addProject({ name: PROJECT_NAME, sequential: false });
    if (!proj.success) throw new Error(`addProject failed: ${proj.error}`);
    projectId = proj.projectId;

    const group = await addOmniFocusTask({ name: '_oftest-9-group', projectId });
    if (!group.success) throw new Error(`add group failed: ${group.error}`);
    groupId = group.taskId;

    for (const name of CHILD_NAMES) {
      const child = await addOmniFocusTask({ name, parentTaskId: groupId });
      if (!child.success) throw new Error(`add child ${name} failed: ${child.error}`);
    }
    console.log(`  project=${projectId} group=${groupId}`);

    await assertGroupState('baseline (parallel)', groupId, projectId, false);

    console.log('\n2. editItem newSequential: true on the group');
    const edit = await editItem({ id: groupId, itemType: 'task', newSequential: true });
    record('editItem returns success', edit.success === true, edit.error);
    record('editItem changedProperties includes "sequential"',
      typeof edit.changedProperties === 'string' && edit.changedProperties.includes('sequential'),
      `changedProperties="${edit.changedProperties}"`);
    await assertGroupState('after editItem', groupId, projectId, true);

    console.log('\n3. batchEditItems newSequential: false, then true');
    const back = await batchEditItems([{ id: groupId, itemType: 'task', newSequential: false }]);
    record('batchEditItems(false) success', back.successCount === 1, back.error || back.results[0]?.error);
    record('batchEditItems(false) changedProperties includes "sequential"',
      (back.results[0]?.changedProperties || '').includes('sequential'),
      `changedProperties="${back.results[0]?.changedProperties}"`);
    await assertGroupState('after batchEditItems(false)', groupId, projectId, false);

    const again = await batchEditItems([{ id: groupId, itemType: 'task', newSequential: true }]);
    record('batchEditItems(true) success', again.successCount === 1, again.error || again.results[0]?.error);
    await assertGroupState('after batchEditItems(true)', groupId, projectId, true);

    console.log('\n4. Project path still works (regression guard)');
    const projEdit = await editItem({ id: projectId, itemType: 'project', newSequential: true });
    record('editItem(project) changedProperties includes "sequential"',
      (projEdit.changedProperties || '').includes('sequential'), `changedProperties="${projEdit.changedProperties}"`);
  } catch (err) {
    record('harness ran to completion', false, err.message);
  } finally {
    console.log('\n5. Cleanup');
    if (projectId) {
      // Removing the project takes the group and its children with it.
      const rm = await removeItem({ id: projectId, itemType: 'project' });
      console.log(`  removeItem(project): ${rm.success ? 'ok' : rm.error}`);
      const leftover = await filterTasks({ projectFilter: PROJECT_NAME, taskStatus: ['Available', 'Blocked', 'Next', 'DueSoon', 'Overdue'] });
      const gone = !CHILD_NAMES.some(n => leftover.includes(n)) && !leftover.includes('_oftest-9-group');
      record('cleanup: no _oftest-9 tasks remain', gone);
    }
    try { unlinkSync(probePath); } catch { /* best effort */ }
  }

  const failed = results.filter(r => !r.passed).length;
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${results.length - failed} | Failed: ${failed}`);
  console.log('-'.repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
