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
3. Have OmniFocus running with your normal database. At least one project with a review interval set is enough for TC2 (the only runnable test on a healthy DB). TC3 / TC4 require a project with *no* review interval, which is **not constructible via the MCP** on a normal database — see the TC3 note.

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

## TC3 — Set `newReviewInterval` on a project that has *no* interval (template-path regression) — **n/a via MCP**

**Why:** this would exercise the template-search loop inside the catch we modified — confirming the loop runs cleanly when at least one other project has an interval (it finds one, breaks, no throw).

**Reality check:** on a healthy database this precondition is **not constructible via the MCP surface**:
- Every existing project already has a review interval.
- `add_project` auto-assigns a default review interval (e.g. 7 days) to new projects.
- `edit_item` with `newReviewInterval: 0` no-ops without clearing the interval (separate bug, worth its own issue).

The template-success code path is therefore unreachable from the MCP today on a normal DB, so TC3 is not runnable as written. If the path ever does become reachable (e.g. an OmniFocus database created or modified outside the MCP that contains a project with a null interval), the expected behaviour is: `success: true`, `changedProperties` mentions `review interval`, the project afterwards reports the new interval, and there is **no** `template lookup failed` wording.

- [ ] **PASS** — template path succeeded; no template-lookup wording
- [ ] **n/a** — precondition unconstructible via MCP (expected on a normal DB)
- [ ] **FAIL** — error or template-lookup wording (record output and which projects were involved)

---

## TC4 — The error wording on the "no template available" path — **n/a via MCP**

**Why:** this is the *new* error wording. It triggers only when `reviewInterval` ends up `null` after the lookup — i.e. neither the target project nor any other project has a review interval.

**Reality check:** same root cause as TC3 — the precondition is **not constructible via the MCP surface** on a normal DB (every project has an interval; `add_project` auto-assigns; `newReviewInterval: 0` no-ops). So this case is not runnable through the MCP today.

If the path ever does fire, the expected wording is:

```
Cannot set review interval - project has no existing interval to modify
```

(i.e. **no** `(template lookup failed: …)` suffix) — because the loop completed cleanly and simply found no candidate. The new suffix only appears if the loop *threw*, which is the exotic case below.

- [ ] **PASS** — exact wording above (no suffix)
- [ ] **n/a** — precondition unconstructible via MCP (expected on a normal DB)
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
| TC1 Version gate | ☑ PASS ☐ FAIL | `get_server_version` → `1.30.12` (branch `fix/issue-110-phase4-review-interval-error` @ `7cd932a`) |
| TC2 Set interval on project that has one | ☑ PASS ☐ FAIL | Round-trip 7 → 14 → 7 on a scratch project; next-review date recomputed and restored correctly; no `template lookup failed` text |
| TC3 Set interval via template-path (regression) | ☐ PASS ☐ FAIL  **n/a** | Precondition unconstructible: every project has a review interval (UI confirms; `add_project` auto-assigns 7 days; `newReviewInterval: 0` no-ops). Template-success path is unreachable on a healthy DB via this MCP surface |
| TC4 "No template available" wording | ☐ PASS ☑ n/a ☐ FAIL | Same root cause as TC3 |
| TC5 Template-lookup-throw path (informational) | ☑ n/a ☐ triggered | Not triggered (expected on healthy DB); fix is defensive against the throw path, which is the only user-visible code change this release |

**Overall:** ☑ PASS (TC1–TC2; TC3/TC4 n/a, see notes) ☐ FAIL

**Run:** 2026-05-26 / MoJen (Claude Code session) / branch `fix/issue-110-phase4-review-interval-error` @ `7cd932a`, server v1.30.12. Adjacent finding: `edit_item(newReviewInterval: 0)` reports success while no-op'ing; to be filed as its own issue (not in scope for this PR). TC3 / TC4 wording in plan body revised to acknowledge the precondition is not constructible via the MCP on a normal DB.

---

## Notes — what's already been verified without OmniFocus

- `npm run build` compiles cleanly; `node --check` passes on the edited `editItem.js`.
- The error-message rendering is pure string concatenation in the script — no new TS-layer code paths to verify separately.
