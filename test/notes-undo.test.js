import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeIdb } from './helpers/fake-idb.js';
import { createRecording, deleteNote, restoreNote, getRecordingBlob } from '../src/data/notes.js';
import { getAllNotes } from '../src/data/storage.js';

test('deleteNote returns the note and its blob, and undo restores both', async () => {
  const idb = createFakeIdb();
  const note = await createRecording({ pageId: 'p1', blob: { size: 10 } });
  const { note: deleted, blob } = await deleteNote(note.id);
  assert.equal(deleted.id, note.id);
  assert.equal(blob.size, 10);
  assert.equal(await getRecordingBlob(note.id), undefined, 'blob removed by delete');

  await restoreNote(deleted, blob);
  assert.equal((await getRecordingBlob(note.id)).size, 10, 'undo restores the blob');
  idb.restore();
});

test('undo of a non-recording note restores the note without a blob', async () => {
  const idb = createFakeIdb();
  const note = { id: 'n2', pageId: 'p1', type: 'note', body: 'hi', createdAt: 1 };
  await restoreNote(note);
  assert.ok((await getAllNotes()).some((n) => n.id === 'n2'));
  idb.restore();
});
