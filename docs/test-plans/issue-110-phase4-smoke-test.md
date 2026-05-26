# Smoke Test — Issue #110 Phase 4 (edit_item review-interval template-lookup error surfacing)

**Branch:** `fix/issue-110-phase4-review-interval-error`
**Version under test:** `1.30.12`
**Tool affected:** `edit_item` (only when called with `newReviewInterval`)
**Run in:** a Claude Code (or other MCP client) session connected to **OmniFocus** on macOS.

---

## What changed (context for the tester)

`edit_item` with `newReviewInterval` works in two phases internally:

1. If the target project already has a review interval, use it.
2. Otherwise, scan `flattenedProjects` for any project that has one and use it as a template.

If step 2's loop ever throws mid-scan (e.g. a Bridge proxy hiccup on some project's `.reviewInterval`), the function falls through to a generic `"Cannot set review interval - project has no existing interval to modify"` error. Previously that loop error was discarded by an empty `} catch (e) {}` — even if other projects with intervals plainly existed. Now the underlying cause is captured and appended to that error message as `(template lookup failed: <reason>)`. On every success path (steps 1 or 2 completing cleanly) the behaviour is **identical to before**.

The central thing this smoke test confirms is the **regression case**: setting a review interval on real projects continues to work exactly as it did. The new error-suffix path is exotic and not expected to trigger on a healthy database; TC4 is included for completeness.

---

## Setup (do this once before the test cases)

1. **Build this branch** so the MCP server runs v1.30.12:
   ```bash
   cd /Users/mojen/dev/of-mcp
   git checkout fix/issue-110-phase4-review-interval-error
   npm run build
   ```
2. **Point your MCP client at this build** (`dist/server.js` in this repo) and **restart the session** so it loads the new build. If you normally use the published/`main` server, switch it to this repo's `dist/server.js` for the test.
3. Have OmniFocus running with your normal database. Ideally have at least one project that already has a review interval set, and (optionally) one that does not.

---

## TC1 — Version gate (must pass before anything else)

**Why:** confirms you're testing this branch's build, not an older one.

**Do:** ask Claude to run the `get_server_version` tool.

**Expect:** the returned JSON has `"version": "1.30.12"`.

- [ ] **PASS** — version is `1.30.12`
- [ ] **FAIL** — any other version (stop; you're testing the wrong build — revisit Setup)

---

## TC2 — Set `newReviewInterval` on a project that already has one (primary regression check)

**Do:** pick a project that already has a review interval (e.g. one shown in `get_projects_for_review`), then ask Claude something like *"Change the review interval on project `<name>` to 14 days"* → `edit_item` with `itemType: "project"`, `name: "<that project>"`, `newReviewInterval: 14`.

**Expect:**
- `success: true` (or the rendered "updated" confirmation), with `changedProperties` mentioning **`review interval`**.
- `get_project_by_id` on the same project afterwards shows `Review Interval: 14 days` (or your chosen value).
- **No mention of "template lookup failed".**

**Pass criteria:** the existing-interval branch (step 1 in the internal logic) is taken and the operation succeeds exactly as it did pre-change.

- [ ] **PASS** — interval changed; no template-lookup wording
- [ ] **FAIL** — error, or any unexpected wording (record output)

**Cleanup:** if you don't want to leave the changed interval, set it back to its previous value with another `edit_item` call.

---

## TC3 — Set `newReviewInterval` on a project that has *no* interval, when another project does (template-path regression)

**Why:** this is the path that actually exercises the catch block we modified. We are confirming the loop runs cleanly when at least one other project has an interval (it finds one, breaks, no throw).

**Do:** pick (or create) a project that has **no review interval** but where at least one OTHER project in your database does. Ask Claude *"Set the review interval on project `<name>` to 7 days"* → `edit_item` with `newReviewInterval: 7` on that project.

**Expect:**
- `success: true`, `changedProperties` mentions **`review interval`**.
- The project afterwards reports `Review Interval: 7 days`.
- **No mention of "template lookup failed".**

If you don't have a convenient project without an interval to test against, create a fresh test project, leave its review interval unset, then run this test on it (and delete or revert afterwards).

- [ ] **PASS** — template path succeeded; no template-lookup wording
- [ ] **FAIL** — error or template-lookup wording (record output and which projects were involved)

---

## TC4 — (Optional) The error wording on the "no template available" path

**Why:** this is the *new* error wording. It triggers only when `reviewInterval` ends up `null` after the lookup — i.e. neither the target project nor any other project has a review interval. On a database with active reviews this path is hard to set up legitimately; skip if you can't construct it.

**Do (if reproducible):** in a scratch database (or by temporarily removing every review interval — not recommended on your real DB), call `edit_item` with `newReviewInterval` on any project.

**Expect:** an error of the form:

```
Cannot set review interval - project has no existing interval to modify
```

(i.e. **no** `(template lookup failed: …)` suffix) — because the loop completed cleanly and simply found no candidate. The new suffix only appears if the loop *threw*, which is the exotic case below.

- [ ] **PASS** — exact wording above (no suffix)
- [ ] n/a — not reproducible on this database
- [ ] **FAIL** — different wording (record it)

---

## TC5 — (Informational) The actual template-lookup-throw path

You are **not expected to be able to trigger this** on a healthy database — it fires only when iterating `flattenedProjects` and reading a project's `.reviewInterval` actually throws (corrupted state, Bridge proxy hiccup). Do **not** treat a non-appearance as a failure.

**If it ever does trigger,** the error message will look like:

```
Cannot set review interval - project has no existing interval to modify (template lookup failed: <reason>)
```

If you see this in normal use, capture the full error and the project that triggered it — that's a genuine signal that the loop hit a real read failure.

- [ ] Not triggered (expected on a healthy DB)
- [ ] Triggered — captured output for follow-up

---

## Optional — server log check

If you can view the MCP server's stderr/log output, no special `log.warn` lines are added by this change. The improved error message simply flows through the existing `editItem` error path; the primitive's existing `log.error` records it as before.

---

## Red flags (treat as FAIL)

- TC2 or TC3 produces an error where they used to succeed (regression).
- The error wording mentions "template lookup failed" on a database where you have no reason to believe the loop threw (likely instrumentation bug).
- `get_server_version` ≠ `1.30.12` → you tested the wrong build; redo Setup.

---

## Results

| Test | Result | Notes |
|------|--------|-------|
| TC1 Version gate | ☐ PASS ☐ FAIL | |
| TC2 Set interval on project that has one | ☐ PASS ☐ FAIL | |
| TC3 Set interval via template-path (regression) | ☐ PASS ☐ FAIL | |
| TC4 "No template available" wording | ☐ PASS ☐ n/a ☐ FAIL | |
| TC5 Template-lookup-throw path (informational) | ☐ n/a ☐ triggered | |

**Overall:** ☐ PASS (TC1–TC3 all pass) ☐ FAIL

**Run:** _(fill in date / tester / build under test)_

---

## Notes — what's already been verified without OmniFocus

- `npm run build` compiles cleanly; `node --check` passes on the edited `editItem.js`.
- The error-message rendering is pure string concatenation in the script — no new TS-layer code paths to verify separately.
