# TypeScript Compiler OOM Troubleshooting

> **RESOLVED (issue #26).** The OOM had a single root cause — `"moduleResolution": "node"`
> in `tsconfig.json` — and it is fixed. `npm run typecheck` now completes in under a
> second. See [Root Cause](#root-cause-resolved) below.
>
> If you are hitting an OOM again, first check that `tsconfig.json` still sets
> `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`. Reverting either one
> reproduces the crash immediately. CI (`.github/workflows/ci.yml`) runs
> `npm run typecheck` on every PR, so a regression should not reach `main` silently.
>
> The rest of this document is kept for the diagnostic techniques, which are useful
> for any future compiler performance problem.

## Root Cause (resolved)

`tsconfig.json` used `"moduleResolution": "node"` — the legacy node10 algorithm, which
**ignores `package.json` `exports` maps**. That split zod into two declaration trees:

| import | resolved via | declaration tree |
| --- | --- | --- |
| our `import { z } from 'zod'` | zod's `types: "./index.d.cts"` field | `.d.cts` |
| the SDK's `import type * as z3 from 'zod/v3'` | directory walk to `zod/v3/index.d.ts` | `.d.ts` |

TypeScript therefore held two structurally identical but **distinct** copies of every
zod class. The MCP SDK's

```ts
type SchemaOutput<S> = S extends z3.ZodTypeAny ? z3.infer<S>
                     : S extends z4.$ZodType  ? z4.output<S> : never;
```

then had to compare the two deep recursive trees structurally for every key of every
tool schema — inside a four-way overload resolution on `McpServer.tool()`. That is
quadratic in schema size and repeated per registration.

Measured on `src/`:

| moduleResolution | wall | instantiations | result |
| --- | --- | --- | --- |
| `node` (old) | 56s | 10.4M **per `server.tool()` call** | OOM crash |
| `node16` | 0.8s | 111,430 | clean |
| **`nodenext`** (current) | **0.8s** | **111,430** | **clean** |
| `bundler` | 0.8s | 110,480 | clean |

It was never only a performance problem. Before the fix, `tsc` also emitted real
errors — `TS2589: Type instantiation is excessively deep and possibly infinite`,
followed by `TS2769: No overload matches this call` on every registration — because
overload resolution blew past the instantiation depth limit and then gave up.

Two things that made this hard to see, and are worth remembering:

- **Typechecking a single file resolved in about a second**, which pointed at
  whole-program resolution and away from any one file's types. That was right, but
  the cause was the *resolution mode*, not program size.
- The obvious suspects are all innocent here: `skipLibCheck` was already on, only
  `@types/node` is installed so there was no `types` scope to narrow, and the crash
  reproduced across TypeScript versions and heap sizes.

A related trap: `@modelcontextprotocol/sdk` requires `zod@^3.25 || ^4.0`, and zod
3.24 and earlier ship **no `./v3` subpath at all**. `package.json` must not declare a
zod floor below 3.25, or `zod/v3` fails to resolve outright.

## Legacy troubleshooting notes

The steps below were written while the cause was still unknown. They did not fix it —
`--extendedDiagnostics` and a bisect of `server.ts` did. Keep them for the commands.

## If tsc Hangs Completely (Even Diagnostics)

If tsc hangs and you can't even get diagnostics output, skip it entirely and use esbuild. This one-liner does a complete build:

```bash
npm install -D esbuild && npx esbuild src/server.ts --bundle --platform=node --outfile=dist/server.js --format=esm --external:@modelcontextprotocol/sdk --external:zod && mkdir -p dist/utils/omnifocusScripts/lib && cp src/utils/omnifocusScripts/*.js dist/utils/omnifocusScripts/ && cp src/utils/omnifocusScripts/lib/*.js dist/utils/omnifocusScripts/lib/ && chmod 755 dist/server.js
```

This takes ~1 second and produces a working build.

### Reset node_modules

A corrupted `node_modules` or mismatched lockfile can cause tsc to hang indefinitely during module resolution:

```bash
rm -rf node_modules package-lock.json && npm install
```

Then try `npm run build` again.

## Diagnosing Where tsc Hangs

If tsc runs but is slow, these commands help identify the bottleneck:

```bash
# Show detailed timing for each phase
npx tsc --extendedDiagnostics

# Show which files are being processed
npx tsc --listFiles

# Trace type resolution (very verbose)
npx tsc --traceResolution > trace.log 2>&1 &
sleep 30 && kill $!
head -1000 trace.log
```

If `--extendedDiagnostics` shows it's stuck on "Check time", the issue is complex type inference (likely from Zod or MCP SDK types).

## Quick Fixes

### 1. Increase Node.js Memory Limit

The default heap size may be too small. Run the build with more memory:

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

Or for even more memory (if available):

```bash
NODE_OPTIONS="--max-old-space-size=16384" npm run build
```

### 2. Enable Incremental Compilation

Add `"incremental": true` to `tsconfig.json` under `compilerOptions`:

```json
{
  "compilerOptions": {
    "incremental": true,
    ...
  }
}
```

This caches type information between builds, reducing memory usage on subsequent runs.

### 3. Close Other Applications

Free up RAM by closing browsers, IDEs, and other memory-intensive applications before building.

## Skip Type Checking (Fastest Workaround)

If you just need a working build and don't care about type errors, use esbuild (see below). It completely bypasses TypeScript's type checker and just transpiles the code.

## Alternative Build Methods

### Using esbuild (Fastest, Lowest Memory) - RECOMMENDED

Install and run esbuild as an alternative to tsc:

```bash
npm install -D esbuild

# Build the server
npx esbuild src/server.ts --bundle --platform=node --outfile=dist/server.js --format=esm --external:@modelcontextprotocol/sdk --external:zod

# Then copy the script files
mkdir -p dist/utils/omnifocusScripts/lib
cp src/utils/omnifocusScripts/*.js dist/utils/omnifocusScripts/
cp src/utils/omnifocusScripts/lib/*.js dist/utils/omnifocusScripts/lib/
```

Note: esbuild skips type checking entirely. Run `npx tsc --noEmit` separately if you need type validation.

### Using SWC

```bash
npm install -D @swc/cli @swc/core

npx swc src -d dist --strip-leading-paths
```

## Diagnostic Commands

Run these to understand your environment:

```bash
# Check available memory
free -h          # Linux
vm_stat          # macOS

# Check Node.js version
node -v

# Check current heap limit
node -e "console.log(v8.getHeapStatistics().heap_size_limit / 1024 / 1024 + ' MB')"

# Monitor memory during build
NODE_OPTIONS="--max-old-space-size=8192" npm run build &
top -p $!        # Linux
top -pid $!      # macOS
```

## System Requirements

This project requires:
- Node.js >= 18.0.0
- Recommended: 8GB+ RAM for comfortable builds
- Minimum: 4GB RAM (use memory limit increase)

## Try an Older TypeScript Version

TypeScript 5.8.x has been reported to have performance regressions. Try downgrading:

```bash
npm install -D typescript@5.6.3
npx tsc --version  # Verify it's 5.6.3
npm run build
```

## Why This Happened

**Superseded — see [Root Cause](#root-cause-resolved) at the top.**

This section previously blamed the intrinsic complexity of the
`@modelcontextprotocol/sdk` and `zod` generic types, and suggested TypeScript 5.8's
inference changes made it worse. Both were wrong, and both sent several
investigations down dead ends. The SDK and zod types are fine; a duplicated zod
declaration tree, caused by legacy module resolution, is what made comparing them
unbounded. The crash reproduced on every TypeScript version tried.
