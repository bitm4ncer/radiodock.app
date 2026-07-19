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

test('embedsHtml returns a YouTube search link (not iframe) when no youtube id but a query is given', () => {
  const html = embedsHtml({ query: 'Some Artist Some Title' });
  assert.doesNotMatch(html, /youtube\.com\/embed/);
  assert.match(html, /<a class="btn embed-yt-link"/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/results\?search_query=Some%20Artist%20Some%20Title"/);
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
