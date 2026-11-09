import test from 'node:test';
import assert from 'node:assert/strict';
import { reportStreamOutcome } from '../src/analytics/stream-telemetry.js';

const payload = { attemptId: 'a', stationuuid: 's', outcome: 'played', audio: true };

function storage(values = {}) {
  return { getItem: (k) => values[k] ?? null };
}

test('prefers sendBeacon with a text/plain Blob', async () => {
  const calls = [];
  const ok = reportStreamOutcome(payload, {
    endpoint: 'https://stations.test/api/stream-events',
    beacon: (url, blob) => { calls.push({ url, blob }); return true; },
    storage: storage(),
    doc: { cookie: '' },
  });
  assert.equal(ok, true);
  assert.equal(calls[0].url, 'https://stations.test/api/stream-events');
  assert.equal(calls[0].blob.type, 'text/plain');
  assert.deepEqual(JSON.parse(await calls[0].blob.text()), payload);
});

test('falls back to fetch keepalive when beacon is unavailable or refuses', () => {
  const calls = [];
  const fetchImpl = (url, init) => { calls.push({ url, init }); return Promise.resolve(); };
  reportStreamOutcome(payload, {
    endpoint: 'https://stations.test/api/stream-events',
    beacon: () => false,
    fetchImpl,
    storage: storage(),
    doc: { cookie: '' },
  });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.keepalive, true);
  assert.equal(calls[0].init.headers['Content-Type'], 'text/plain');
});

test('sends nothing when opted out or in dev', () => {
  let called = 0;
  const opts = { beacon: () => { called += 1; }, storage: storage({ 'umami.disabled': '1' }), doc: { cookie: '' } };
  assert.equal(reportStreamOutcome(payload, opts), false);
  assert.equal(reportStreamOutcome(payload, { ...opts, isDev: true, storage: storage() }), false);
  assert.equal(called, 0);
});

test('honors Do Not Track like the sibling anonymous ingest', () => {
  let called = 0;
  const ok = reportStreamOutcome(payload, {
    beacon: () => { called += 1; return true; },
    storage: storage(),
    nav: { doNotTrack: '1' },
    doc: { cookie: '' },
  });
  assert.equal(ok, false);
  assert.equal(called, 0);
});

test('cookie opt-out and all transport errors are swallowed', () => {
  assert.equal(reportStreamOutcome(payload, {
    beacon: () => { throw new Error('boom'); },
    storage: storage(),
    doc: { cookie: 'rd_stats_exclude=1' },
  }), false);
  assert.equal(reportStreamOutcome(payload, {
    beacon: () => { throw new Error('boom'); },
    fetchImpl: () => { throw new Error('boom'); },
    storage: storage(),
    doc: { cookie: '' },
  }), false);
});
