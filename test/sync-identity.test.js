import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import { markSyncDirty, pushToServer } from '../src/data/sync.js';
import * as storage from '../src/data/storage.js';

test('markSyncDirty bumps a revision so a newer edit is distinguishable from an older one', async () => {
  const idb = createFakeIdb();
  const r1 = await markSyncDirty();
  const r2 = await markSyncDirty();
  assert.ok(r2 > r1);
  idb.restore();
});

test('a push that started before a newer edit does not clear the dirty flag', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  let resolveFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((res) => { markFetchStarted = res; });
  globalThis.fetch = () => {
    markFetchStarted();
    return new Promise((res) => { resolveFetch = () => res({ ok: true, status: 200, json: async () => ({ updated_at: 't' }) }); });
  };
  try {
    await storage.setPref('syncToken', 's');
    await storage.setPref('syncLastHash', null);
    const push = pushToServer('s');
    await fetchStarted; // the push is now blocked on fetch, having captured its revision
    await markSyncDirty(); // newer edit lands while the push is in flight
    resolveFetch();
    await push;
    assert.equal(await storage.getPref('syncDirty', false), true, 'the newer edit must stay dirty');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('pushToServer sends base_hash equal to the last synced hash', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ updated_at: 't' }) };
  };
  try {
    await storage.setPref('syncToken', 's');
    await storage.setPref('syncLastHash', 'hash-123');
    await pushToServer('s');
    assert.equal(sentBody.base_hash, 'hash-123');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});
