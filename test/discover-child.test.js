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

test('normaliseDiscover preserves user list provenance', () => {
  const data = { curated: { lists: [
    { slug: 'official', title: 'Official', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] },
    { slug: 'listener', title: 'Listener', source: 'user', stations: [{ stationuuid: 'b', name: 'B' }] },
  ] } };
  const lists = normaliseDiscover(data).lists;
  assert.equal(lists[0].source, 'radiodock');
  assert.equal(lists[1].source, 'user');
});

test('renderDiscover splits official and user collections', () => {
  const html = renderDiscover({
    lists: [
      { slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] },
      { slug: 'my-jazz', title: 'My Jazz', source: 'user', stations: [{ stationuuid: 'b', name: 'B' }] },
    ],
    genres: [],
  });
  assert.match(html, /Curated by RadioDock/);
  assert.match(html, /Curated by users/);
  assert.match(html, /Submit Playlist/);
  assert.match(html, /Your submission will be reviewed and published here\./);
  assert.match(html, /Collection of the week/);
  assert.match(html, /My Jazz/);
});

test('renderDiscover shows the submit CTA even when no user playlists exist', () => {
  const html = renderDiscover({
    lists: [{ slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [],
  });
  assert.match(html, /No user playlists yet/);
  assert.match(html, /Submit Playlist/);
  assert.match(html, /Your submission will be reviewed and published here\./);
});

test('renderDiscover keeps the user CTA when the database has no collections', () => {
  const html = renderDiscover({ lists: [], genres: [] });
  assert.match(html, /Collections are being prepared/);
  assert.match(html, /Curated by users/);
  assert.match(html, /Submit Playlist/);
});

test('renderDiscover places the submit CTA after the published user playlists', () => {
  const html = renderDiscover({
    lists: [
      { slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] },
      { slug: 'my-jazz', title: 'My Jazz', source: 'user', stations: [{ stationuuid: 'b', name: 'B' }] },
    ],
    genres: [],
  });
  assert.ok(html.indexOf('stations-collection-card is-user') < html.indexOf('stations-submit-card'));
});
