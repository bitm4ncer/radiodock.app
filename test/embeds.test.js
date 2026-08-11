import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedsHtml, pickProvider, hasAnyEmbed, safeUrl, PROVIDERS } from '../src/ui/embeds.js';

const ids = (over = {}) => ({
  spotify: '', apple: { id: '', country: '' }, tidal: '', youtube: '', ...over,
});

test('embedsHtml renders the preferred provider', () => {
  const html = embedsHtml({ preferred: 'spotify', ids: ids({ spotify: '4uLU6hMCjMI75M1A2tKUQC' }) });
  assert.match(html, /<iframe class="embed-frame"/);
  assert.match(html, /src="https:\/\/open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC"/);
});

test('embedsHtml renders EXACTLY one player, never a stack', () => {
  const html = embedsHtml({
    preferred: 'tidal',
    ids: ids({ spotify: 'sp1234567890', tidal: '77687625', youtube: 'dQw4w9WgXcQ' }),
  });
  assert.equal(html.match(/<iframe/g).length, 1);
  assert.match(html, /embed\.tidal\.com\/tracks\/77687625/);
  assert.doesNotMatch(html, /open\.spotify\.com/);
  assert.doesNotMatch(html, /youtube\.com/);
});

test('Apple Music embeds with its storefront', () => {
  const html = embedsHtml({ preferred: 'apple', ids: ids({ apple: { id: '1558534271', country: 'DE' } }) });
  assert.match(html, /embed\.music\.apple\.com\/de\/song\/1558534271/);
});

test('an Apple id without a storefront is not playable — the embed would 404', () => {
  const only = ids({ apple: { id: '1558534271', country: '' } });
  assert.equal(pickProvider('apple', only), null);
  assert.equal(hasAnyEmbed(only), false);
  assert.equal(embedsHtml({ preferred: 'apple', ids: only }), '');
});

test('an unavailable preferred provider falls back and says so', () => {
  const html = embedsHtml({ preferred: 'tidal', ids: ids({ spotify: 'sp1234567890' }) });
  assert.match(html, /open\.spotify\.com/);
  assert.match(html, /class="embed-via">via Spotify</);
});

test('no caption when the preferred provider is the one that plays', () => {
  const html = embedsHtml({ preferred: 'spotify', ids: ids({ spotify: 'sp1234567890' }) });
  assert.doesNotMatch(html, /embed-via/);
});

test('the fallback follows registry order', () => {
  const order = PROVIDERS.map((p) => p.id);
  assert.deepEqual(order, ['spotify', 'apple', 'tidal', 'youtube']);
  assert.equal(pickProvider('nonsense', ids({ tidal: '1', youtube: 'v' })), 'tidal');
});

test('embedsHtml never falls back to a YouTube search — only an exact video id embeds', () => {
  const html = embedsHtml({ preferred: 'youtube', ids: ids({ query: 'Some Artist Some Title' }) });
  assert.doesNotMatch(html, /youtube\.com\/embed/);
  assert.doesNotMatch(html, /youtube\.com\/results/);
  assert.equal(html, '');
});

test('embedsHtml escapes/strips a malicious id so the script never appears raw', () => {
  const html = embedsHtml({ preferred: 'spotify', ids: ids({ spotify: 'abc"><script>alert(1)</script>' }) });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /src="https:\/\/open\.spotify\.com\/embed\/track\/abcscriptalert1script"/);
});

test('a malicious storefront cannot escape the Apple embed path', () => {
  const html = embedsHtml({ preferred: 'apple', ids: ids({ apple: { id: '123', country: '../evil' } }) });
  assert.doesNotMatch(html, /\.\./);
  assert.equal(html, '');
});

test('embedsHtml returns empty string when nothing is playable', () => {
  assert.equal(embedsHtml({ preferred: 'spotify', ids: ids() }), '');
  assert.equal(embedsHtml({}), '');
});

test('safeUrl rejects javascript: and allows https://', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
});
