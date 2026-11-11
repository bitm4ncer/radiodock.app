import test from 'node:test';
import assert from 'node:assert/strict';
import { stationUuidFromSearch, withoutStationParam } from '../src/data/deep-link.js';

const UUID = '11111111-1111-4111-8111-111111111111';

test('a valid station query is accepted', () => {
  assert.equal(stationUuidFromSearch(`?station=${UUID}`), UUID);
  assert.equal(stationUuidFromSearch(`?foo=1&station=${UUID}`), UUID);
});

test('missing or malformed station queries are ignored', () => {
  assert.equal(stationUuidFromSearch(''), null);
  assert.equal(stationUuidFromSearch('?station='), null);
  assert.equal(stationUuidFromSearch('?station=not-a-uuid'), null);
});

test('removing the station param keeps the other params', () => {
  assert.equal(withoutStationParam(`?foo=1&station=${UUID}&bar=2`), '?foo=1&bar=2');
  assert.equal(withoutStationParam(`?station=${UUID}`), '');
});
