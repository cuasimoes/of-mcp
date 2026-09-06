#!/usr/bin/env node
// Verification harness for issue #14: edit_item must not report success when
// no mutation field was supplied. Exercises the MCP definition handler (the
// layer that formats the response), not just the primitive.
//
// Bundle + run (after `npm run build:fast`, so dist/utils/omnifocusScripts/ exists):
//   npx esbuild tests/test-issue-14.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-14.mjs \
//   && node dist/test-issue-14.mjs

import { handler as editItemHandler } from '../src/tools/definitions/editItem.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { addProject } from '../src/tools/primitives/addProject.js';
import { getTaskById } from '../src/tools/primitives/getTaskById.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';

const PROJECT_NAME = '_of-mcp-test-14';
const TASK_NAME = '_of-mcp-test-14 task';
const RENAMED = '_of-mcp-test-14 task (renamed)';

const results = [];
function record(test, passed, detail) {
  results.push({ test, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'} ${test}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  let projectId = null;
  let taskId = null;

  try {
    console.log('1. Creating throwaway project + task...');
    const proj = await addProject({ name: PROJECT_NAME });
    if (!proj.success) throw new Error(`addProject failed: ${proj.error}`);
    projectId = proj.projectId;
    const task = await addOmniFocusTask({ name: TASK_NAME, projectId });
    if (!task.success) throw new Error(`addOmniFocusTask failed: ${task.error}`);
    taskId = task.taskId;
    console.log(`   project=${projectId} task=${taskId}`);

    console.log('\n2. edit_item with selector fields only (id + itemType + name)...');
    const noop = await editItemHandler({ id: taskId, itemType: 'task', name: 'Should not become the name' }, {});
    const noopText = noop.content[0].text;
    console.log(`   response: ${JSON.stringify(noopText)} isError=${noop.isError === true}`);
    record('no-op call returns isError', noop.isError === true, noopText);
    record('no-op message names the new* fields', /newName/.test(noopText) && /newStatus/.test(noopText));

    const afterNoop = await getTaskById({ taskId });
    record('task name unchanged after no-op', afterNoop.success && afterNoop.task.name === TASK_NAME, afterNoop.task?.name);

    console.log('\n3. edit_item with newName...');
    const rename = await editItemHandler({ id: taskId, itemType: 'task', newName: RENAMED }, {});
    const renameText = rename.content[0].text;
    console.log(`   response: ${JSON.stringify(renameText)} isError=${rename.isError === true}`);
    record('rename call succeeds', rename.isError !== true && /updated successfully \(name\)/.test(renameText), renameText);

    const afterRename = await getTaskById({ taskId });
    record('task actually renamed', afterRename.success && afterRename.task.name === RENAMED, afterRename.task?.name);

    console.log('\n4. edit_item with a mutation field OmniFocus ignores for tasks (newSequential)...');
    const ignored = await editItemHandler({ id: taskId, itemType: 'task', newSequential: true }, {});
    const ignoredText = ignored.content[0].text;
    console.log(`   response: ${JSON.stringify(ignoredText)} isError=${ignored.isError === true}`);
    record('empty changedProperties returns isError', ignored.isError === true && /no change was made/.test(ignoredText), ignoredText);
  } catch (err) {
    record('harness ran to completion', false, err.message);
  } finally {
    console.log('\n5. Cleanup...');
    if (taskId) {
      const r = await removeItem({ id: taskId, itemType: 'task' });
      console.log(`   task removed: ${r.success} ${r.error || ''}`);
    }
    if (projectId) {
      const r = await removeItem({ id: projectId, itemType: 'project' });
      record('cleanup: project removed', r.success === true, r.error);
    }
    if (taskId) {
      const gone = await getTaskById({ taskId });
      record('cleanup verified (task no longer found)', !gone.success, gone.error);
    }
  }

  const failed = results.filter(r => !r.passed).length;
  console.log(`\nTotal: ${results.length} | Passed: ${results.length - failed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
