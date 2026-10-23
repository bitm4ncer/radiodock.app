import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignCloudAxis,
  axisPairKey,
  fallbackVectorForSlug,
  normaliseCloudAxes,
  normaliseCloudVector,
} from '../src/ui/cloud-geometry.js';
import { CLOUD_DEFAULT_2D_AXES } from '../src/ui/cloud-genre-map.js';

const DIMENSIONS = ['electronic', 'energy', 'era', 'mood'];

test('creates stable fallback vectors from slugs rather than list position', () => {
  const slugs = ['future-one', 'future-two', '', 'Ünknown 音楽', 'x'.repeat(1000)];
  const first = Object.fromEntries(slugs.map((slug) => [slug, fallbackVectorForSlug(slug)]));
  const reordered = Object.fromEntries([...slugs].reverse().map((slug) => [slug, fallbackVectorForSlug(slug)]));
  const extended = Object.fromEntries(['new-first', ...slugs, 'new-last']
    .map((slug) => [slug, fallbackVectorForSlug(slug)]));

  for (const slug of slugs) {
    assert.deepEqual(reordered[slug], first[slug]);
    assert.deepEqual(extended[slug], first[slug]);
    assert.equal(first[slug].family, 'other');
    for (const dimension of DIMENSIONS) {
      assert.equal(Number.isFinite(first[slug][dimension]), true);
      assert.ok(first[slug][dimension] >= 6 && first[slug][dimension] <= 94);
    }
  }
  assert.equal(new Set(slugs.map((slug) => JSON.stringify(first[slug]))).size, slugs.length);
});

test('normalises supplied vectors and fills invalid fields from the slug fallback', () => {
  const fallback = fallbackVectorForSlug('future-one');
  assert.deepEqual(normaliseCloudVector('future-one', {
    family: 'custom', electronic: -20, energy: 120, era: Number.NaN, mood: Infinity,
  }), {
    family: 'custom', electronic: 0, energy: 100, era: fallback.era, mood: fallback.mood,
  });
  assert.deepEqual(normaliseCloudVector('future-one', null), fallback);
});

test('keeps ordered axis keys and swaps when assigning the occupied dimension', () => {
  assert.equal(axisPairKey('mood', 'era'), 'mood:era');
  assert.deepEqual(assignCloudAxis({ x: 'electronic', y: 'energy' }, 'y', 'electronic'), {
    x: 'energy', y: 'electronic',
  });
  assert.deepEqual(assignCloudAxis({ x: 'electronic', y: 'energy' }, 'x', 'mood'), {
    x: 'mood', y: 'energy',
  });
});

test('normalises unknown or duplicate axis pairs to the default', () => {
  assert.deepEqual(normaliseCloudAxes({ x: 'mood', y: 'era' }), { x: 'mood', y: 'era' });
  assert.deepEqual(normaliseCloudAxes({ x: 'mood', y: 'mood' }), CLOUD_DEFAULT_2D_AXES);
  assert.deepEqual(normaliseCloudAxes({ x: 'unknown', y: 'era' }), CLOUD_DEFAULT_2D_AXES);
  assert.deepEqual(normaliseCloudAxes(null), CLOUD_DEFAULT_2D_AXES);
});
