import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PANEL_RESIZE_MARGIN,
  PANEL_RESIZE_MIN_HEIGHT,
  PANEL_RESIZE_MIN_WIDTH,
  resolvePanelSize,
} from '../src/ui/panel-resize.js';

const viewport = { viewportWidth: 1000, viewportHeight: 800 };
const origin = { left: 20, top: 20 };

function resolve(overrides = {}) {
  return resolvePanelSize({
    startWidth: 680,
    startHeight: 600,
    ...origin,
    ...viewport,
    ...overrides,
  });
}

test('grows freely while the pointer stays inside the bounds', () => {
  assert.deepEqual(resolve({ deltaX: 100, deltaY: 50 }), {
    width: 780,
    height: 650,
  });
});

test('stops at the minimum size when shrinking', () => {
  assert.deepEqual(resolve({ deltaX: -500, deltaY: -500 }), {
    width: PANEL_RESIZE_MIN_WIDTH,
    height: PANEL_RESIZE_MIN_HEIGHT,
  });
});

test('caps the width at the absolute maximum', () => {
  const size = resolve({
    startWidth: 800,
    startHeight: 600,
    deltaX: 500,
    left: 0,
    top: 0,
    viewportWidth: 1200,
  });
  assert.equal(size.width, 960);
});

test('never grows past the space left of and below the top-left corner', () => {
  const size = resolve({
    startWidth: 500,
    startHeight: 500,
    deltaX: 500,
    deltaY: 500,
    left: 400,
    top: 100,
    viewportWidth: 1000,
    viewportHeight: 700,
  });
  assert.equal(size.width, 1000 - 400 - PANEL_RESIZE_MARGIN);
  assert.equal(size.height, 700 - 100 - PANEL_RESIZE_MARGIN);
});

test('the viewport wins when it is smaller than the preferred minimum', () => {
  const size = resolve({
    startWidth: 680,
    startHeight: 600,
    left: 0,
    top: 0,
    viewportWidth: 500,
    viewportHeight: 500,
  });
  assert.equal(size.width, 500 - PANEL_RESIZE_MARGIN);
  assert.equal(size.height, 500 - PANEL_RESIZE_MARGIN);
});

test('rounds fractional pointer deltas to whole pixels', () => {
  const size = resolve({ startWidth: 680.4, startHeight: 600.4, deltaX: 10.4, deltaY: 0.2 });
  assert.deepEqual(size, { width: 691, height: 601 });
});
