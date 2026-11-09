import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeHtmlEntities } from '../src/data/html-entities.js';

test('decodes named and numeric HTML entities', () => {
  assert.equal(decodeHtmlEntities('A &amp; B'), 'A & B');
  assert.equal(decodeHtmlEntities('It&#39;s &quot;fine&quot;'), 'It\'s "fine"');
  assert.equal(decodeHtmlEntities('&#x27; &Amp; &lt;'), '\' & <');
  assert.equal(decodeHtmlEntities('Caf&eacute; &nbsp;'), 'Café  ');
});

test('decodes double-encoded feeds without touching plain ampersands', () => {
  assert.equal(decodeHtmlEntities('A &amp;amp; B'), 'A & B');
  assert.equal(decodeHtmlEntities('A & B'), 'A & B');
  assert.equal(decodeHtmlEntities('&unknown;'), '&unknown;');
  assert.equal(decodeHtmlEntities(null), '');
});
