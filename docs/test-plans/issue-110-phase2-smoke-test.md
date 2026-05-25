# Smoke Test — Issue #110 Phase 2 (project-listing error surfacing)

**Branch:** `fix/issue-110-phase2-project-listing-errors`
**Version under test:** `1.30.10`
**Tools affected:** `list_projects`, `get_projects_for_review`
**Run in:** a Claude Code (or other MCP client) session connected to **OmniFocus** on macOS.

---

## What changed (context for the tester)

These two tools used to swallow errors when an optional field couldn't be read
(`} catch (e) {}`). A project's task count / folder / review date would silently
fall back to `0`/`null`, so a partial result looked identical to a complete one.

Now, when such a read fails, the tool **counts** it, captures up to 3 sample
messages, and appends a `⚠️ Processing Warnings` section to its output (and
emits a server-side `log.warn`). **The projects are still listed** — this only
adds *visibility* into incomplete data.

The central thing this smoke test confirms is the **regression case**: in a
healthy database, *nothing fails to read*, so the output must be **identical to
before — no warning section at all.** The warning path itself is exotic and not
expected to trigger on a normal database (its rendering is already verified by an
automated check, see "Notes" at the bottom).

**Also bundled (v1.30.10):** a folder-property fix in `get_projects_for_review`.
It previously read a non-existent `project.folder` (always `undefined`) instead of
`project.parentFolder`, so the per-project folder line was *always* blank. This
was a wrong-property bug, not a swallowed exception, so the error-surfacing above
does not catch it — TC4/TC5 below verify the folder now appears. `list_projects`
was never affected.

---

## Setup (do this once before the test cases)

1. **Build this branch** so the MCP server runs v1.30.10:
   ```bash
   cd /Users/mojen/dev/of-mcp
   git checkout fix/issue-110-phase2-project-listing-errors
   npm run build
   ```
2. **Point your MCP client at this build** (`dist/server.js` in this repo) and
   **restart the session** so it loads the new build. If you normally use the
   published/`main` server, switch it to this repo's `dist/server.js` for the test.
3. Have OmniFocus running with your normal database (or any database that has at
   least a few projects, ideally some inside folders and some marked for review).

---

## TC1 — Version gate (must pass before anything else)

**Why:** confirms you're testing this branch's build, not an older one.

**Do:** ask Claude to run the `get_server_version` tool.

**Expect:** the returned JSON has `"version": "1.30.10"`.

- [ ] **PASS** — version is `1.30.10`
- [ ] **FAIL** — any other version (stop; you're testing the wrong build — revisit Setup)

---

## TC2 — `list_projects` happy path (primary regression check)

**Do:** ask Claude: *"List my projects"* (i.e. call `list_projects` with no arguments).

**Expect:**
- A normal projects table with columns: `Name | Status | Tasks | Next Review | Folder`.
- A `**Project IDs:**` list below the table.
- A `Found **N** active project(s):` count line.
- **No `⚠️ Processing Warnings` section anywhere in the output.**

**Pass criteria:** output is structurally identical to what previous versions
produced, and there is **no** warning section.

- [ ] **PASS** — normal output, no warning section
- [ ] **FAIL** — warning section present, OR table/IDs/count missing or malformed (record the output)

---

## TC3 — `list_projects` across filters (instrumentation didn't break other paths)

Run each of these and confirm normal output with **no warning section**:

1. *"List all my projects including completed and dropped"* → `list_projects` with `status: "all"`.
2. *"List projects in the folder `<a real folder name>`"* → `list_projects` with `folderName: "<folder>"`.
3. *"List on-hold projects"* → `list_projects` with `status: "onHold"`.

**Expect:** each returns its filtered table correctly; task counts, folders, and
next-review dates are populated where they exist; no `⚠️ Processing Warnings`.

- [ ] **PASS** — all three return normal, correctly-filtered output, no warnings
- [ ] **FAIL** — any returns a warning section, wrong filtering, or broken output (note which)

---

## TC4 — `get_projects_for_review` happy path (primary regression check)

**Do:** ask Claude: *"Which projects need review?"* → `get_projects_for_review`.

**Expect either:**
- A `📋 Projects Needing Review (N)` list where each entry shows Status, Remaining
  Tasks, Review Interval, Next/Last Review dates — and **no** `⚠️ Processing
  Warnings` section; **or**
- `No projects need review at this time.` if nothing is currently due (also a valid PASS).

**Folder line (fixed in 1.30.10):** projects that live **inside a folder** must now
show a `• Folder: <name>` line; root-level projects correctly show no folder line.
Before 1.30.10 this line never appeared for *any* project (the script read a
non-existent `project.folder` property — see "Notes"). Cross-check against
`list_projects` (TC2): a project shown under a folder there must also show that
folder here.

**Pass criteria:** normal review output (or the empty-state message); no warning
section; **foldered projects now show their folder.**

- [ ] **PASS** — normal review list (or empty-state); foldered projects show `• Folder:`; no warning section
- [ ] **FAIL** — warning section present, folder line missing for a project you know is in a folder, or fields missing (record output)

---

## TC5 — `get_projects_for_review` with on-hold included

**Do:** ask Claude: *"Which projects need review, including on-hold ones?"* →
`get_projects_for_review` with `includeOnHold: true`.

**Expect:** normal output (may include more projects than TC4); no warning section.

- [ ] **PASS** — normal output, no warning section
- [ ] **FAIL** — warning section present or broken output

---

## TC6 — (Optional / informational) The warning path

You are **not expected to be able to trigger this** on a healthy database — it
fires only when reading a project's `flattenedTasks`, `parentFolder`,
`nextReviewDate`, `folder`, or `reviewInterval` actually throws (corrupted or
unusual database state). Do **not** treat a non-appearance as a failure.

**If a warning ever does appear**, it will look exactly like this (wording/format
to recognize):

```
⚠️ **Processing Warnings**:
- 2 details could not be read; affected fields may show as '-', 0, or null
- Samples: taskCount(Some Project): <error>; folder(Other Project): <error>
```

If you see this in normal use, capture the full output and the sample messages —
that's a genuine signal that some project's metadata couldn't be read (or, if it
appears spuriously in a clearly-healthy DB, a bug in the instrumentation worth
reporting).

- [ ] Not triggered (expected on a healthy DB)
- [ ] Triggered — captured output for follow-up

---

## Optional — server log check

If you can view the MCP server's stderr/log output, a `log.warn` line
(`listProjects returned processing errors` / `getProjectsForReview returned
processing errors`) should appear **only** alongside a warning section — i.e.
never, in a healthy database. Absence of these log lines in TC2–TC5 is the
expected, correct result.

---

## Red flags (treat as FAIL)

- A `⚠️ Processing Warnings` section appears in TC2–TC5 on a database you believe
  is healthy → either real read failures or over-counting in the instrumentation.
- Output structure changed vs. previous versions (missing table, IDs, counts,
  review fields) → regression from this change.
- `get_server_version` ≠ `1.30.10` → you tested the wrong build; redo Setup.

---

## Results

| Test | Result | Notes |
|------|--------|-------|
| TC1 Version gate | ☑ PASS ☐ FAIL | `get_server_version` returned `1.30.10` |
| TC2 list_projects happy path | ☑ PASS ☐ FAIL | Table + Project IDs + "Found **60** active projects:"; no warning section |
| TC3 list_projects filters | ☑ PASS ☐ FAIL | `status:all` → 100, `folderName:<a folder>` → 12 (correctly scoped), `status:onHold` → 35; no warnings |
| TC4 get_projects_for_review happy path | ☑ PASS ☐ FAIL | "(50 of 59)"; foldered projects now show `• Folder:` (cross-checked vs `list_projects`); a root-level project shows none; no warning section |
| TC5 get_projects_for_review on-hold | ☑ PASS ☐ FAIL | "(50 of 94)"; on-hold projects included and showing folders (cross-checked vs `list_projects`); no warning section |
| TC6 warning path (optional) | ☑ n/a ☐ triggered | No `⚠️ Processing Warnings` anywhere in TC2-TC5 (expected on a healthy DB) |

**Overall:** ☑ PASS (TC1–TC5 all pass) ☐ FAIL

**Run:** 2026-05-25 by Claude (Opus 4.7) in a Claude Code session, against the uncommitted working-tree build (v1.30.10), live OmniFocus database. Note: the issue #110 changes were still unstaged at time of test.

---

## Notes — what's already been verified without OmniFocus

- `npm run build` compiles cleanly; `node --check` passes on both OmniJS scripts.
- The warning **render** path is verified directly against the compiled
  `formatProcessingWarnings()`:
  - a `{ metadataErrors, samples }` payload renders the warning above (plural/singular
    grammar correct),
  - a legacy `{ filterErrors, ... }` payload still renders the original "tasks
    excluded" wording (no regression to the v1.30.7 filter-error behavior),
  - `0` errors / `undefined` render an empty string (so the happy path shows no warning).

The only unverified link is the OmniJS counting/attaching firing against a *real*
OmniFocus read failure, which is what TC6 would exercise if it were triggerable.
