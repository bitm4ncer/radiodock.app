import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTipPosition } from '../src/ui/tour-position.js';

const base = { tipWidth: 200, tipHeight: 40, viewportWidth: 1000, viewportHeight: 700 };

test('places the tip above a button that has room', () => {
  const spot = computeTipPosition({
    ...base,
    target: { left: 400, top: 300, bottom: 340, width: 100, height: 40 },
  });
  assert.deepEqual(spot, { top: 248, left: 350, arrowX: 95, below: false });
});

test('places the tip below a button near the top edge', () => {
  const spot = computeTipPosition({
    ...base,
    target: { left: 20, top: 10, bottom: 54, width: 44, height: 44 },
  });
  assert.equal(spot.below, true);
  assert.equal(spot.top, 66);
  assert.equal(spot.left, 12);
  assert.equal(spot.arrowX, 25);
});

test('keeps the bubble inside the right viewport edge', () => {
  const spot = computeTipPosition({
    ...base,
    target: { left: 930, top: 300, bottom: 340, width: 100, height: 40 },
  });
  assert.equal(spot.left, 788);
  assert.equal(spot.arrowX, 180);
});

test('clamps the bubble inside a very short viewport', () => {
  const spot = computeTipPosition({
    ...base,
    viewportHeight: 80,
    target: { left: 20, top: 10, bottom: 54, width: 44, height: 44 },
  });
  assert.equal(spot.top, 28);
});

test('preferBelow keeps the bubble off a tall target even when above would fit', () => {
  const spot = computeTipPosition({
    ...base,
    preferBelow: true,
    target: { left: 300, top: 200, bottom: 520, width: 400, height: 320 },
  });
  assert.equal(spot.below, true);
  assert.equal(spot.top, 532);
});
