import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLOUD_AXIS_PRESETS,
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

test('every vector has bounded axes and a family', () => {
  for (const [slug, vector] of Object.entries(CLOUD_GENRE_VECTORS)) {
    assert.ok(vector.family, `${slug} has no family`);
    for (const axis of ['energy', 'electronic', 'era']) {
      assert.equal(typeof vector[axis], 'number', `${slug}.${axis} is not a number`);
      assert.ok(vector[axis] >= 0 && vector[axis] <= 100, `${slug}.${axis} is out of bounds`);
    }
  }
});

test('provides three switchable axis presets with labels', () => {
  assert.deepEqual(Object.keys(CLOUD_AXIS_PRESETS).sort(), ['era', 'texture', 'vibe']);
  for (const preset of Object.values(CLOUD_AXIS_PRESETS)) {
    assert.ok(['energy', 'electronic', 'era'].includes(preset.x), `${preset.key} has no valid x axis`);
    assert.ok(['energy', 'electronic', 'era'].includes(preset.y), `${preset.key} has no valid y axis`);
    assert.equal(preset.xLabels.length, 2);
    assert.equal(preset.yLabels.length, 2);
  }
});

test('projects a vector onto each preset', () => {
  const vector = { energy: 80, electronic: 20, era: 60 };
  assert.deepEqual(projectVector(vector, CLOUD_AXIS_PRESETS.vibe), {
    x: (20 - 50) * CLOUD_MAP_SCALE,
    y: (50 - 80) * CLOUD_MAP_SCALE,
  });
  assert.deepEqual(projectVector(vector, CLOUD_AXIS_PRESETS.era), {
    x: (60 - 50) * CLOUD_MAP_SCALE,
    y: (50 - 80) * CLOUD_MAP_SCALE,
  });
  assert.deepEqual(projectVector(vector, CLOUD_AXIS_PRESETS.texture), {
    x: (20 - 50) * CLOUD_MAP_SCALE,
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
