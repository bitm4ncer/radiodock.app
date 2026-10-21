import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAP_GAP,
  SNAP_MARGIN,
  resolveSnapPosition,
  resolvePanelInsertion,
} from '../src/ui/panel-snap.js';

const viewport = { width: 1000, height: 800 };

function resolve(overrides = {}) {
  return resolveSnapPosition({
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    others: [],
    viewport,
    ...overrides,
  });
}

test('leaves a clear drop position untouched', () => {
  const pos = resolve({
    others: [{ left: 400, top: 0, right: 600, bottom: 200 }],
  });
  assert.deepEqual(pos, { x: 100, y: 100 });
});

test('a gap of exactly SNAP_GAP is already clear', () => {
  const pos = resolve({
    others: [{ left: 300 + SNAP_GAP, top: 100, right: 600, bottom: 300 }],
  });
  assert.deepEqual(pos, { x: 100, y: 100 });
});

test('one pixel closer than the gap snaps away', () => {
  const pos = resolve({
    others: [{ left: 300 + SNAP_GAP - 1, top: 100, right: 600, bottom: 300 }],
  });
  assert.deepEqual(pos, {
    x: 300 + SNAP_GAP - 1 - SNAP_GAP - 200,
    y: 100,
  });
});

test('snaps to a free side with the shortest travel', () => {
  // The obstacle starts 50px right and 50px below the panel. The left and
  // top escapes are both 62px away; the first candidate (left) wins.
  const pos = resolve({
    others: [{ left: 250, top: 150, right: 450, bottom: 350 }],
  });
  assert.deepEqual(pos, { x: 250 - SNAP_GAP - 200, y: 100 });
});

test('snaps horizontally when both vertical sides are blocked', () => {
  const pos = resolve({
    others: [
      { left: 250, top: 150, right: 450, bottom: 350 },
      { left: 0, top: 50, right: 212, bottom: 600 },
    ],
  });
  assert.deepEqual(pos, { x: 450 + SNAP_GAP, y: 100 });
});

test('clamps the result to the viewport margin', () => {
  const pos = resolve({ x: -40, y: -40 });
  assert.deepEqual(pos, { x: SNAP_MARGIN, y: SNAP_MARGIN });
});

test('keeps the result inside the viewport when the panel barely fits', () => {
  const pos = resolve({
    x: -20,
    y: 400,
    width: 300,
    height: 100,
    viewport: { width: 320, height: 800 },
  });
  assert.equal(pos.x, SNAP_MARGIN);
  assert.ok(pos.x + 300 <= 320);
});

function insert(overrides = {}) {
  return resolvePanelInsertion({
    x: 380,
    y: 100,
    width: 200,
    height: 300,
    others: [
      { id: 'left', left: 100, top: 80, right: 400, bottom: 420, movable: true },
      { id: 'right', left: 520, top: 80, right: 820, bottom: 420, movable: true },
    ],
    viewport,
    ...overrides,
  });
}

test('squeezes the drop between two panels and pushes both outward', () => {
  const result = insert();
  assert.equal(result.inserted, true);
  assert.equal(result.x, 380);
  assert.deepEqual(result.moves, [
    { id: 'left', x: 68, y: 80 },
    { id: 'right', x: 592, y: 80 },
  ]);
});

test('does not squeeze when there is not enough room for both neighbours', () => {
  const result = insert({
    viewport: { width: 700, height: 800 },
    width: 200,
    x: 250,
    others: [
      { id: 'left', left: 0, top: 80, right: 300, bottom: 420, movable: true },
      { id: 'right', left: 400, top: 80, right: 700, bottom: 420, movable: true },
    ],
  });
  assert.equal(result.inserted, false);
});

test('does not squeeze with only one flanking panel', () => {
  const result = insert({
    others: [{ id: 'left', left: 100, top: 80, right: 400, bottom: 420, movable: true }],
  });
  assert.equal(result.inserted, false);
});

test('does not squeeze without enough vertical overlap', () => {
  const result = insert({
    y: 100,
    height: 100,
    others: [
      { id: 'left', left: 100, top: 300, right: 400, bottom: 600, movable: true },
      { id: 'right', left: 520, top: 300, right: 820, bottom: 600, movable: true },
    ],
  });
  assert.equal(result.inserted, false);
});

test('does not push a neighbour into an unmovable obstacle', () => {
  const result = insert({
    others: [
      { id: 'left', left: 100, top: 80, right: 400, bottom: 420, movable: true },
      { id: 'right', left: 520, top: 80, right: 820, bottom: 420, movable: true },
      { id: 'install', left: 0, top: 100, right: 100, bottom: 200, movable: false },
    ],
  });
  assert.equal(result.inserted, false);
});
