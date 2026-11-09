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

test('rejects an oversized submission locally before it hits the network', async () => {
  let fetched = false;
  await withFetch(
    async () => {
      fetched = true;
      return new Response(JSON.stringify({ ok: true, id: 1 }), { status: 201 });
    },
    async () => {
      await assert.rejects(
        () => submitStation({
          name: 'Big logo',
          streamUrl: 'https://ex.com/s',
          logoData: `data:image/png;base64,${'A'.repeat(300 * 1024)}`,
        }),
        (err) =>
          err instanceof SubmitError &&
          err.status === 413 &&
          /256 KB/.test(err.message) &&
          /logo/i.test(err.message),
      );
    },
  );
  assert.equal(fetched, false, 'the body guard must run before fetch');
});
