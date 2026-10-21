import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tryDecodeShareHash } from '../src/data/share.js';

test('tryDecodeShareHash rejects an oversized encoded input', async () => {
  await assert.rejects(() => tryDecodeShareHash('#s=' + 'A'.repeat(2_000_001)));
});

test('tryDecodeShareHash rejects a share whose decompressed size exceeds the cap', async () => {
  const big = JSON.stringify({ version: '2.0', listName: 'X', stations: [] }) + ' '.repeat(5_000_001);
  const stream = new Blob([big]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await assert.rejects(() => tryDecodeShareHash('#s=' + encoded));
});

test('tryDecodeShareHash rejects too many stations before confirmation', async () => {
  const payload = { version: '2.0', listName: 'X', stations: Array.from({ length: 5001 }, (_, i) => ({ id: `s${i}`, name: 'n', url: 'http://n' })) };
  const stream = new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await assert.rejects(() => tryDecodeShareHash('#s=' + encoded));
});
