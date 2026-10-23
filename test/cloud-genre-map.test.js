import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_3D_AXES,
  CLOUD_DEFAULT_2D_AXES,
  CLOUD_DIMENSIONS,
  CLOUD_GENRE_EDGES,
  CLOUD_GENRE_VECTORS,
  CLOUD_MAP_SCALE,
  projectVector,
} from '../src/ui/cloud-genre-map.js';

function edgeKey(edge) {
  return edge[0] < edge[1] ? `${edge[0]}|${edge[1]}` : `${edge[1]}|${edge[0]}`;
}

test('keeps vectors for at least the original collections', () => {
  assert.ok(Object.keys(CLOUD_GENRE_VECTORS).length >= 35);
});

test('covers every collection currently published in discover.json', () => {
  const payload = JSON.parse(readFileSync(new URL('../public/discover.json', import.meta.url), 'utf8'));
  const missing = payload.curated.lists
    .map((list) => list.slug)
    .filter((slug) => !CLOUD_GENRE_VECTORS[slug]);
  assert.deepEqual(missing, []);
});

test('every vector has four bounded dimensions and a family', () => {
  for (const [slug, vector] of Object.entries(CLOUD_GENRE_VECTORS)) {
    assert.ok(vector.family, `${slug} has no family`);
    for (const axis of ['energy', 'electronic', 'era', 'mood']) {
      assert.equal(typeof vector[axis], 'number', `${slug}.${axis} is not a number`);
      assert.equal(Number.isFinite(vector[axis]), true, `${slug}.${axis} is not finite`);
      assert.ok(vector[axis] >= 0 && vector[axis] <= 100, `${slug}.${axis} is out of bounds`);
    }
  }
});

test('describes four independently selectable dimensions', () => {
  assert.deepEqual(Object.keys(CLOUD_DIMENSIONS).sort(), ['electronic', 'energy', 'era', 'mood']);
  for (const dimension of Object.values(CLOUD_DIMENSIONS)) {
    assert.equal(dimension.labels.length, 2);
    assert.ok(dimension.labels.every(Boolean));
  }
  assert.deepEqual(CLOUD_DEFAULT_2D_AXES, { x: 'electronic', y: 'energy' });
  assert.deepEqual(CLOUD_3D_AXES, { x: 'electronic', y: 'energy', z: 'mood' });
});

test('projects a vector onto any ordered dimension pair', () => {
  const vector = { energy: 80, electronic: 20, era: 60, mood: 35 };
  assert.deepEqual(projectVector(vector, { x: 'mood', y: 'era' }), {
    x: (35 - 50) * CLOUD_MAP_SCALE,
    y: (50 - 60) * CLOUD_MAP_SCALE,
  });
});

test('uses only known, undirected, unique genre edges', () => {
  const keys = new Set();
  for (const edge of CLOUD_GENRE_EDGES) {
    assert.equal(edge.length, 2);
    assert.notEqual(edge[0], edge[1]);
    assert.ok(CLOUD_GENRE_VECTORS[edge[0]], `${edge[0]} is not a known collection`);
    assert.ok(CLOUD_GENRE_VECTORS[edge[1]], `${edge[1]} is not a known collection`);
    const key = edgeKey(edge);
    assert.equal(keys.has(key), false, `${key} is duplicated`);
    keys.add(key);
  }
  assert.equal(keys.has('dubby|news'), false);
  for (const expected of [
    'black-metal-doom|metal',
    'classic-rock|metal',
    'blues|classic-rock',
    '80s-hard-rock|classic-rock',
    'news|pop',
    'grime|hiphop',
    'grime|trap-drill',
    'noise|techno',
    'drum-and-bass|hardcore',
    'hardcore|jungle',
    'funk|soul',
    'pop|rnb',
    'latin|reggaeton',
    'deep-house|house',
  ]) {
    assert.equal(keys.has(expected), true, `${expected} is missing`);
  }
  assert.equal(keys.has('hardcore|punk'), false);
});
