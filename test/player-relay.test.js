import assert from 'node:assert/strict';
import test from 'node:test';
import { relayHlsUrl, relayUrl } from '../src/data/relay.js';

test('relay URLs are UUID-only and encode the id', () => {
  assert.equal(relayUrl('a b'), 'https://stations.radiodock.app/api/relay?uuid=a%20b');
  assert.equal(relayHlsUrl('a b'), 'https://stations.radiodock.app/api/relay/hls?uuid=a%20b');
});
