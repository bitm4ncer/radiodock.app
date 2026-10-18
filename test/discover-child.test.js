import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDiscover, featuredList, renderDiscover } from '../src/ui/discover-child.js';

test('normaliseDiscover keeps valid curated lists only', () => {
  const data = { curated: { lists: [
    { slug: 'party', title: 'Party', stations: [{ stationuuid: 'a', name: 'A' }] },
    { slug: '', title: '', stations: [] },
    { slug: 'jazz', title: 'Jazz', stations: [{ stationuuid: 'b', name: 'B' }] },
  ] } };
  assert.deepEqual(normaliseDiscover(data).lists.map((l) => l.slug), ['party', 'jazz']);
  assert.equal(normaliseDiscover(null).lists.length, 0);
});

test('featuredList returns the first list or null', () => {
  assert.equal(featuredList([{ slug: 'a' }]).slug, 'a');
  assert.equal(featuredList([]), null);
});

test('renderDiscover uses singular copy for one collection', () => {
  const html = renderDiscover({
    lists: [{ slug: 'party', title: 'Party', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [],
  });
  assert.match(html, /1 collection/);
  assert.doesNotMatch(html, /1 collections/);
  assert.match(html, /1 station/);
  assert.doesNotMatch(html, /1 stations/);
});
