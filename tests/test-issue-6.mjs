#!/usr/bin/env node
// Verification harness for issue #6: edit_tag cannot move a tag to a new parent
// (tag.moveTo is not a function). Runs against live OmniFocus; creates and
// removes its own throwaway data (_of-mcp-test-6 project, _oftest-6-* tags).
//
// Build + run:
//   npm run build:fast
//   npx esbuild tests/test-issue-6.mjs --bundle --platform=node --format=esm \
//     --external:@modelcontextprotocol/sdk --external:zod --outfile=dist/test-issue-6.mjs
//   node dist/test-issue-6.mjs

import { editTag } from '../src/tools/primitives/editTag.js';
import { addProject } from '../src/tools/primitives/addProject.js';
import { addOmniFocusTask } from '../src/tools/primitives/addOmniFocusTask.js';
import { removeItem } from '../src/tools/primitives/removeItem.js';
import { executeJXA } from '../src/utils/scriptExecution.js';

const PROJECT_NAME = '_of-mcp-test-6';
const PARENT = '_oftest-6-parent';
const OTHER = '_oftest-6-other';
const CHILD = '_oftest-6-child';
const TASK_NAME = '_oftest-6-task';

// Run an OmniJS snippet inside OmniFocus and parse its JSON return value.
async function omniJS(code) {
  const escaped = code.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const jxa = `
    function run() {
      const app = Application('OmniFocus');
      return app.evaluateJavascript(\`${escaped}\`);
    }
  `;
  return executeJXA(jxa);
}

function tagState(name) {
  return omniJS(`(() => {
    const t = flattenedTags.find(t => t.name === ${JSON.stringify(name)});
    if (!t) return JSON.stringify(null);
    return JSON.stringify({
      id: t.id.primaryKey,
      parent: t.parent ? t.parent.name : null,
      taskNames: t.tasks.map(x => x.name)
    });
  })()`);
}

const results = [];
function check(test, passed, detail) {
  results.push({ test, passed, detail });
  console.log(`${passed ? '  PASS' : '  FAIL'} ${test}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ISSUE #6: edit_tag move to new parent / top level');
  console.log('='.repeat(60));

  // Refuse to run on top of leftovers from an earlier run — they'd confuse the assertions.
  const leftovers = await omniJS(`(() => JSON.stringify({
    tags: flattenedTags.filter(t => t.name.startsWith('_oftest-6-')).map(t => t.name),
    projects: flattenedProjects.filter(p => p.name === ${JSON.stringify(PROJECT_NAME)}).map(p => p.name)
  }))()`);
  if (leftovers.tags.length || leftovers.projects.length) {
    console.error('Leftover test data present, clean up first:', leftovers);
    process.exit(2);
  }

  let taskId = null;
  let projectId = null;

  try {
    // Setup: parent, other (both top-level), child under parent
    const ids = await omniJS(`(() => {
      const parent = new Tag(${JSON.stringify(PARENT)});
      const other = new Tag(${JSON.stringify(OTHER)});
      const child = new Tag(${JSON.stringify(CHILD)}, parent);
      return JSON.stringify({ parent: parent.id.primaryKey, other: other.id.primaryKey, child: child.id.primaryKey });
    })()`);
    console.log('\nCreated tags:', ids);

    const proj = await addProject({ name: PROJECT_NAME });
    if (!proj.success) throw new Error(`addProject failed: ${proj.error}`);
    projectId = proj.projectId;

    const task = await addOmniFocusTask({ name: TASK_NAME, projectId, tags: [CHILD] });
    if (!task.success) throw new Error(`addOmniFocusTask failed: ${task.error}`);
    taskId = task.taskId;

    let s = await tagState(CHILD);
    check('setup: child under parent with task attached',
      s.parent === PARENT && s.taskNames.includes(TASK_NAME), JSON.stringify(s));

    // 1. Move child -> other, by parent name
    console.log('\n1. editTag: move child under other (newParentTagName)');
    try {
      const out = await editTag({ tagId: ids.child, newParentTagName: OTHER });
      console.log('   ' + out.replace(/\n/g, '\n   '));
      check('move by name: reports parent change', out.includes(`parent → ${OTHER}`), out.split('\n')[1]);
    } catch (err) {
      check('move by name: editTag succeeds', false, err.message);
    }
    s = await tagState(CHILD);
    check('move by name: child.parent is other', s.parent === OTHER, `parent=${s.parent}`);
    check('move by name: task still tagged', s.taskNames.includes(TASK_NAME), JSON.stringify(s.taskNames));

    // 2. Move child -> top level
    console.log('\n2. editTag: move child to top level (newParentTagId: "")');
    try {
      const out = await editTag({ tagId: ids.child, newParentTagId: '' });
      console.log('   ' + out.replace(/\n/g, '\n   '));
      check('top level: reports parent change', out.includes('parent → (top-level)'), out.split('\n')[1]);
    } catch (err) {
      check('top level: editTag succeeds', false, err.message);
    }
    s = await tagState(CHILD);
    check('top level: child.parent is null', s.parent === null, `parent=${s.parent}`);
    check('top level: task still tagged', s.taskNames.includes(TASK_NAME), JSON.stringify(s.taskNames));

    // 3. Move child -> parent, by parent id
    console.log('\n3. editTag: move child back under parent (newParentTagId)');
    try {
      const out = await editTag({ tagName: CHILD, newParentTagId: ids.parent });
      console.log('   ' + out.replace(/\n/g, '\n   '));
      check('move by id: reports parent change', out.includes(`parent → ${PARENT}`), out.split('\n')[1]);
    } catch (err) {
      check('move by id: editTag succeeds', false, err.message);
    }
    s = await tagState(CHILD);
    check('move by id: child.parent is parent', s.parent === PARENT, `parent=${s.parent}`);
    check('move by id: task still tagged', s.taskNames.includes(TASK_NAME), JSON.stringify(s.taskNames));

    // 4. Cycle guard still works
    console.log('\n4. editTag: parent under child must be rejected');
    try {
      await editTag({ tagId: ids.parent, newParentTagId: ids.child });
      check('cycle guard: rejected', false, 'no error thrown');
    } catch (err) {
      check('cycle guard: rejected', /own descendant/.test(err.message), err.message);
    }
  } finally {
    console.log('\nCleanup');
    if (taskId) {
      const r = await removeItem({ id: taskId, itemType: 'task' });
      console.log(`   task removed: ${r.success}${r.error ? ' ' + r.error : ''}`);
    }
    if (projectId) {
      const r = await removeItem({ id: projectId, itemType: 'project' });
      console.log(`   project removed: ${r.success}${r.error ? ' ' + r.error : ''}`);
    }
    const removed = await omniJS(`(() => {
      // Deleting a tag cascades to its children, so only delete the topmost test tags
      // (a child already removed with its parent is "no longer valid" for deleteObject).
      const isMine = t => t.name.startsWith('_oftest-6-');
      const mine = flattenedTags.filter(t => isMine(t) && !(t.parent && isMine(t.parent)));
      const names = mine.map(t => t.name);
      mine.forEach(t => deleteObject(t));
      return JSON.stringify(names);
    })()`);
    console.log(`   tags removed: ${JSON.stringify(removed)}`);

    const remaining = await omniJS(`(() => JSON.stringify({
      tags: flattenedTags.filter(t => t.name.startsWith('_oftest-6-')).map(t => t.name),
      projects: flattenedProjects.filter(p => p.name === ${JSON.stringify(PROJECT_NAME)}).map(p => p.name),
      tasks: flattenedTasks.filter(t => t.name === ${JSON.stringify(TASK_NAME)}).map(t => t.name)
    }))()`);
    check('cleanup: nothing left behind',
      !remaining.tags.length && !remaining.projects.length && !remaining.tasks.length, JSON.stringify(remaining));
  }

  const failed = results.filter(r => !r.passed).length;
  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${results.length - failed} | Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
