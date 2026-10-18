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

test('logo slot keeps initials behind a lazily loaded image', () => {
  const html = renderLogoSlot({ id: 'abc', name: 'Alpha Radio', favicon: 'https://example.test/logo.png' });
  assert.match(html, /logo-fallback/);
  assert.match(html, /data-logo-fallback="1"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /loading="lazy"/);
});

test('priority logo slots load eagerly with high fetch priority', () => {
  const html = renderLogoSlot({ id: 'abc', name: 'Alpha Radio', favicon: 'https://example.test/logo.png' }, { priority: true });
  assert.match(html, /loading="eager"/);
  assert.match(html, /fetchpriority="high"/);
});
