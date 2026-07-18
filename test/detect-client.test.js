import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTrack, DetectError } from '../src/data/detect-client.js';
import { STATIONS_BASE } from '../src/data/stations-api.js';

function withFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}
const UUID = '11111111-1111-4111-8111-111111111111';

test('POSTs uuid and returns the parsed body on 200', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, `${STATIONS_BASE}/api/detect`);
    assert.equal(opts.method, 'POST');
    assert.equal(JSON.parse(opts.body).uuid, UUID);
    return new Response(JSON.stringify({ ok: true, track: { title: 'T', artists: ['A'] } }), { status: 200 });
  }, async () => {
    const out = await detectTrack(UUID);
    assert.equal(out.ok, true);
    assert.equal(out.track.title, 'T');
  });
});

test('200 ok:false (no-match) is returned, not thrown', async () => {
  await withFetch(async () => new Response(JSON.stringify({ ok: false, reason: 'no-match' }), { status: 200 }),
    async () => { assert.equal((await detectTrack(UUID)).reason, 'no-match'); });
});

test('429 → DetectError with reason device-limit', async () => {
  await withFetch(async () => new Response(JSON.stringify({ ok: false, reason: 'device-limit' }), { status: 429 }),
    async () => {
      await assert.rejects(() => detectTrack(UUID), (e) => e instanceof DetectError && e.status === 429 && e.reason === 'device-limit');
    });
});

test('503 → DetectError with reason', async () => {
  await withFetch(async () => new Response(JSON.stringify({ ok: false, reason: 'disabled' }), { status: 503 }),
    async () => { await assert.rejects(() => detectTrack(UUID), (e) => e instanceof DetectError && e.reason === 'disabled'); });
});
