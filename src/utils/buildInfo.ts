import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

export interface BuildInfoRaw {
  commit?: string;
  dirty?: boolean | null;
  contentHash?: string | null;
}

export interface BuildBlock {
  commit: string;
  dirty: boolean | null;
  contentHash: string | null;
  buildStale: boolean | null;
}

// --- pure helpers (unit-tested) ---

export function computeBuildStale(
  loadedHash: string | null,
  currentHash: string | null,
  stampHash: string | null
): boolean | null {
  if (loadedHash === null || currentHash === null) return null; // can't assess
  if (loadedHash !== currentHash) return true;                  // process behind disk
  if (stampHash !== null && stampHash !== loadedHash) return true; // started mid-build
  return false;
}

export function shapeBuildBlock(args: {
  raw: BuildInfoRaw | null;
  loadedHash: string | null;
  currentHash: string | null;
}): BuildBlock {
  const { raw, loadedHash, currentHash } = args;
  const stampHash = raw?.contentHash ?? null;
  return {
    commit: raw?.commit ?? 'unknown',
    dirty: raw?.dirty ?? null,
    contentHash: stampHash,
    buildStale: computeBuildStale(loadedHash, currentHash, stampHash),
  };
}

// --- impure resolution + module-load capture ---

function resolveRepoRoot(): string | null {
  // Mirrors getServerVersion's package.json resolution: works for the esbuild
  // bundle (dist/server.js -> ../package.json) and tsc output
  // (dist/utils/buildInfo.js -> ../../package.json).
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, '..', 'package.json'),
      join(here, '..', '..', 'package.json'),
      join(here, '..', '..', '..', 'package.json'),
    ];
    const found = candidates.find(p => existsSync(p));
    return found ? dirname(found) : null;
  } catch {
    return null;
  }
}

function hashBundle(repoRoot: string | null): string | null {
  if (!repoRoot) return null;
  try {
    const buf = readFileSync(join(repoRoot, 'dist', 'server.js'));
    return 'sha256-' + createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

function readRaw(repoRoot: string | null): BuildInfoRaw | null {
  if (!repoRoot) return null;
  try {
    return JSON.parse(readFileSync(join(repoRoot, 'dist', 'build-info.json'), 'utf-8')) as BuildInfoRaw;
  } catch {
    return null;
  }
}

// Captured ONCE at module load === process start.
const repoRoot = resolveRepoRoot();
const loadedRaw = readRaw(repoRoot);
const loadedHash = hashBundle(repoRoot);

export function getBuildBlock(): BuildBlock {
  const currentHash = hashBundle(repoRoot); // re-hash at call time
  return shapeBuildBlock({ raw: loadedRaw, loadedHash, currentHash });
}
