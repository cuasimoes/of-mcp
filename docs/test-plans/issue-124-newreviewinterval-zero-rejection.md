# Smoke Test — Issue #124 (`edit_item` `newReviewInterval` must be a positive integer)

**Branch:** `fix/issue-124-reject-zero-review-interval`
**Version under test:** `1.30.13`
**Tool affected:** `edit_item` (only when called with `newReviewInterval`)
**Run in:** a Claude Code (or other MCP client) session connected to **OmniFocus** on macOS.

---

## What changed (context for the tester)

Before this change, `edit_item(itemType: "project", newReviewInterval: 0)` returned a `success: true` tool result while OmniFocus silently refused the underlying assignment — the project's review interval, next-review date, and last-reviewed date were byte-identical to before the call, but the response read `✅ Project "<name>" updated successfully (review interval)`. The misleading success made a failed clear-attempt indistinguishable from a real update.

The fix is a single Zod-schema tightening at the MCP boundary. The `newReviewInterval` field is now constrained to **positive integers** — Zod rejects `0`, negatives, and non-integers (e.g. `1.5`) before the `edit_item` handler runs. All three failure cases share the error message `"newReviewInterval must be a positive integer"`.

**Important error-surface detail.** Because the rejection happens in the MCP SDK's `safeParseAsync` before `editItem`'s handler runs, the failure surfaces as an **MCP `InvalidParams` protocol error**, *not* a tool result with `isError: true` and not a `{ success: false, error: "…" }` shape from `editItem.js`. In Claude this typically materialises as an "Error calling tool" message containing a JSON-stringified Zod issues array; the substring `"newReviewInterval must be a positive integer"` will appear inside that array, but the wrapper is the SDK's, not ours. Only TC5 (the regression check) produces a normal tool-result `success: true` response.

`editItem.js` itself is unchanged — the silent-success line (`reviewInterval.steps = 0` at script line 419) is still in place but is no longer reachable from the MCP, because the bad value never arrives.

---

## Setup (do this once before the test cases)

1. **Build this branch** so the MCP server runs v1.30.13:
   ```bash
   cd /Users/mojen/dev/of-mcp
   git checkout fix/issue-124-reject-zero-review-interval
   npm run build
   ```
2. **Point your MCP client at this build** (`dist/server.js` in this repo) and **restart the session** so it loads the new build. Schema changes live in the TypeScript layer, so a server restart is required — `.js` script hot-reload alone is not enough.
3. Have OmniFocus running with your normal database. Any project (existing or newly created) is fine; TC5 walks you through creating a scratch project so nothing in your live data gets touched.

---

## TC1 — Version gate (must pass before anything else)

**Why:** confirms you're testing this branch's build, not an older one.

**Do:** ask Claude to run the `get_server_version` tool.

**Expect:** the returned JSON has `"version": "1.30.13"`.

- [ ] **PASS** — version is `1.30.13`
- [ ] **FAIL** — any other version (stop; you're testing the wrong build — revisit Setup)

---

## TC2 — Reject `newReviewInterval: 0` (the reported bug)

**Do:** create a scratch project for safety, then attempt the bug-trigger call:

```
add_project(name: "issue-124-validation-test")
   → captures project id, e.g. <pid>

edit_item(itemType: "project", id: "<pid>", newReviewInterval: 0)
```

**Expect:**
- An **MCP `InvalidParams`** protocol error (in Claude, typically a red-flagged "Error calling tool" surface, not a normal tool result).
- The error payload contains the string `"newReviewInterval must be a positive integer"`.
- **No** `✅ Project "..." updated successfully` text appears.
- `get_project_by_id("<pid>")` afterwards still shows `Review Interval: 7 days` (the `add_project` default) — the call was rejected, not no-op'd.

**Pass criteria:** the misleading success is gone; the caller now sees an explicit rejection.

- [ ] **PASS** — `InvalidParams` error with the expected substring; project state unchanged
- [ ] **FAIL** — tool returns success, or no error, or unexpected wording (record output)

---

## TC3 — Reject `newReviewInterval: -5` (negative integer)

**Why:** same code path, broader-domain check. Confirms the rejection covers the whole "not a positive integer" class, not just literal `0`.

**Do:**

```
edit_item(itemType: "project", id: "<pid>", newReviewInterval: -5)
```

**Expect:** identical to TC2 — `InvalidParams` error containing `"newReviewInterval must be a positive integer"`; project state still shows the previous interval.

- [ ] **PASS** — same error surface as TC2
- [ ] **FAIL** — accepted, or different wording (record output)

---

## TC4 — Reject `newReviewInterval: 1.5` (non-integer)

**Why:** confirms the `.int()` constraint trips for fractional values, since OmniFocus's `reviewInterval.steps` is integer-typed and we don't want undefined-behaviour rounding through the bridge.

**Do:**

```
edit_item(itemType: "project", id: "<pid>", newReviewInterval: 1.5)
```

**Expect:** same as TC2 / TC3 — `InvalidParams` error containing `"newReviewInterval must be a positive integer"`; project state unchanged.

- [ ] **PASS** — same error surface as TC2
- [ ] **FAIL** — accepted (record what the resulting interval ended up being), or different wording

---

## TC5 — Set `newReviewInterval: 14` succeeds (regression check)

**Why:** the only positive integer the fix should still accept is, well, a positive integer. This confirms the happy path still works — that we haven't broken legitimate review-interval updates.

**Do:**

```
edit_item(itemType: "project", id: "<pid>", newReviewInterval: 14)
```

**Expect:**
- A **normal tool-result success** response (`✅ Project "issue-124-validation-test" updated successfully (review interval).` or equivalent), `success: true`, `changedProperties` mentioning `review interval`.
- `get_project_by_id("<pid>")` afterwards shows `Review Interval: 14 days` and the `Next Review` date has shifted accordingly.

**Pass criteria:** the existing-interval branch in `editItem.js` (the one that always worked) is unaffected by the schema change.

- [ ] **PASS** — success response; interval actually changed to 14 days
- [ ] **FAIL** — error, or interval didn't change (record output)

---

## Cleanup

Once the test cases are done, mark the scratch project as dropped (do **not** use `remove_item` — the "never delete" rule applies to test artefacts so cleanup remains recoverable):

```
edit_item(itemType: "project", id: "<pid>", newProjectStatus: "dropped")
```

If you'd rather keep it active, that's fine — but it serves no further purpose. A dropped project remains in the database and can be reactivated later if needed.

---

## Red flags (treat as FAIL)

- TC2, TC3, or TC4 returns a tool-result success (the rejection isn't firing — schema constraint not in effect; revisit Setup, particularly the restart).
- TC2, TC3, or TC4 returns a different error wording (the message strings on `.int()` / `.positive()` aren't being picked up — check the schema edit in `src/tools/definitions/editItem.ts:49`).
- TC5 regresses (legitimate positive integers are now being rejected — the `.optional()` is in the wrong place or the constraint is too tight).
- `get_server_version` ≠ `1.30.13` → you tested the wrong build; redo Setup.

---

## Results

| Test | Result | Notes |
|------|--------|-------|
| TC1 Version gate | ☑ PASS ☐ FAIL | `get_server_version` → `1.30.13` (branch `fix/issue-124-reject-zero-review-interval`) |
| TC2 Reject `0` | ☑ PASS ☐ FAIL | MCP `-32602` InvalidParams; Zod `code: "too_small"`, `inclusive: false`; message `"newReviewInterval must be a positive integer"`; project state byte-identical post-call |
| TC3 Reject `-5` | ☑ PASS ☐ FAIL | Same `.positive()` path as TC2 (`code: "too_small"`); same custom message; state unchanged |
| TC4 Reject `1.5` | ☑ PASS ☐ FAIL | Different Zod path: `.int()` (`code: "invalid_type"`, expected integer, received float); same custom message; state unchanged |
| TC5 `14` regression check | ☑ PASS ☐ FAIL | Normal success; `Review Interval` 7 → 14; `Next Review` correctly recomputed to 2026-06-09 |

**Overall:** ☑ PASS ☐ FAIL

**Run:** 2026-05-26 / MoJen (Claude Code, Seshat) / branch `fix/issue-124-reject-zero-review-interval` (fix uncommitted, working tree only), server v1.30.13. Two adjacent findings recorded below.

---

## Findings from run

### 1. Version gate alone is not sufficient evidence of a fresh build

The first TC2 attempt in this run reproduced the original #124 bug verbatim: `edit_item(newReviewInterval: 0)` returned `✅ Project "issue-124-validation-test" updated successfully (review interval).`, with `get_project_by_id` confirming a byte-identical no-op, despite `get_server_version` already reporting the target `1.30.13` at the time of the call. After running `npm run build` and reconnecting the MCP client, the retry passed cleanly with the expected `InvalidParams` rejection.

Root cause: `package.json`'s version can reach the running server via runtime read, independently of whether the TypeScript layer was actually recompiled. So `get_server_version` matching the target version is a necessary but insufficient gate. The test plan's existing Setup warning ("Schema changes live in the TypeScript layer, so a server restart is required — `.js` script hot-reload alone is not enough") is empirically vindicated.

Suggestion for a future iteration of this plan: either add a build-freshness diagnostic to Setup (e.g. compare `dist/server.js` mtime against `src/tools/definitions/editItem.ts` mtime), or treat TC2 itself as the operational gate. If TC2's rejection does not fire, the build is stale regardless of what TC1 reports.

### 2. Rejection error string is double-prefixed

The MCP errors returned on TC2/TC3/TC4 have the form:

```
MCP error -32602: MCP error -32602: Invalid arguments for tool edit_item: [ ...Zod issues array... ]
```

The `MCP error -32602:` token appears twice. The substring `"newReviewInterval must be a positive integer"` that the plan asks for is intact inside the Zod issues array, so this does not change the verdict. The doubled prefix is a cosmetic wrapping bug somewhere in the error-render path; could be the server's wrapping, the MCP SDK's wrapping, or the Claude client's. Worth filing as a separate low-priority issue if clean error surfaces are wanted.

---

## Notes — what's already been verified without OmniFocus

- `npm run build` compiles cleanly; the new Zod chain `z.number().int("…").positive("…").optional()` is well-formed in the installed Zod version (3.25.76).
- `batch_edit_items` does not expose `newReviewInterval` (verified in `src/tools/definitions/batchEditItems.ts:11-50` and confirmed by grep across the primitive + script). There is no second entry path that bypasses the new constraint.
- `server.ts` is the sole consumer of the `editItem` definition; nothing calls the primitive directly. The Zod boundary is therefore the *only* boundary, and the fix sits at the right layer.
