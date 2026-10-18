import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOptions, chipLabel, clearFilters } from '../src/ui/stations-filter.js';

test('filterOptions searches labels case-insensitively', () => {
  const items = [{ code: 'DE', name: 'Germany' }, { code: 'US', name: 'United States' }];
  assert.deepEqual(filterOptions(items, 'ger').map((i) => i.code), ['DE']);
  assert.deepEqual(filterOptions(items, '').map((i) => i.code), ['DE', 'US']);
});

test('chipLabel shows the active value', () => {
  assert.equal(chipLabel('country', 'DE', { countries: [{ code: 'DE', name: 'Germany' }] }), 'Germany');
  assert.equal(chipLabel('genre', 'jazz', { genres: [{ genre: 'jazz', label: 'Jazz' }] }), 'Jazz');
  assert.equal(chipLabel('description', true, {}), 'Description');
});

test('clearFilters resets every filter', () => {
  assert.deepEqual(
    clearFilters({ country: 'DE', genre: 'jazz', hasDescription: true }),
    { country: '', genre: '', hasDescription: false },
  );
});
