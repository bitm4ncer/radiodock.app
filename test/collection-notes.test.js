import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLLECTION_NOTES,
  collectionNote,
  collectionNoteFor,
} from '../src/ui/collection-notes.js';

const payload = JSON.parse(readFileSync(new URL('../public/discover.json', import.meta.url), 'utf8'));
const visibleSlugs = payload.curated.lists.map((list) => list.slug).sort();

function words(value) {
  return String(value).trim().split(/\s+/).filter(Boolean).length;
}

test('covers every visible collection exactly once', () => {
  assert.deepEqual(Object.keys(COLLECTION_NOTES).sort(), visibleSlugs);
});

test('keeps every note in the approved range and free of em dashes', () => {
  for (const [slug, note] of Object.entries(COLLECTION_NOTES)) {
    assert.ok(words(note.short) >= 45 && words(note.short) <= 65, `${slug} short length`);
    assert.ok(words(note.long) >= 90 && words(note.long) <= 130, `${slug} long length`);
    assert.doesNotMatch(note.short, /—/, `${slug} short em dash`);
    assert.doesNotMatch(note.long, /—/, `${slug} long em dash`);
  }
});

test('provides the approved Jungle short and long note', () => {
  const note = COLLECTION_NOTES.jungle;
  assert.ok(note);
  assert.ok(words(note.short) >= 45 && words(note.short) <= 65);
  assert.ok(words(note.long) >= 90 && words(note.long) <= 130);
  assert.doesNotMatch(note.short, /—/);
  assert.doesNotMatch(note.long, /—/);
});

test('looks notes up by slug and trims the key', () => {
  assert.equal(collectionNote('jungle'), COLLECTION_NOTES.jungle);
  assert.equal(collectionNote(' jungle '), COLLECTION_NOTES.jungle);
  assert.equal(collectionNote('unknown-genre'), null);
  assert.equal(collectionNote(''), null);
  assert.equal(collectionNote(null), null);
});

test('prefers an info object published with the list', () => {
  const info = { short: 'Short note', long: 'Long note' };
  assert.equal(collectionNoteFor({ slug: 'unknown', info }), info);
  assert.equal(collectionNoteFor({ slug: 'jungle' }), COLLECTION_NOTES.jungle);
  assert.equal(collectionNoteFor(null), null);
});
