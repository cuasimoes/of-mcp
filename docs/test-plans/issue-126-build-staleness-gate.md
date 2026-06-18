# Smoke Test — Issue #126 (Build freshness gate for `get_server_version`)

**Branch:** `emdash/feat-build-staleness-gate`
**Version under test:** `1.33.0`
**Tool affected:** `get_server_version` (returns `build.buildStale` and `build.commit` fields)
**Run in:** a Claude Code (or other MCP client) session connected to **OmniFocus** on macOS.

---

## What changed (context for the tester)

Before this change, verifying that the running MCP server matched the intended code required manually confirming multiple layers: rebuilding after edits, committing changes, and restarting the client. A version number match to `package.json` was insufficient; the running code could be stale, the committed build could be from an older branch, or the process could have loaded a previous build. This made test results ambiguous.

The fix is a three-layer build-freshness gate implemented via the `build` block returned by `get_server_version`, which now surfaces three independent checks:
1. **Disk-behind-source**: detects uncommitted edits by comparing mtime of changed `src/*.ts` files against `dist/server.js`.
2. **Wrong/old committed build**: detects branch mismatch by comparing `build.commit` (SHA from committed `dist/build-info.json`) against `git rev-parse --short HEAD`.
3. **Process-behind-disk**: detects unstarted/restarted process by comparing `build.buildStale` against whether the running bundle hash matches the disk build.

The three failure modes are operationally distinct—a single check misses categories of staleness. Only when all three pass can you trust that the running code is the intended code. The version number alone is informational; the `build` object's three fields are the real gate.

---

## Setup (do this once before the test cases)

1. **Build this branch** so the MCP server runs v1.33.0:
   ```bash
   cd /Users/mojen/dev/of-mcp
   git checkout emdash/feat-build-staleness-gate
   npm run build
   ```
2. **Point your MCP client at this build** (`dist/server.js` in this repo) and **restart the session** so it loads the new build. Schema changes live in the TypeScript layer, so a server restart is required — `.js` script hot-reload alone is not enough.
3. Have OmniFocus running with your normal database.

### Build freshness gate

After building and restarting, confirm the running code is fresh with these three complementary checks. The version number alone proves nothing about the running code, and the three failure modes are distinct, so all three checks are required:

> **1. Disk-behind-source (did you rebuild after editing?).** For each `src/*.ts` you changed, confirm `dist/server.js` is newer:
> ```bash
> stat -f "%m %N" src/tools/definitions/editItem.ts dist/server.js   # substitute the file(s) you edited
> ```
> If any edited source is newer than `dist/server.js`, the build is stale on disk — run `npm run build:fast` before testing. (This is issue #126's fix #1; it is the only check that inspects source, and it catches uncommitted edits the `commit` check cannot.)
>
> **2. Wrong/old committed build (are you on the intended branch?).** Call `get_server_version` and confirm `build.commit` equals `git rev-parse --short HEAD` for the branch under test. A mismatch means you built/are testing the wrong (committed) state.
>
> **3. Process-behind-disk (did you restart after rebuilding?).** Confirm `build.buildStale === false`. `true` means your client is running a **process started before the latest build** (or mid-build) — restart it. `buildStale: false` only means "process matches disk," not "disk matches source" — checks 1 and 2 cover that.

---

## TC1 — Version gate (must pass before anything else)

**Why:** confirms you're testing this branch's build, not an older one. However, version matching alone is not sufficient (see the Note at end of this plan).

**Do:** ask Claude to run the `get_server_version` tool.

**Expect:** the returned JSON has `"version": "1.33.0"`.

- [ ] **PASS** — version is `1.33.0`
- [ ] **FAIL** — any other version (stop; you're testing the wrong build — revisit Setup)

---

## TC2 — Build-loaded gate (the real freshness check)

**Why:** on a freshly restarted client, both `build.commit` and `build.buildStale` must indicate that the running process matches the current branch's HEAD and the disk build. This is the operational gate; TC1 is merely informational.

**Do:** after a fresh MCP client restart (following Setup's rebuild), call `get_server_version`.

**Expect:**
- `version` is `1.33.0` (same as TC1).
- `build.commit` equals the output of `git rev-parse --short HEAD` on the current branch (if mismatch, the server is running a build from a different branch or commit).
- `build.buildStale` is `false` (meaning the running process matches the disk build; `true` would mean restart is needed).
- All three Build freshness gate checks above pass.

**Pass criteria:** the running server provably matches both the current source and the current process state.

- [ ] **PASS** — all three fields correct; Build freshness gate checks pass
- [ ] **FAIL** — version mismatch, `build.commit` mismatch, `build.buildStale === true`, or freshness gate check fails (record output and which check failed)

---

## TC3 — Staleness detection (process-behind-disk detection)

**Why:** confirms the `buildStale` flag detects when a process is running the old code after a rebuild—a common tester mistake.

**Do:**
1. Without restarting the client, edit a file in `src/*.ts` (e.g. add a comment to `src/tools/definitions/editItem.ts`).
2. Run `npm run build:fast` to rebuild `dist/server.js`.
3. Call `get_server_version` (the running client still has the old process).
4. Verify `build.buildStale === true`.
5. Restart the MCP client (reconnect the session).
6. Call `get_server_version` again.
7. Verify `build.buildStale === false`.

**Expect:**
- After step 3: `build.buildStale === true` (process is stale; running the old bundle).
- After step 6: `build.buildStale === false` (restart fixed it; running matches disk now).

**Pass criteria:** staleness is detected when the process is out-of-date, and cleared after a restart.

- [ ] **PASS** — `buildStale` transitions `true` → `false` across restart
- [ ] **FAIL** — `buildStale` stays `false` after rebuild (detection not working), or doesn't transition back to `false` after restart (record output)

---

## TC4 — Graceful degradation (missing build-info.json)

**Why:** builds before issue #126's fix do not include `dist/build-info.json`. The tool should still return useful fields without crashing if `build-info.json` is absent or malformed.

**Do:**
1. (Optional: check out an older branch or manually delete `dist/build-info.json` to simulate a pre-126 build.)
2. Call `get_server_version`.

**Expect:**
- `version` is still present (read from `package.json`).
- `build.commit` is `"unknown"` (the file doesn't exist to provide it).
- `build.buildStale` may be `null` (no saved hash to compare against) or still attempt to detect process-behind-disk from the bundle hash (either is acceptable graceful degradation).
- No error is thrown; the tool returns the other fields without crashing.

**Pass criteria:** missing or malformed build metadata does not break the tool.

- [ ] **PASS** — tool returns gracefully; `version` is present; `build.commit === "unknown"`
- [ ] **FAIL** — tool throws an error, or returns no `version`, or behaves unexpectedly (record output)

---

## Note

The behaviour-asserting test case (TC2, TC3, and TC4 combined) is the real build-loaded gate. The version number (TC1) is informational only. A version match is necessary but not sufficient—as evidenced by TC3, the running code can report the correct version while still executing stale bytecode. Always run TC2's full freshness gate (including the three explicit checks) before interpreting test results as evidence of code correctness.

---

## Results

| Test | Result | Notes |
|------|--------|-------|
| TC1 Version gate | ☐ PASS ☐ FAIL | `get_server_version` → version `1.33.0` |
| TC2 Build-loaded gate | ☐ PASS ☐ FAIL | `build.commit` matches `git rev-parse --short HEAD`; `build.buildStale === false`; all three freshness gate checks pass |
| TC3 Staleness detection | ☐ PASS ☐ FAIL | After rebuild (no restart): `build.buildStale === true`; after restart: `build.buildStale === false` |
| TC4 Graceful degradation | ☐ PASS ☐ FAIL | Tool returns without error; `build.commit === "unknown"`; `version` still present |

**Overall:** ☐ PASS ☐ FAIL
