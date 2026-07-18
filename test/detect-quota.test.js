import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remaining, nextCount, DETECT_DAILY_LIMIT } from '../src/features/detect-quota.js';

test('remaining: fresh day resets regardless of stored count', () => {
  assert.equal(remaining({ date: '2026-07-17', count: 9 }, '2026-07-18', 10), 10);
});
test('remaining: same day subtracts, floors at 0', () => {
  assert.equal(remaining({ date: '2026-07-18', count: 3 }, '2026-07-18', 10), 7);
  assert.equal(remaining({ date: '2026-07-18', count: 99 }, '2026-07-18', 10), 0);
});
test('remaining: missing rec → full limit', () => {
  assert.equal(remaining(undefined, '2026-07-18', 10), 10);
});
test('nextCount: same day increments, new day restarts at 1', () => {
  assert.deepEqual(nextCount({ date: '2026-07-18', count: 3 }, '2026-07-18'), { date: '2026-07-18', count: 4 });
  assert.deepEqual(nextCount({ date: '2026-07-17', count: 3 }, '2026-07-18'), { date: '2026-07-18', count: 1 });
});
test('DETECT_DAILY_LIMIT matches the server device default', () => {
  assert.equal(DETECT_DAILY_LIMIT, 10);
});
