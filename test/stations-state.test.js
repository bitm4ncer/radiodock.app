import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBrowseParams, mergeRows, searchModeFor } from '../src/ui/stations-state.js';

test('buildBrowseParams omits defaults and sends active filters', () => {
  assert.deepEqual(buildBrowseParams({ mode: 'az', letter: 'all', query: '', country: '', genre: '' }), {
    mode: 'az', limit: 100, offset: 0, hidebroken: true,
  });
  assert.deepEqual(buildBrowseParams({ mode: 'search', query: 'jazz', country: 'DE', offset: 100 }), {
    mode: 'search', q: 'jazz', country: 'DE', limit: 100, offset: 100, hidebroken: true,
  });
});

test('searchModeFor waits for two characters and restores the previous mode', () => {
  assert.deepEqual(searchModeFor('j', 'az'), { mode: 'too-short', query: 'j' });
  assert.deepEqual(searchModeFor('ja', 'az'), { mode: 'search', query: 'ja' });
  assert.deepEqual(searchModeFor('', 'search'), { mode: 'az', query: '' });
});

test('mergeRows dedupes and caps at 500', () => {
  const existing = Array.from({ length: 499 }, (_, i) => ({ id: String(i) }));
  const merged = mergeRows(existing, [{ id: '0' }, { id: '499' }, { id: '500' }]);
  assert.equal(merged.length, 500);
  assert.equal(merged[499].id, '499');
});

test('mergeRows can run without a cap for Popular', () => {
  const existing = Array.from({ length: 600 }, (_, i) => ({ id: String(i) }));
  const merged = mergeRows(existing, [{ id: '600' }], null);
  assert.equal(merged.length, 601);
});

import { communityParams, popularParams, searchParams } from '../src/ui/stations-state.js';

test('popular and search params keep filters', () => {
  assert.deepEqual(popularParams({ country: 'DE', genre: 'jazz', offset: 0 }), {
    mode: 'popular', country: 'DE', genre: 'jazz', limit: 100, offset: 0, hidebroken: true,
  });
  assert.deepEqual(searchParams({ query: ' jazz ', country: 'DE', offset: 0 }), {
    mode: 'search', q: 'jazz', country: 'DE', limit: 100, offset: 0, hidebroken: true,
  });
});

test('community params keep filters and ignore the A-Z letter', () => {
  assert.deepEqual(communityParams({
    mode: 'community', letter: 'D', country: 'DE', genre: 'jazz', offset: 0,
  }), {
    mode: 'community', country: 'DE', genre: 'jazz', limit: 100, offset: 0, hidebroken: true,
  });
});
