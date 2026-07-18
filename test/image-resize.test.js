import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDimensions } from '../src/data/image-resize.js';

test('fitDimensions scales the longest side down to maxPx, keeps ratio', () => {
  assert.deepEqual(fitDimensions(1024, 512, 512), { w: 512, h: 256 });
  assert.deepEqual(fitDimensions(300, 900, 512), { w: 171, h: 512 });
});

test('fitDimensions never upscales', () => {
  assert.deepEqual(fitDimensions(100, 80, 512), { w: 100, h: 80 });
});
