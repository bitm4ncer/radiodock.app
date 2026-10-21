import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import * as storage from '../src/data/storage.js';

test('a rejected open can be repaired by a later successful open', async () => {
  const idb = createFakeIdb({ failOpen: true });
  await storage.getPref('x', 'dflt');
  assert.equal(storage.getIdbHealth(), 'failed');
  idb.failOpen = false;
  await storage.setPref('x', 'hello');
  assert.equal(storage.getIdbHealth(), 'ok');
  assert.equal(await storage.getPref('x', 'dflt'), 'hello', 'a later open must not reuse the rejected dbPromise');
  idb.restore();
});

test('getNotesForPage reads via the byPage index, not a full scan', async () => {
  const idb = createFakeIdb();
  await storage.putNote({ id: 'a', pageId: 'p1' });
  await storage.putNote({ id: 'b', pageId: 'p2' });
  const result = await storage.getNotesForPage('p1');
  assert.deepEqual(result.map((n) => n.id), ['a']);
  idb.restore();
});

test('a competing tab versionchange closes the connection and lets a later open reopen', async () => {
  const idb = createFakeIdb();
  await storage.getPref('x', 'dflt');
  const first = idb.connection;
  assert.ok(first, 'the connection must be open');
  assert.equal(first.closed, false);

  first.onversionchange({ target: first });

  assert.equal(first.closed, true, 'the stale connection must be closed');
  await storage.setPref('x', 'hello');
  assert.notEqual(idb.connection, first, 'a later open must create a fresh connection');
  assert.equal(await storage.getPref('x', 'dflt'), 'hello', 'the reopen must not reuse a reset dbPromise');
  idb.restore();
});
