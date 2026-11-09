import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowestBitrateLevelIndex } from '../src/player/hls-levels.js';

test('picks the lowest bitrate regardless of manifest order', () => {
  const descending = [
    { bitrate: 3170000 },
    { bitrate: 2960000 },
    { bitrate: 1660000 },
    { bitrate: 929000 },
    { bitrate: 423000 },
  ];
  assert.equal(lowestBitrateLevelIndex(descending), 4);
  assert.equal(lowestBitrateLevelIndex([...descending].reverse()), 0);
});

test('handles empty and incomplete level lists', () => {
  assert.equal(lowestBitrateLevelIndex([]), -1);
  assert.equal(lowestBitrateLevelIndex(null), -1);
  assert.equal(lowestBitrateLevelIndex([{}, { bitrate: 128000 }]), 1);
  assert.equal(
    lowestBitrateLevelIndex([{ bitrate: 900000 }, { bitrate: undefined }, { bitrate: 320000 }]),
    2,
  );
});
