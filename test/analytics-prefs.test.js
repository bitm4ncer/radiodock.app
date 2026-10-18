import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalyticsOptOut, setAnalyticsOptOut } from '../src/data/analytics-prefs.js';
import { trackStationPlay } from '../src/analytics/umami.js';

class MapStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

test('analytics preference writes both opt-out keys', () => {
  const storage = new MapStorage();
  setAnalyticsOptOut(true, storage);
  assert.equal(storage.getItem('umami.disabled'), '1');
  assert.equal(storage.getItem('rd_analytics_opt_out'), '1');
  assert.equal(getAnalyticsOptOut(storage), true);

  setAnalyticsOptOut(false, storage);
  assert.equal(storage.getItem('umami.disabled'), null);
  assert.equal(storage.getItem('rd_analytics_opt_out'), null);
  assert.equal(getAnalyticsOptOut(storage), false);
});

test('trackStationPlay dispatches rd:station-play even without Umami', () => {
  const previous = globalThis.window;
  const win = new EventTarget();
  globalThis.window = win;
  try {
    const seen = [];
    win.addEventListener('rd:station-play', (event) => seen.push(event.detail));
    const station = { id: 's1', name: 'Test', countrycode: 'DE' };
    trackStationPlay(station, 'stations');
    assert.deepEqual(seen, [{ station, source: 'stations' }]);
  } finally {
    globalThis.window = previous;
  }
});
