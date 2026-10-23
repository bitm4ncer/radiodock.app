import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_GENRE_GROUPS,
  cloudGenreGroup,
} from '../src/ui/cloud-genre-groups.js';
import { CLOUD_GENRE_VECTORS } from '../src/ui/cloud-genre-map.js';

test('maps every curated family to exactly one of nine super-genres', () => {
  assert.equal(CLOUD_GENRE_GROUPS.length, 9);
  const families = new Set(Object.values(CLOUD_GENRE_VECTORS).map((vector) => vector.family));
  const assigned = new Map();
  for (const group of CLOUD_GENRE_GROUPS) {
    for (const family of group.families) {
      assert.equal(assigned.has(family), false, `${family} is assigned twice`);
      assigned.set(family, group.key);
    }
  }
  for (const family of families) {
    assert.ok(assigned.has(family), `${family} has no super-genre`);
    assert.equal(cloudGenreGroup(family).key, assigned.get(family));
  }
});

test('uses the ambient and other group for unknown or missing families', () => {
  assert.equal(cloudGenreGroup('unknown-family').key, 'ambient');
  assert.equal(cloudGenreGroup(undefined).key, 'ambient');
  assert.equal(cloudGenreGroup('').key, 'ambient');
});

test('exposes readable labels for tooltips and accessible names', () => {
  assert.equal(cloudGenreGroup('techno').label, 'Electronic / Club');
  assert.equal(cloudGenreGroup('hiphop').label, 'Hip-Hop / Rap');
  assert.equal(cloudGenreGroup('classical').label, 'Jazz / Classical');
  assert.equal(cloudGenreGroup('unknown-family').label, 'Ambient / Other');
});
