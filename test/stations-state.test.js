import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowseParams, mergeRows, searchModeFor } from '../src/ui/stations-state.js';

test('buildBrowseParams omits defaults and sends active filters', () => {
  assert.deepEqual(buildBrowseParams({ mode: 'az', letter: 'all', query: '', country: '', genre: '', hasDescription: false }), {
    mode: 'az', limit: 100, offset: 0, hidebroken: true,
  });
  assert.deepEqual(buildBrowseParams({ mode: 'search', query: 'jazz', country: 'DE', hasDescription: true, offset: 100 }), {
    mode: 'search', q: 'jazz', country: 'DE', hasDescription: true, limit: 100, offset: 100, hidebroken: true,
  });
});

test('searchModeFor waits for two characters and restores the previous mode', () => {
  assert.deepEqual(searchModeFor('j', 'az'), { mode: 'az', query: '' });
  assert.deepEqual(searchModeFor('ja', 'az'), { mode: 'search', query: 'ja' });
  assert.deepEqual(searchModeFor('', 'search'), { mode: 'az', query: '' });
});

test('mergeRows dedupes and caps at 500', () => {
  const existing = Array.from({ length: 499 }, (_, i) => ({ id: String(i) }));
  const merged = mergeRows(existing, [{ id: '0' }, { id: '499' }, { id: '500' }]);
  assert.equal(merged.length, 500);
  assert.equal(merged[499].id, '499');
});

import { popularParams, searchParams } from '../src/ui/stations-state.js';

test('popular and search params keep filters', () => {
  assert.deepEqual(popularParams({ country: 'DE', genre: 'jazz', hasDescription: true, offset: 0 }), {
    mode: 'popular', country: 'DE', genre: 'jazz', hasDescription: true, limit: 100, offset: 0, hidebroken: true,
  });
  assert.deepEqual(searchParams({ query: ' jazz ', country: 'DE', offset: 0 }), {
    mode: 'search', q: 'jazz', country: 'DE', limit: 100, offset: 0, hidebroken: true,
  });
});
