#!/usr/bin/env node
// Issue #10: add_omnifocus_task reported "in your inbox" when the task was placed via projectId.
// Also checks batch_add_items per-item reporting names the project.
// Requires a live OmniFocus. Run via esbuild bundle into dist/ (see agent notes / PR).

import { addProject } from '../src/tools/primitives/addProject.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { getTaskById } from '../src/tools/primitives/getTaskById.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';
import { batchRemoveItems } from '../src/tools/primitives/batchRemoveItems.js';
import { handler as addTaskHandler } from '../src/tools/definitions/addOmniFocusTask.js';
import { handler as batchAddHandler } from '../src/tools/definitions/batchAddItems.js';

const PROJECT_NAME = '_of-mcp-test-10';
const results = [];
const createdTaskIds = [];
let projectId = null;

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function run() {
  const proj = await addProject({ name: PROJECT_NAME });
  if (!proj.success) throw new Error(`Could not create test project: ${proj.error}`);
  projectId = proj.projectId;
  console.log(`Created project ${PROJECT_NAME} (${projectId})`);

  // 1. Single add via projectId — definition response must name the project, not the inbox
  const single = await addTaskHandler({ name: '_oftest-10 single', projectId }, {});
  const singleText = single.content[0].text;
  console.log(`  response: ${singleText}`);
  const singleId = (singleText.match(/\(id: ([^)]+)\)/) || [])[1];
  if (singleId) createdTaskIds.push(singleId);
  check('single: response names project', singleText.includes(`in project "${PROJECT_NAME}"`), singleText);
  check('single: response does not say inbox', !singleText.includes('in your inbox'));

  // Ground truth: the task really is in the project
  const fetched = singleId ? await getTaskById({ taskId: singleId }) : { success: false };
  check('single: getTaskById confirms project', fetched.success && fetched.task?.projectId === projectId,
    fetched.success ? `projectName=${fetched.task?.projectName}` : fetched.error);

  // 2. Primitive exposes the resolved container
  const prim = await addOmniFocusTask({ name: '_oftest-10 primitive', projectId });
  if (prim.taskId) createdTaskIds.push(prim.taskId);
  check('primitive: returns container', prim.container?.type === 'project' && prim.container?.name === PROJECT_NAME,
    JSON.stringify(prim.container ?? null));

  // 3. Batch add via projectId — per-item line should name the project
  const batch = await batchAddHandler({ items: [{ type: 'task', name: '_oftest-10 batch', projectId }] }, {});
  const batchText = batch.content[0].text;
  console.log(`  response: ${batchText.replace(/\n/g, ' | ')}`);
  for (const m of batchText.matchAll(/\(id: ([^)]+)\)/g)) createdTaskIds.push(m[1]);
  check('batch: per-item line names project', batchText.includes(`in project "${PROJECT_NAME}"`), batchText);
}

async function cleanup() {
  if (createdTaskIds.length) {
    const r = await batchRemoveItems(createdTaskIds.map(id => ({ id, itemType: 'task' })));
    console.log(`Cleanup tasks: ${r.successCount}/${createdTaskIds.length} removed`);
  }
  if (projectId) {
    const r = await removeItem({ id: projectId, itemType: 'project' });
    console.log(`Cleanup project: ${r.success ? 'removed' : r.error}`);
    const gone = await getTaskById({ taskId: projectId });
    for (const id of createdTaskIds) {
      const t = await getTaskById({ taskId: id });
      if (t.success) console.log(`WARNING: task ${id} still exists`);
    }
    console.log(`Verify project gone: ${gone.success ? 'STILL EXISTS' : 'ok'}`);
  }
}

run()
  .catch(err => { console.error('Harness error:', err); results.push({ name: 'harness', passed: false }); })
  .finally(async () => {
    await cleanup();
    const failed = results.filter(r => !r.passed).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
