import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitDimensions, dataUrlBytes } from '../src/data/image-resize.js';

test('fitDimensions scales the longest side down to maxPx, keeps ratio', () => {
  assert.deepEqual(fitDimensions(1024, 512, 512), { w: 512, h: 256 });
  assert.deepEqual(fitDimensions(300, 900, 512), { w: 171, h: 512 });
});

test('fitDimensions never upscales', () => {
  assert.deepEqual(fitDimensions(100, 80, 512), { w: 100, h: 80 });
});

test('dataUrlBytes returns the decoded length of a base64 payload', () => {
  // 4 chars decode to 3 bytes, minus one byte per '=' of padding.
  assert.equal(dataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(dataUrlBytes('data:image/webp;base64,AAA='), 2);
  assert.equal(dataUrlBytes('data:image/jpeg;base64,AA=='), 1);
});

test('dataUrlBytes ignores input that is not a data-URL', () => {
  assert.equal(dataUrlBytes(null), 0);
  assert.equal(dataUrlBytes(''), 0);
  assert.equal(dataUrlBytes('https://example.com/logo.png'), 0);
});
