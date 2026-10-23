import assert from 'node:assert/strict';
import test from 'node:test';
import { relayHlsUrl, relayUrl } from '../src/data/relay.js';
import { isMixedContentStream } from '../src/player/audio.js';
import { isHlsStation, probeUrl } from '../src/player/stream-prober.js';

const UUID = '11111111-1111-4111-8111-111111111111';

test('relay URLs are UUID-only and encode the id', () => {
  assert.equal(relayUrl('a b'), 'https://stations.radiodock.app/api/relay?uuid=a%20b');
  assert.equal(relayHlsUrl('a b'), 'https://stations.radiodock.app/api/relay/hls?uuid=a%20b');
});

test('HTTP-only stations are mixed content on a secure page', () => {
  assert.equal(isMixedContentStream({ url: 'http://stream.example/live' }, true), true);
  assert.equal(isMixedContentStream({ url: 'https://stream.example/live' }, true), false);
  assert.equal(isMixedContentStream({ url: 'http://stream.example/live' }, false), false);
});

test('the prober does not decode-probe HLS manifests', () => {
  assert.equal(isHlsStation({ url: 'https://cdn.example/live.m3u8' }), true);
  assert.equal(isHlsStation({ url: 'https://cdn.example/live.m3u8?token=1' }), true);
  assert.equal(isHlsStation({ url: 'https://cdn.example/live.mp3' }), false);
  assert.equal(isHlsStation({ url: '' }), false);
});

test('the prober uses the relay for HTTP-only stations on a secure page', () => {
  const http = { id: UUID, url: 'http://stream.example/live' };
  assert.equal(probeUrl(http, true), relayUrl(UUID));
  assert.equal(probeUrl({ ...http, url: 'http://stream.example/live.m3u8' }, true), relayHlsUrl(UUID));
  assert.equal(probeUrl({ ...http, url: 'https://stream.example/live' }, true), 'https://stream.example/live');
  assert.equal(probeUrl(http, false), 'http://stream.example/live');
});
