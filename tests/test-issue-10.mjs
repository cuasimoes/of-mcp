#!/usr/bin/env node
// Issue #10: add_omnifocus_task reported "in your inbox" when the task was placed via projectId.
// Also checks batch_add_items per-item reporting names the container.
// Requires a live OmniFocus. Creates and removes a `_of-mcp-test-10` project and `_oftest-10 *` tasks.
//
// Run (after `npm run build:fast`; output must be in dist/ so @script.js resolution works):
//   npx esbuild tests/test-issue-10.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-10.mjs \
//   && node dist/test-issue-10.mjs

import { addProject } from '../src/tools/primitives/addProject.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { getTaskById } from '../src/tools/primitives/getTaskById.js';
import { getProjectById } from '../src/tools/primitives/getProjectById.js';
import { searchTasks } from '../src/tools/primitives/searchTasks.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';
import { batchRemoveItems } from '../src/tools/primitives/batchRemoveItems.js';
import { handler as addTaskHandler } from '../src/tools/definitions/addOmniFocusTask.js';
import { handler as batchAddHandler } from '../src/tools/definitions/batchAddItems.js';

const PROJECT_NAME = '_of-mcp-test-10';
const TASK_PREFIX = '_oftest-10';
const results = [];
const createdTaskIds = [];
let projectId = null;

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function scrapeIds(text) {
  return [...text.matchAll(/\(id: ([^)]+)\)/g)].map(m => m[1]);
}

async function run() {
  const proj = await addProject({ name: PROJECT_NAME });
  if (!proj.success) throw new Error(`Could not create test project: ${proj.error}`);
  projectId = proj.projectId;
  console.log(`Created project ${PROJECT_NAME} (${projectId})`);

  // 1. Single add via projectId — definition response must name the project, not the inbox
  const single = await addTaskHandler({ name: `${TASK_PREFIX} single`, projectId }, {});
  const singleText = single.content[0].text;
  console.log(`  response: ${singleText}`);
  const singleId = scrapeIds(singleText)[0];
  if (singleId) createdTaskIds.push(singleId);
  check('single: response names project', singleText.includes(`in project "${PROJECT_NAME}"`), singleText);
  check('single: response does not say inbox', !singleText.includes('in your inbox'));

  // Ground truth: the task really is in the project
  const fetched = singleId ? await getTaskById({ taskId: singleId }) : { success: false };
  check('single: getTaskById confirms project', fetched.success && fetched.task?.projectId === projectId,
    fetched.success ? `projectName=${fetched.task?.projectName}` : fetched.error);

  // 2. Primitive exposes the resolved container
  const prim = await addOmniFocusTask({ name: `${TASK_PREFIX} primitive`, projectId });
  if (prim.taskId) createdTaskIds.push(prim.taskId);
  check('primitive: returns container', prim.container?.type === 'project' && prim.container?.name === PROJECT_NAME,
    JSON.stringify(prim.container ?? null));

  // 3. No location args → inbox
  const inboxRes = await addTaskHandler({ name: `${TASK_PREFIX} inbox` }, {});
  const inboxText = inboxRes.content[0].text;
  console.log(`  response: ${inboxText}`);
  createdTaskIds.push(...scrapeIds(inboxText));
  check('inbox: response says inbox', inboxText.includes('in your inbox'), inboxText);

  // 4. parentTaskId → names the resolved parent (not the raw id alone)
  const parentRes = await addTaskHandler({ name: `${TASK_PREFIX} child`, parentTaskId: singleId }, {});
  const parentText = parentRes.content[0].text;
  console.log(`  response: ${parentText}`);
  createdTaskIds.push(...scrapeIds(parentText));
  check('subtask: response names parent with id',
    parentText.includes(`as a subtask of "${TASK_PREFIX} single" (id ${singleId})`), parentText);

  // 5. Batch add: projectId item names the project; bare item says inbox
  const batch = await batchAddHandler({ items: [
    { type: 'task', name: `${TASK_PREFIX} batch`, projectId },
    { type: 'task', name: `${TASK_PREFIX} batch-inbox` }
  ] }, {});
  const batchText = batch.content[0].text;
  console.log(`  response: ${batchText.replace(/\n/g, ' | ')}`);
  createdTaskIds.push(...scrapeIds(batchText));
  check('batch: project item names project', batchText.includes(`"${TASK_PREFIX} batch" (id: `) &&
    new RegExp(`"${TASK_PREFIX} batch" \\(id: [^)]+\\) in project "${PROJECT_NAME}"`).test(batchText), batchText);
  check('batch: bare item says inbox',
    new RegExp(`"${TASK_PREFIX} batch-inbox" \\(id: [^)]+\\) in your inbox`).test(batchText));
}

async function cleanup() {
  if (createdTaskIds.length) {
    const r = await batchRemoveItems(createdTaskIds.map(id => ({ id, itemType: 'task' })));
    check('cleanup: scraped task ids removed', r.successCount === createdTaskIds.length,
      `${r.successCount}/${createdTaskIds.length}`);
  }
  // Sweep by name prefix so leftovers are caught even if id scraping missed something
  const sweep = await searchTasks({ query: TASK_PREFIX, matchMode: 'contains', searchIn: 'name', includeCompleted: true, limit: 100 });
  const leftovers = [...sweep.matchAll(/\[ID: ([^\]]+)\]/g)].map(m => m[1]);
  if (leftovers.length) {
    const r = await batchRemoveItems(leftovers.map(id => ({ id, itemType: 'task' })));
    check('cleanup: prefix sweep removed leftovers', r.successCount === leftovers.length, `${leftovers.length} leftover(s)`);
  } else {
    check('cleanup: prefix sweep found nothing left', true);
  }
  if (projectId) {
    const r = await removeItem({ id: projectId, itemType: 'project' });
    check('cleanup: project removed', r.success, r.error);
    const gone = await getProjectById({ projectId });
    check('cleanup: project no longer resolves', !gone.success);
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
