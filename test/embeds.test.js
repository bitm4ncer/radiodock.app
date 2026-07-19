import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedsHtml, safeUrl } from '../src/ui/embeds.js';

test('embedsHtml returns a Spotify iframe for a valid id', () => {
  const html = embedsHtml({ spotify: '4uLU6hMCjMI75M1A2tKUQC' });
  assert.match(html, /<iframe class="embed-frame"/);
  assert.match(html, /src="https:\/\/open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC"/);
});

test('embedsHtml returns a YouTube iframe for a valid youtube id', () => {
  const html = embedsHtml({ youtube: 'dQw4w9WgXcQ' });
  assert.match(html, /<iframe class="embed-frame"/);
  assert.match(html, /src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/);
});

test('embedsHtml never falls back to a YouTube search — only an exact video id embeds', () => {
  // No youtube id → nothing, even with a query (a name search surfaces the wrong track).
  const html = embedsHtml({ youtube: '', query: 'Some Artist Some Title' });
  assert.doesNotMatch(html, /youtube\.com\/embed/);
  assert.doesNotMatch(html, /youtube\.com\/results/);
  assert.doesNotMatch(html, /embed-yt-link/);
  assert.equal(html, '');
});

test('embedsHtml escapes/strips a malicious id so the script never appears raw', () => {
  const html = embedsHtml({ spotify: 'abc"><script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /src="https:\/\/open\.spotify\.com\/embed\/track\/abcscriptalert1script"/);
});

test('embedsHtml returns empty string for empty input', () => {
  assert.equal(embedsHtml({}), '');
  assert.equal(embedsHtml({ spotify: '', youtube: '', query: '' }), '');
});

test('safeUrl rejects javascript: and allows https://', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a');
});
