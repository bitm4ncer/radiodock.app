import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import { createRecording, createNote, deletePage, getRecordingBlob } from '../src/data/notes.js';
import { getAllNotePages, getAllNotes } from '../src/data/storage.js';

test('deleting a page removes its notes and their recording blobs with no orphans', async () => {
  const idb = createFakeIdb();
  const rec = await createRecording({ pageId: 'p1', blob: { size: 5 } });
  await createNote({ pageId: 'p1' });

  await deletePage('p1');

  assert.equal((await getAllNotes()).length, 0);
  assert.equal((await getAllNotePages()).length, 0);
  assert.equal(await getRecordingBlob(rec.id), undefined, 'no orphan recording blob');
  idb.restore();
});
