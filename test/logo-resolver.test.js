import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getLogoUrl, logoSizePx } from '../src/data/logo-resolver.js';
import { STATIONS_BASE } from '../src/data/stations-api.js';

test('getLogoUrl points at the single-origin logo CDN, keyed by station id', () => {
  assert.equal(getLogoUrl({ id: 'abc' }), `${STATIONS_BASE}/logos/abc?size=64`);
});

test('getLogoUrl takes an explicit size (512 for artwork)', () => {
  assert.equal(getLogoUrl({ id: 'abc' }, 512), `${STATIONS_BASE}/logos/abc?size=512`);
});

test('getLogoUrl accepts a stationuuid-shaped object too', () => {
  assert.equal(getLogoUrl({ stationuuid: 'xyz' }), `${STATIONS_BASE}/logos/xyz?size=64`);
});

test('getLogoUrl returns empty (initials fallback) when there is no id', () => {
  assert.equal(getLogoUrl({}), '');
  assert.equal(getLogoUrl(null), '');
});

test('logoSizePx maps the slot size names', () => {
  assert.equal(logoSizePx('sm'), 64);
  assert.equal(logoSizePx('lg'), 512);
  assert.equal(logoSizePx('whatever'), 64);
});
