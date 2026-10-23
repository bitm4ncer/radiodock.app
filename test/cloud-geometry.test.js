import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignCloudAxis,
  axisPairKey,
  clampCloudOrbit,
  CLOUD_MAX_DISTANCE,
  CLOUD_MAX_PITCH,
  CLOUD_MIN_DISTANCE,
  CLOUD_MIN_PITCH,
  DEFAULT_CLOUD_ORBIT,
  fallbackVectorForSlug,
  normaliseCloudAxes,
  normaliseCloudVector,
  projectCloudAxis,
  projectCloudPoint,
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

test('clamps cloud orbit to finite camera limits idempotently', () => {
  for (const value of Object.values(DEFAULT_CLOUD_ORBIT)) assert.equal(Number.isFinite(value), true);
  const clamped = clampCloudOrbit({ yaw: Infinity, pitch: 99, distance: -100 });
  assert.equal(clamped.yaw, DEFAULT_CLOUD_ORBIT.yaw);
  assert.equal(clamped.pitch, CLOUD_MAX_PITCH);
  assert.equal(clamped.distance, CLOUD_MIN_DISTANCE);
  assert.deepEqual(clampCloudOrbit(clamped), clamped);

  const opposite = clampCloudOrbit({ yaw: -9, pitch: -99, distance: 1e9 });
  assert.equal(opposite.pitch, CLOUD_MIN_PITCH);
  assert.equal(opposite.distance, CLOUD_MAX_DISTANCE);
  assert.ok(CLOUD_MIN_PITCH > -Math.PI / 2);
  assert.ok(CLOUD_MAX_PITCH < Math.PI / 2);
});

test('projects the origin to center and rotates yaw and pitch in screen space', () => {
  const viewport = { width: 800, height: 600 };
  const orbit = { yaw: 0, pitch: 0, distance: 1000 };
  assert.deepEqual(projectCloudPoint({ x: 0, y: 0, z: 0 }, orbit, viewport), {
    x: 400, y: 300, depth: 1000, scale: 0.9, visible: true,
  });
  const yawed = projectCloudPoint({ x: 0, y: 0, z: 1 }, { ...orbit, yaw: 0.5 }, viewport);
  const pitched = projectCloudPoint({ x: 0, y: 0, z: 1 }, { ...orbit, pitch: 0.5 }, viewport);
  assert.ok(yawed.x > 400);
  assert.ok(pitched.y > 300);
});

test('uses depth for perspective and hides points at or behind the near plane', () => {
  const viewport = { width: 800, height: 600 };
  const orbit = { yaw: 0, pitch: 0, distance: CLOUD_MIN_DISTANCE };
  const nearer = projectCloudPoint({ x: 0, y: 0, z: 1 }, orbit, viewport);
  const farther = projectCloudPoint({ x: 0, y: 0, z: -1 }, orbit, viewport);
  const behind = projectCloudPoint({ x: 0, y: 0, z: 10 }, orbit, viewport);
  assert.ok(nearer.scale > farther.scale);
  assert.equal(behind.visible, false);
});

test('keeps every projected numeric field finite for extreme finite inputs', () => {
  const projected = projectCloudPoint(
    { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: Number.MAX_VALUE },
    { yaw: Number.MAX_VALUE, pitch: -Number.MAX_VALUE, distance: Number.MAX_VALUE },
    { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
  );
  for (const key of ['x', 'y', 'depth', 'scale']) {
    assert.equal(Number.isFinite(projected[key]), true, `${key} is not finite`);
  }
});

test('projects labeled X, Y, and Z axis endpoints', () => {
  const expected = {
    x: ['Acoustic', 'Electronic'],
    y: ['Calm', 'Intense'],
    z: ['Dark', 'Bright'],
  };
  for (const [axis, labels] of Object.entries(expected)) {
    const projected = projectCloudAxis(axis, DEFAULT_CLOUD_ORBIT, { width: 800, height: 600 });
    assert.equal(projected.start.visible, true);
    assert.equal(projected.end.visible, true);
    assert.equal(projected.start.label, labels[0]);
    assert.equal(projected.end.label, labels[1]);
  }
});
