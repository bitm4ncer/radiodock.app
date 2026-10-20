import test from 'node:test';
import assert from 'node:assert/strict';
import { renderStationInfo } from '../src/ui/station-info-render.js';

const base = {
  id: 'uuid-1',
  name: 'Test Radio',
  countrycode: 'DE',
  city: 'Berlin',
  homepage: 'https://example.org',
  url: 'https://stream.example.org/live',
  codec: 'mp3',
  bitrate: 192,
  tags: ['jazz'],
  socials: [{ platform: 'instagram', url: 'https://instagram.com/testradio' }],
};

test('info body renders location, links, stream facts, tags and the edit CTA', () => {
  const html = renderStationInfo(base, {});
  assert.match(html, /flagcdn\.com\/de\.svg/);
  assert.match(html, /Berlin/);
  assert.match(html, /https:\/\/example\.org/);
  assert.match(html, /instagram\.com\/testradio/);
  assert.match(html, /ICY \/ HTTP/);
  assert.match(html, /MP3/);
  assert.match(html, /192 kbps/);
  assert.match(html, /station-info__tag">jazz</);
  assert.match(html, /Suggest an edit/);
});

test('info body escapes untrusted station text', () => {
  const html = renderStationInfo({
    ...base,
    city: '<img src=x onerror=alert(1)>',
    tags: ['<b>jazz</b>'],
  }, {});
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>jazz</b>'));
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;b&gt;jazz&lt;\/b&gt;/);
});
