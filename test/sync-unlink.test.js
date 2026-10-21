import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import { deleteFromServer } from '../src/data/sync.js';
import * as storage from '../src/data/storage.js';

test('unlinking clears the sync base so a new link cannot inherit another record', async () => {
  const idb = createFakeIdb();
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  try {
    await storage.setPref('syncToken', 's');
    await storage.setPref('syncBaseExport', '{"version":"2.0","lists":[]}');
    await storage.setPref('syncRevision', 5);
    await deleteFromServer('s');
    assert.equal(await storage.getPref('syncBaseExport', null), null, 'the stale base export must be cleared');
  } finally {
    globalThis.fetch = original;
    idb.restore();
  }
});
