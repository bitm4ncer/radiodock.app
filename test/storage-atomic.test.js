import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import * as storage from '../src/data/storage.js';

test('putRecordingNote writes the note and blob in one transaction', async () => {
  const idb = createFakeIdb();
  await storage.putRecordingNote({ id: 'n1', pageId: 'p1' }, { size: 42 });
  assert.equal((await storage.getRecordingAudio('n1')).size, 42);
  assert.equal((await storage.getAllNotes()).length, 1);
  idb.restore();
});

test('a failed recording put rolls back the note', async () => {
  const idb = createFakeIdb();
  idb.failNextWrite('recordings');
  await assert.rejects(() => storage.putRecordingNote({ id: 'n1', pageId: 'p1' }, { size: 42 }));
  assert.equal((await storage.getAllNotes()).length, 0, 'the note must not be left behind when the blob write fails');
  idb.restore();
});

test('putList propagates a write failure so createList does not report false success', async () => {
  const idb = createFakeIdb();
  idb.failNextWrite('lists');
  await assert.rejects(() => storage.putList({ id: 'l1', name: 'X', stations: [] }));
  idb.restore();
});
