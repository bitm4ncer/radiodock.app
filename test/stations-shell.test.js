import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('shell exposes the stations entry points and removes the old overlay', () => {
  assert.ok(html.includes('id="stationsPanel"'));
  assert.ok(html.includes('id="stationsTriggerBtn"'));
  assert.ok(html.includes('id="stationsOpenBtn"'));
  assert.ok(html.includes('id="searchAllBtn"'));
  assert.ok(!html.includes('id="searchOverlay"'));
  assert.ok(!html.includes('id="searchTriggerBtn"'));
});

test('main wires the stations page closer', () => {
  assert.ok(main.includes('mountStationsPanel'));
  assert.ok(main.includes('stations:'));
  assert.ok(!main.includes('mountSearchOverlay'));
});
