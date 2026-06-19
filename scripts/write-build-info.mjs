#!/usr/bin/env node
// Stamps dist/build-info.json with build provenance so get_server_version can
// report which build the running process loaded (issue #126). Run as a
// post-compile step in `build` and `build:fast`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist');
const bundlePath = join(distDir, 'server.js');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

const commit = git(['rev-parse', '--short', 'HEAD']) ?? 'unknown';

// dist/ is gitignored, so a rebuild never shows in `git status --porcelain`;
// a non-empty status therefore means uncommitted or untracked changes.
const status = git(['status', '--porcelain']);
const dirty = status === null ? null : status.length > 0;

let contentHash = null;
try {
  contentHash = 'sha256-' + createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
} catch (err) {
  console.warn(`write-build-info: could not hash ${bundlePath}: ${err.message}`);
}

const buildInfo = { commit, dirty, contentHash };
mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'build-info.json'), JSON.stringify(buildInfo, null, 2) + '\n');
console.log(`write-build-info: dist/build-info.json (${commit}${dirty ? ', dirty' : ''})`);
