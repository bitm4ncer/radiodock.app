import test from 'node:test';
import assert from 'node:assert/strict';
import { submitPlaylist, PlaylistSubmitError } from '../src/data/playlists.js';

test('submitPlaylist posts a title, note and station UUID snapshot', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return new Response(JSON.stringify({ ok: true, id: 7, status: 'pending' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const result = await submitPlaylist({
      title: 'Morning Jazz',
      note: 'A calm start',
      stationUuids: ['a', 'b'],
      submitterName: 'Ann',
      submitterContact: 'ann@example.com',
    });
    assert.equal(result.id, 7);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/playlist-submissions$/);
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), {
      title: 'Morning Jazz',
      note: 'A calm start',
      stationUuids: ['a', 'b'],
      submitterName: 'Ann',
      submitterContact: 'ann@example.com',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('submitPlaylist throws the server message on rejection', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: 'title must be 2 to 60 characters' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    await assert.rejects(
      () => submitPlaylist({ title: 'A', stationUuids: ['a'] }),
      (err) => err instanceof PlaylistSubmitError && /2 to 60/.test(err.message),
    );
  } finally {
    globalThis.fetch = original;
  }
});
