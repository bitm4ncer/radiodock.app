import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedHttpUrl } from '../src/data/url-validation.js';

test('isAllowedHttpUrl accepts clean http(s) URLs and rejects non-http(s) schemes and malformed strings', () => {
  assert.equal(isAllowedHttpUrl('https://radiodock.app'), true);
  assert.equal(isAllowedHttpUrl('http://stream.example/live'), true);
  assert.equal(isAllowedHttpUrl('https://user:pass@example.com'), true);

  assert.equal(isAllowedHttpUrl('custom-protocol:payload'), false);
  assert.equal(isAllowedHttpUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedHttpUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedHttpUrl('ftp://example.com'), false);
  assert.equal(isAllowedHttpUrl('mailto:a@b.c'), false);

  assert.equal(isAllowedHttpUrl(''), false);
  assert.equal(isAllowedHttpUrl('   '), false);
  assert.equal(isAllowedHttpUrl('not a url'), false);
  assert.equal(isAllowedHttpUrl(null), false);
  assert.equal(isAllowedHttpUrl(undefined), false);
});
