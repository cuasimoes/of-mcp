#!/usr/bin/env node
// Timezone-sensitive unit tests for the pure date helpers in src/utils/dateUtils.ts.
//
// These functions are pure but timezone-dependent: the bug they guard against
// (a bare "YYYY-MM-DD" parsed as UTC midnight, then displayed one day early in
// UTC- zones) is invisible to any UTC-based run, including CI. So every
// timezone-relevant assertion is run under both a UTC- zone (America/Los_Angeles)
// and a UTC+ zone (Australia/Sydney) and checks for *invariance* across them,
// rather than pinning a locale-specific string (which would itself be the same
// class of bug this suite exists to catch).
//
// Run via `npm test` (alias for test:unit): esbuild bundles dateUtils.ts to
// dist/test-build/dateUtils.mjs first, then node:test runs this file. Invoking
// `node --test` on this file directly fails until that bundle exists.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalDate,
  formatDateSafe,
  classifyForecastDate,
} from '../dist/test-build/dateUtils.mjs';

const UTC_MINUS = 'America/Los_Angeles';
const UTC_PLUS = 'Australia/Sydney';

// Node re-reads TZ when process.env.TZ is assigned (tzset), so we can switch
// zones within a single process. Restore the prior value afterwards.
function withTZ(zone, fn) {
  const prev = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

// classifyForecastDate takes a Date; forecast keys reach it via parseLocalDate
// (which is the timezone-sensitive step). This mirrors how getForecastTasks calls it.
const classifyKey = (key, now) => classifyForecastDate(parseLocalDate(key), now);

test('classifyForecastDate: a date key lands in the right bucket in both zones', () => {
  for (const zone of [UTC_MINUS, UTC_PLUS]) {
    withTZ(zone, () => {
      // A fixed local "now" keeps this deterministic regardless of the wall clock.
      const now = new Date(2026, 3, 28, 23, 30); // local 2026-04-28 23:30
      assert.equal(classifyKey('2026-04-28', now), 'TODAY', `zone=${zone}`);
      assert.equal(classifyKey('2026-04-27', now), 'OVERDUE', `zone=${zone}`);
      assert.equal(classifyKey('2026-04-29', now), 'TOMORROW', `zone=${zone}`);
      assert.equal(classifyKey('2026-05-10', now), 'FUTURE', `zone=${zone}`);
    });
  }
});

test('classifyForecastDate: TOMORROW survives DST transitions (America/Los_Angeles)', () => {
  withTZ(UTC_MINUS, () => {
    // Spring forward: 2026-03-08 is a 23-hour local day, so next-midnight is +23h.
    assert.equal(classifyKey('2026-03-09', new Date(2026, 2, 8, 12, 0)), 'TOMORROW', 'spring forward');
    // Fall back: 2026-11-01 is a 25-hour local day, so next-midnight is +25h.
    assert.equal(classifyKey('2026-11-02', new Date(2026, 10, 1, 12, 0)), 'TOMORROW', 'fall back');
  });
});

test('formatDateSafe: bare date renders as local Apr 28 in both zones', () => {
  // Locale-robust: compare against the locale's own rendering of local Apr 28,
  // not a hard-coded "28", so the assertion holds under any locale/digit system.
  const expected = withTZ(UTC_MINUS, () => new Date(2026, 3, 28).toLocaleDateString());
  const la = withTZ(UTC_MINUS, () => formatDateSafe('2026-04-28'));
  const syd = withTZ(UTC_PLUS, () => formatDateSafe('2026-04-28'));

  assert.equal(la, syd);      // zone-invariant
  assert.equal(la, expected); // local Apr 28, not slipped back to the 27th
});

test('formatDateSafe: full ISO string still uses the general (fallback) path', () => {
  const iso = '2026-04-28T07:30:00Z';
  for (const zone of [UTC_MINUS, UTC_PLUS]) {
    withTZ(zone, () => {
      // Equality with a direct Date(iso) format proves the ISO input is NOT
      // routed through the bare-date branch — the #114 fallback is preserved.
      assert.equal(formatDateSafe(iso), new Date(iso).toLocaleDateString(), `zone=${zone}`);
    });
  }
});

test('formatDateSafe: malformed input returns null', () => {
  assert.equal(formatDateSafe('2026-13-45'), null);
  assert.equal(formatDateSafe(''), null);
  assert.equal(formatDateSafe(null), null);
  assert.equal(formatDateSafe(undefined), null);
});

test('parseLocalDate: bare date yields local midnight', () => {
  const d = parseLocalDate('2026-04-28');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 3); // April, zero-based
  assert.equal(d.getDate(), 28);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test('parseLocalDate: full ISO string parses via Date constructor', () => {
  const d = parseLocalDate('2026-04-28T07:30:00Z');
  assert.ok(d instanceof Date);
  assert.equal(d.getTime(), new Date('2026-04-28T07:30:00Z').getTime());
});

test('parseLocalDate: years 0-99 round-trip (no 1900s mapping)', () => {
  const d = parseLocalDate('0099-01-01');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 99); // not 1999
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 1);
});

test('parseLocalDate: well-shaped but invalid dates return null', () => {
  assert.equal(parseLocalDate('2026-13-45'), null); // month/day overflow
  assert.equal(parseLocalDate('2026-02-30'), null); // Feb 30 rolls forward
});

test('parseLocalDate: falsy and unparseable input returns null', () => {
  assert.equal(parseLocalDate(''), null);
  assert.equal(parseLocalDate(null), null);
  assert.equal(parseLocalDate(undefined), null);
  assert.equal(parseLocalDate('not-a-date'), null);
});
