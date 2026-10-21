import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HISTORY_LIMIT,
  addToHistory,
  historyEntry,
} from '../src/data/history.js';

const station = (id, extra = {}) => ({
  id,
  name: `Station ${id}`,
  url: `https://example.com/${id}`,
  ...extra,
});

test('historyEntry snapshots the station without sharing the object', () => {
  const source = station('a', { countrycode: 'DE' });
  const entry = historyEntry(source);
  assert.deepEqual(entry, source);
  assert.notStrictEqual(entry, source);
});

test('historyEntry ignores invalid stations', () => {
  assert.equal(historyEntry(null), null);
  assert.equal(historyEntry({ name: 'No id' }), null);
});

test('addToHistory puts the newest station first', () => {
  const first = addToHistory([], station('a'));
  const second = addToHistory(first, station('b'));
  assert.deepEqual(second.map((s) => s.id), ['b', 'a']);
});

test('addToHistory de-duplicates and moves a replayed station to the top', () => {
  const played = addToHistory(addToHistory([], station('a')), station('b'));
  const replayed = addToHistory(played, station('a'));
  assert.deepEqual(replayed.map((s) => s.id), ['a', 'b']);
  assert.equal(replayed.filter((s) => s.id === 'a').length, 1);
});

test('addToHistory caps the list at the limit', () => {
  let list = [];
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    list = addToHistory(list, station(`s${i}`));
  }
  assert.equal(list.length, HISTORY_LIMIT);
  assert.equal(list[0].id, `s${HISTORY_LIMIT + 4}`);
  assert.equal(list.at(-1).id, 's5');
});

test('addToHistory honours a custom limit', () => {
  let list = [];
  for (let i = 0; i < 5; i += 1) list = addToHistory(list, station(`s${i}`), 3);
  assert.deepEqual(list.map((s) => s.id), ['s4', 's3', 's2']);
});

test('addToHistory tolerates an empty or invalid existing history', () => {
  assert.deepEqual(addToHistory(null, station('a')).map((s) => s.id), ['a']);
  assert.deepEqual(addToHistory(undefined, station('a')).map((s) => s.id), ['a']);
  assert.deepEqual(addToHistory([station('a')], {}).map((s) => s.id), ['a']);
});
