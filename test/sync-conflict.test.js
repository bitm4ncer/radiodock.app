import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import * as sync from '../src/data/sync.js';
import * as storage from '../src/data/storage.js';

const st = (id, name = id) => ({ id, name, url: `http://${id}` });
const list = (id, stations) => ({ id, name: id, stations });
const obj = (...lists) => JSON.stringify({ version: '2.0', lists });

test('applyImportPayload: the merge path can set the base to the server doc and keep dirty', async () => {
  const idb = createFakeIdb();
  try {
    const serverJson = obj(list('favorites', [st('S')]));
    const mergedJson = obj(list('favorites', [st('S'), st('L')]));
    await sync.applyImportPayload(mergedJson, 'hash', 't', { baseExport: serverJson, dirty: true });
    assert.equal(await storage.getPref('syncBaseExport', null), serverJson, 'base is the server doc, not the merged doc');
    assert.equal(await storage.getPref('syncDirty', false), true, 'dirty stays true');
  } finally {
    idb.restore();
  }
});

test('a 409 merge adopts the server doc as base and keeps dirty until the retry succeeds', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  const secret = 'merge-secret';
  const serverJson = obj(list('favorites', [st('A'), st('C')])); // server has C, not B

  let resolveRetry;
  let retryStarted;
  const retryGate = new Promise((res) => { retryStarted = res; });

  try {
    await storage.putList({ id: 'favorites', name: 'favorites', stations: [st('A'), st('B')], order: 0 });
    await storage.setPref('syncBaseExport', obj(list('favorites', [st('A')])));
    await storage.setPref('syncLastHash', 'base-hash');
    await storage.setPref('syncDirty', true);
    await storage.setPref('syncRevision', 1);

    const serverEnvelope = await sync.encryptPayload(serverJson, secret);
    const serverHash = await sync.computeContentHash(serverJson);

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 409, json: async () => ({ error: 'conflict', current: { payload: serverEnvelope, content_hash: serverHash, updated_at: 't2' } }) };
      }
      retryStarted();
      return new Promise((resolve) => {
        resolveRetry = () => resolve({ ok: true, status: 200, json: async () => ({ updated_at: 't3', created: false }) });
      });
    };

    const push = sync.pushToServer(secret, undefined);
    await retryGate; // merge applied, retry now in flight

    assert.equal(await storage.getPref('syncBaseExport', null), serverJson, 'base must be the server doc, not the merged doc');
    assert.equal(await storage.getPref('syncDirty', false), true, 'dirty must stay true until the retry succeeds');

    resolveRetry();
    await push;
    assert.equal(await storage.getPref('syncDirty', false), false, 'dirty cleared once the retry succeeds');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('a second 409 merge with the corrected base does not drop a station only this device added', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  const secret = 'second-409-secret';
  const mk = (...ids) => obj(list('favorites', ids.map(st)));

  try {
    await storage.putList({ id: 'favorites', name: 'favorites', stations: [st('A'), st('X')], order: 0 });
    await storage.setPref('syncBaseExport', mk('A'));
    await storage.setPref('syncLastHash', 'base-hash');
    await storage.setPref('syncDirty', true);
    await storage.setPref('syncRevision', 1);

    const server1 = mk('A');       // first 409: server still [A]
    const server2 = mk('A', 'Y');  // second 409: server moved to [A, Y]
    const env1 = await sync.encryptPayload(server1, secret);
    const env2 = await sync.encryptPayload(server2, secret);
    const h1 = await sync.computeContentHash(server1);
    const h2 = await sync.computeContentHash(server2);

    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 409, json: async () => ({ current: { payload: env1, content_hash: h1, updated_at: 't1' } }) };
      if (calls === 2) return { ok: false, status: 409, json: async () => ({ current: { payload: env2, content_hash: h2, updated_at: 't2' } }) };
      return { ok: true, status: 200, json: async () => ({ updated_at: 't3', created: false }) };
    };

    await sync.pushToServer(secret, undefined);

    const lists = await storage.getAllLists();
    const fav = lists.find((l) => l.id === 'favorites');
    const ids = (fav?.stations ?? []).map((s) => s.id);
    assert.ok(ids.includes('X'), 'X (added only on this device) must survive the second merge');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('a merge conflict persists the syncConflict marker', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  const secret = 'conflict-secret';

  try {
    await storage.putList({ id: 'favorites', name: 'favorites', stations: [st('A', 'v2')], order: 0 });
    await storage.setPref('syncBaseExport', obj(list('favorites', [st('A', 'v1')])));
    await storage.setPref('syncLastHash', 'base-hash');
    await storage.setPref('syncDirty', true);
    await storage.setPref('syncRevision', 1);

    const serverJson = obj(list('favorites', [st('A', 'v3')]));
    const serverEnvelope = await sync.encryptPayload(serverJson, secret);
    const serverHash = await sync.computeContentHash(serverJson);

    globalThis.fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'conflict', current: { payload: serverEnvelope, content_hash: serverHash, updated_at: 't2' } }),
    });

    await assert.rejects(
      () => sync.pushToServer(secret, undefined),
      (err) => err?.type === 'conflict',
    );
    assert.equal(await storage.getPref('syncConflict', false), true, 'conflict marker must be persisted');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('autoSyncOnStartup skips pushing while a conflict is unresolved', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    await storage.setPref('syncConflict', true);
    await storage.setPref('syncDirty', true);
    const result = await sync.autoSyncOnStartup('s');
    assert.equal(result, 'conflict');
    assert.equal(fetchCalled, false, 'no push or pull should run while the conflict is unresolved');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('resolveConflictKeepLocal clears the marker and performs a blind push with no base_hash', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ updated_at: 't', created: false }) };
  };
  try {
    await storage.putList({ id: 'favorites', name: 'favorites', stations: [], order: 0 });
    await storage.setPref('syncConflict', true);
    await storage.setPref('syncDirty', true);
    const result = await sync.resolveConflictKeepLocal('s');
    assert.equal('base_hash' in sentBody, false, 'blind overwrite must omit base_hash');
    assert.equal(await storage.getPref('syncConflict', false), false, 'marker cleared');
    assert.equal(await storage.getPref('syncDirty', false), false, 'dirty cleared');
    assert.ok(result?.ok);
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});

test('resolveConflictUseServer applies the server doc and clears the marker', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  const secret = 'use-server-secret';
  const serverJson = obj(list('favorites', [st('S')]));

  try {
    await storage.putList({ id: 'favorites', name: 'favorites', stations: [st('L')], order: 0 });
    await storage.setPref('syncConflict', true);
    await storage.setPref('syncDirty', true);
    await storage.setPref('syncLastHash', 'stale');

    const serverEnvelope = await sync.encryptPayload(serverJson, secret);
    const serverHash = await sync.computeContentHash(serverJson);

    globalThis.fetch = async (url) => {
      if (String(url).includes('meta=1')) {
        return { ok: true, status: 200, json: async () => ({ content_hash: serverHash, list_count: 1, station_count: 1, updated_at: 't' }) };
      }
      return { ok: true, status: 200, json: async () => ({ payload: serverEnvelope, content_hash: serverHash, updated_at: 't', list_count: 1, station_count: 1 }) };
    };

    await sync.resolveConflictUseServer(secret);

    const lists = await storage.getAllLists();
    const fav = lists.find((l) => l.id === 'favorites');
    assert.deepEqual((fav?.stations ?? []).map((s) => s.id), ['S'], 'local must match the server doc');
    assert.equal(await storage.getPref('syncConflict', false), false, 'marker cleared');
    assert.equal(await storage.getPref('syncDirty', false), false, 'dirty cleared');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});
