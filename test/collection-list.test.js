import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionListId, uniqueListName } from '../src/data/collection-list.js';

test('collectionListId derives a stable id from the slug', () => {
  assert.equal(collectionListId('news'), 'list_collection_news');
  assert.equal(collectionListId('Dub / Reggae'), 'list_collection_dub-reggae');
  assert.equal(collectionListId('  Late Night  '), 'list_collection_late-night');
});

test('collectionListId falls back to untitled for an empty slug', () => {
  assert.equal(collectionListId(''), 'list_collection_untitled');
  assert.equal(collectionListId(null), 'list_collection_untitled');
});

test('uniqueListName keeps a free title unchanged', () => {
  assert.equal(uniqueListName('News', ['Favorites', 'Jazz']), 'News');
});

test('uniqueListName adds a numbered suffix when the title is taken', () => {
  assert.equal(uniqueListName('News', ['News', 'News (2)']), 'News (3)');
  assert.equal(uniqueListName('news', ['NEWS']), 'news (2)');
});

test('uniqueListName caps the title at the list-name limit', () => {
  const title = 'A'.repeat(60);
  const name = uniqueListName(title, []);
  assert.equal(name.length, 50);
  const collision = uniqueListName(title, [name]);
  assert.ok(collision.length <= 50);
  assert.match(collision, / \(2\)$/);
});
