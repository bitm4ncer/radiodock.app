import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import { applyImport } from '../src/data/import-export.js';
import { getPref } from '../src/data/storage.js';

test('applyImport marks the sync dirty flag so an import is pushed, not overwritten', async () => {
  const idb = createFakeIdb();
  await applyImport({ kind: 'single', list: { name: 'Imported', stations: [{ id: 'S1', name: 'S1', url: 'http://s1' }] } });
  assert.equal(await getPref('syncDirty', false), true);
  idb.restore();
});
