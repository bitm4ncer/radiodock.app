import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitStation, SubmitError } from '../src/data/submit.js';
import { STATIONS_BASE } from '../src/data/stations-api.js';

function withFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}

test('POSTs to /api/submissions and returns the id on 201', async () => {
  await withFetch(async (url, opts) => {
    assert.equal(url, `${STATIONS_BASE}/api/submissions`);
    assert.equal(opts.method, 'POST');
    const body = JSON.parse(opts.body);
    assert.equal(body.name, 'Test FM');
    return new Response(JSON.stringify({ ok: true, id: 7 }), { status: 201 });
  }, async () => {
    const res = await submitStation({ name: 'Test FM', streamUrl: 'https://ex.com/s' });
    assert.equal(res.id, 7);
  });
});

test('throws SubmitError with status + server message on 409', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ ok: false, error: 'already in the database' }), { status: 409 }),
    async () => {
      await assert.rejects(
        () => submitStation({ name: 'Dup', streamUrl: 'https://ex.com/s' }),
        (err) => err instanceof SubmitError && err.status === 409 && /already/.test(err.message),
      );
    },
  );
});
