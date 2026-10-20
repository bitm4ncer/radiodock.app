import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchJson } from '../src/data/stations-api.js';

const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

test('discover.json is network-first, so a Publish reaches the next load', () => {
  assert.match(sw, /const NETWORK_FIRST_DATA = \[[^\]]*'\/discover\.json'/);
});

test('network-first data is not short-circuited before the fetch handler', () => {
  const body = sw.slice(sw.indexOf('function isAppShellRequest'));
  const fn = body.slice(0, body.indexOf('\n}') + 2);
  assert.match(fn, /isNetworkFirstData\(url\)/);
});

test('fetchJson bypasses the browser HTTP cache', async () => {
  const original = globalThis.fetch;
  let init;
  globalThis.fetch = async (_url, options) => {
    init = options;
    return { ok: true, json: async () => ({}) };
  };
  try {
    await fetchJson('/discover.json');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(init.cache, 'no-store');
});
