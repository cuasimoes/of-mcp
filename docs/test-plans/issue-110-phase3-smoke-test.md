# Smoke Test — Issue #110 Phase 3 (entity-lookup error surfacing)

**Branch:** `claude/refine-local-plan-Zzg2b`
**Version under test:** `1.30.11`
**Tools affected:** `get_project_by_id`, `get_folder_by_id`, `get_task_by_id`
**Run in:** a Claude Code (or other MCP client) session connected to **OmniFocus** on macOS.

---

## What changed (context for the tester)

These three lookup tools used to swallow errors when an optional field couldn't be
read (`} catch (e) {}`). A project's task count / folder / review dates, a folder's
project/subfolder counts, or a task's parent / project / tags would silently fall
back to `0`/`null`, so a partial result looked identical to a complete one.

Now, when such a read fails, the tool **counts** it, captures up to 3 sample
messages, and appends a `⚠️ Processing Warnings` section to its output (and emits a
server-side `log.warn`). **The entity is still returned** — this only adds
*visibility* into incomplete data.

The central thing this smoke test confirms is the **regression case**: in a healthy
database, *nothing fails to read*, so the output must be **identical to before — no
warning section at all.** The warning path itself is exotic and not expected to
trigger on a normal database (its rendering is already verified by an automated
check — see "Notes").

**Also bundled (v1.30.11) — two parent-field fixes that change output:**

- **`get_folder_by_id`** previously checked a non-existent `folder.parent.folder`, so
  a nested folder's parent was *always* blank. It now shows `• Parent Folder: <name>`
  for foldered folders (TC3). Top-level folders correctly still show none.
- **`get_task_by_id`** previously checked a non-existent `task.parent.task`, so a
  subtask's parent was *always* blank. It now shows `• Parent Task: <name> (<id>)`
  for a genuine subtask (TC4). A **top-level task** correctly still shows *no* parent
  (its `parent` is the project's hidden root task, excluded via `task.parent.project`)
  — that exclusion is the regression check in TC4.

These were wrong-property bugs, not swallowed exceptions, so the error-surfacing
above does not catch them — TC3/TC4 verify the parents now appear.

---

## Setup (do this once before the test cases)

1. **Build this branch** so the MCP server runs v1.30.11:
   ```bash
   cd /Users/mojen/dev/of-mcp
   git checkout claude/refine-local-plan-Zzg2b
   npm install   # if needed
   npm run build
   ```
2. **Point your MCP client at this build** (`dist/server.js` in this repo) and
   **restart the session** so it loads the new build.
3. Have OmniFocus running with your normal database (or any database that has at
   least a few projects, ideally at least one **nested folder** and at least one
   **subtask** so TC3/TC4 are exercisable).

---

## TC1 — Version gate (must pass before anything else)

**Why:** confirms you're testing this branch's build, not an older one.

**Do:** ask Claude to run the `get_server_version` tool.

**Expect:** the returned JSON has `"version": "1.30.11"`.

- [ ] **PASS** — version is `1.30.11`
- [ ] **FAIL** — any other version (stop; you're testing the wrong build — revisit Setup)

---

## TC2 — `get_project_by_id` happy path (primary regression check)

**Do:** look up a real project by name or ID → `get_project_by_id`.

**Expect:**
- A normal `📁 **Project Information**` block (Name, ID, Status, Folder if any,
  Tasks, Sequential, Flagged, dates, review info where present).
- **No `⚠️ Processing Warnings` section anywhere in the output.**

- [ ] **PASS** — normal output, fields populated, no warning section
- [ ] **FAIL** — warning section present, OR fields missing/malformed (record the output)

---

## TC3 — `get_folder_by_id` parent-folder fix (output changes)

**Do:**
1. Look up a **nested folder** (a folder that lives inside another folder) →
   `get_folder_by_id`.
2. Look up a **top-level folder** (directly under the library) → `get_folder_by_id`.

**Expect:**
- The nested folder now shows a `• **Parent Folder**: <name>` line (this line never
  appeared before v1.30.11 for *any* folder).
- The top-level folder shows **no** Parent Folder line.
- Both show normal `📂 Folder Information` (Projects, Subfolders counts); **no warning
  section** in either.

- [ ] **PASS** — nested folder shows parent; top-level shows none; no warnings
- [ ] **FAIL** — parent missing for a known-nested folder, parent shown for a top-level folder, or a warning appears (record output)

---

## TC4 — `get_task_by_id` parent-task fix + regression guard (output changes)

**Do:**
1. Look up a **genuine subtask** (a task nested *under another task*) →
   `get_task_by_id`.
2. Look up a **top-level task** (a direct action of a project, *not* nested under
   another task) → `get_task_by_id`.

**Expect:**
- The subtask now shows a `• **Parent Task**: <name> (<id>)` line (this line never
  appeared before v1.30.11), **and** still shows its `• **Project**:` line.
- The top-level task shows **no** Parent Task line (its parent is the project's
  hidden root task, deliberately excluded) but **does** still show `• **Project**:`.
  This is the regression check for the `!task.parent.project` guard — if a top-level
  task suddenly shows a "Parent Task" equal to its project name, that is a FAIL.
- **No warning section** in either.

- [ ] **PASS** — subtask shows parent; top-level shows none but shows Project; no warnings
- [ ] **FAIL** — parent missing for a known subtask, OR a top-level task shows a (root-task) parent, OR a warning appears (record output)

---

## TC5 — Regression sweep (the core guarantee)

**Do:** run a handful of normal lookups across all three tools — a few projects, a
few folders (nested and top-level), a few tasks (subtasks and top-level).

**Expect:** every call returns normal output with correct fields and **no
`⚠️ Processing Warnings` section anywhere** on a healthy database.

- [ ] **PASS** — all normal, no warnings anywhere
- [ ] **FAIL** — any warning section on a healthy DB, or broken/missing fields (note which)

---

## TC6 — (Optional / informational) The warning path

You are **not expected to be able to trigger this** on a healthy database — it fires
only when reading an optional field (e.g. a project's `flattenedTasks`/`parentFolder`/
review dates, a folder's `projects`/`folders`/`parent`, or a task's `parent`/
`containingProject`/`tags`) actually throws (corrupted or unusual database state). Do
**not** treat a non-appearance as a failure.

**If a warning ever does appear**, it will look exactly like this:

```
⚠️ **Processing Warnings**:
- 2 details could not be read; affected fields may show as '-', 0, or null
- Samples: taskCount(Some Project): <error>; folder(Some Project): <error>
```

**`get_task_by_id` cache caveat:** this tool caches its result. If a task lookup ever
produces a warning, the warning will re-appear on subsequent lookups of the *same*
task until the cache entry expires — even if the underlying read would now succeed.

- [ ] Not triggered (expected on a healthy DB)
- [ ] Triggered — captured output for follow-up

---

## Optional — server log check

If you can view the MCP server's stderr/log output, a `log.warn` line
(`getProjectById` / `getFolderById` / `getTaskById returned processing errors`)
should appear **only** alongside a warning section — i.e. never, in a healthy
database. Absence of these log lines in TC2–TC5 is the expected, correct result.

---

## Red flags (treat as FAIL)

- A `⚠️ Processing Warnings` section appears in TC2–TC5 on a database you believe is
  healthy → either real read failures or over-counting in the instrumentation.
- A top-level task shows a `• Parent Task:` line (named like its project) → the
  `!task.parent.project` guard regressed.
- Output structure otherwise changed vs. previous versions → regression.
- `get_server_version` ≠ `1.30.11` → you tested the wrong build; redo Setup.

---

## Results

| Test | Result | Notes |
|------|--------|-------|
| TC1 Version gate | ☑ PASS ☐ FAIL | `get_server_version` → `1.30.11` (branch `claude/refine-local-plan-Zzg2b` @ `3b34cc9`) |
| TC2 get_project_by_id happy path | ☑ PASS ☐ FAIL | Foldered project, 10 tasks: full Project + Review block, no warning section |
| TC3 get_folder_by_id parent fix | ☑ PASS ☐ FAIL | Nested folder shows `Parent Folder: <name>`; top-level folder (8 subfolders) shows none; no warnings. Parent subfolder-count and child parent-name agree both directions |
| TC4 get_task_by_id parent fix + guard | ☑ PASS ☐ FAIL | Subtask shows `Parent Task` + `Project` (verified two levels deep); top-level task shows `Project` and NO `Parent Task`. Guard confirmed on synthetic `test-project` and a real foldered project |
| TC5 regression sweep | ☑ PASS ☐ FAIL | ~16 lookups across all three tools (projects ±folder, nested + top-level folders, subtask + top-level tasks); zero `Processing Warnings` sections |
| TC6 warning path (optional) | ☑ n/a ☐ triggered | Not triggered (expected on healthy DB); render path covered by the automated check |

**Overall:** ☑ PASS (TC1–TC5 all pass) ☐ FAIL

**Run:** 2026-05-25 / MoJen (Claude Code session) / branch `claude/refine-local-plan-Zzg2b` @ `3b34cc9`, server v1.30.11 (entity names sanitised)

---

## Notes — what's already been verified without OmniFocus

- `npm run build` compiles cleanly; `node --check` passes on all three OmniJS scripts.
- The warning **render** path is unchanged from Phase 2 and already verified against
  the compiled `formatProcessingWarnings()`: a `{ metadataErrors, samples }` payload
  renders the warning above; `0` / `undefined` renders an empty string (so the happy
  path shows no warning).

The only unverified link is the OmniJS counting/attaching firing against a *real*
OmniFocus read failure, which is what TC6 would exercise if it were triggerable.
