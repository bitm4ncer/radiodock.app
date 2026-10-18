import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, highlightMatches, countryLabel, letterForName, formatCount } from '../src/ui/stations-format.js';

test('escapeHtml escapes markup and quotes', () => {
  assert.equal(escapeHtml('<img src=x onerror="x">'), '&lt;img src=x onerror=&quot;x&quot;&gt;');
});

test('highlightMatches marks case-insensitive matches and escapes the rest', () => {
  assert.equal(highlightMatches('<b>Jazz</b>', 'jazz'), '&lt;b&gt;<mark>Jazz</mark>&lt;/b&gt;');
  assert.equal(highlightMatches('a.b', '.'), 'a<mark>.</mark>b');
  assert.equal(highlightMatches('Alpha', ''), 'Alpha');
});

test('letterForName buckets non A-Z starts under #', () => {
  assert.equal(letterForName(' dublab'), 'D');
  assert.equal(letterForName('1 Radio'), '#');
  assert.equal(letterForName('École'), '#');
  assert.equal(letterForName('Радио'), '#');
});

test('countryLabel and formatCount use stable labels', () => {
  assert.equal(countryLabel('DE', 'Germany'), 'Germany');
  assert.equal(countryLabel('', 'Fallback'), 'Fallback');
  assert.equal(formatCount(50247), '50,247');
});
