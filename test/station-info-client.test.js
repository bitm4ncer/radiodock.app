import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStationInfo, STATIONS_BASE } from '../src/data/stations-api.js';

function withFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}

test('getStationInfo returns the parsed body on 200', async () => {
  await withFetch(async (url) => {
    assert.equal(url, `${STATIONS_BASE}/api/stations/uuid-1`);
    return new Response(JSON.stringify({ id: 'uuid-1', city: 'London', socials: [{ platform: 'instagram', url: 'https://x' }] }), { status: 200 });
  }, async () => {
    const r = await getStationInfo('uuid-1');
    assert.equal(r.city, 'London');
    assert.equal(r.socials[0].platform, 'instagram');
  });
});

test('getStationInfo returns null on 404', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ ok: false }), { status: 404 }),
    async () => { assert.equal(await getStationInfo('nope'), null); },
  );
});
