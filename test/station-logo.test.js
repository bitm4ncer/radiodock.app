import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLogoSlot } from '../src/ui/station-logo.js';

test('logo slot falls back to initials when no favicon exists', () => {
  const html = renderLogoSlot({ id: 'abc', name: 'Alpha Radio', favicon: '' });
  assert.match(html, /station-item-initials/);
  assert.doesNotMatch(html, /<img/);
});

test('logo slot renders the CDN image when a favicon exists', () => {
  const html = renderLogoSlot({ id: 'abc', name: 'Alpha Radio', favicon: 'https://example.test/logo.png' });
  assert.match(html, /<img/);
  assert.match(html, /\/logos\/abc\?size=64/);
});
