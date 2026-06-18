import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBuildStale, shapeBuildBlock } from '../dist/test-build/buildInfo.mjs';

test('computeBuildStale: process matches disk and stamp -> fresh', () => {
  assert.equal(computeBuildStale('sha256-aaa', 'sha256-aaa', 'sha256-aaa'), false);
});

test('computeBuildStale: process behind disk -> stale', () => {
  assert.equal(computeBuildStale('sha256-aaa', 'sha256-bbb', 'sha256-aaa'), true);
});

test('computeBuildStale: loaded mid-build (stamp != loaded bundle) -> stale', () => {
  // bundle written (new) but stamp still describes the previous build
  assert.equal(computeBuildStale('sha256-new', 'sha256-new', 'sha256-old'), true);
});

test('computeBuildStale: a null loaded/current hash means unknown', () => {
  assert.equal(computeBuildStale(null, 'sha256-bbb', 'sha256-bbb'), null);
  assert.equal(computeBuildStale('sha256-aaa', null, 'sha256-aaa'), null);
});

test('computeBuildStale: a missing stamp does not by itself mean stale', () => {
  assert.equal(computeBuildStale('sha256-aaa', 'sha256-aaa', null), false);
});

test('shapeBuildBlock: full raw + matching hashes -> fresh', () => {
  const block = shapeBuildBlock({
    raw: { commit: 'abc1234', dirty: false, contentHash: 'sha256-aaa' },
    loadedHash: 'sha256-aaa',
    currentHash: 'sha256-aaa',
  });
  assert.deepEqual(block, {
    commit: 'abc1234', dirty: false, contentHash: 'sha256-aaa', buildStale: false,
  });
});

test('shapeBuildBlock: missing build-info falls back to unknown/null', () => {
  const block = shapeBuildBlock({ raw: null, loadedHash: null, currentHash: null });
  assert.deepEqual(block, {
    commit: 'unknown', dirty: null, contentHash: null, buildStale: null,
  });
});

test('shapeBuildBlock: no stamp but bundle present still detects process-behind-disk', () => {
  const block = shapeBuildBlock({ raw: null, loadedHash: 'sha256-aaa', currentHash: 'sha256-bbb' });
  assert.equal(block.commit, 'unknown');
  assert.equal(block.buildStale, true);
});

test('shapeBuildBlock: stamp present with null contentHash + matching hashes -> fresh', () => {
  const block = shapeBuildBlock({
    raw: { commit: 'abc1234', dirty: false, contentHash: null },
    loadedHash: 'sha256-aaa',
    currentHash: 'sha256-aaa',
  });
  assert.deepEqual(block, {
    commit: 'abc1234', dirty: false, contentHash: null, buildStale: false,
  });
});

test('shapeBuildBlock: process behind disk is flagged stale', () => {
  const block = shapeBuildBlock({
    raw: { commit: 'abc1234', dirty: true, contentHash: 'sha256-aaa' },
    loadedHash: 'sha256-aaa',
    currentHash: 'sha256-bbb',
  });
  assert.equal(block.buildStale, true);
  assert.equal(block.dirty, true);
});
