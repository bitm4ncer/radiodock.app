import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDiscover, renderDiscover, renderCollection } from '../src/ui/discover-child.js';

test('normaliseDiscover keeps valid curated lists only', () => {
  const data = { curated: { lists: [
    { slug: 'party', title: 'Party', stations: [{ stationuuid: 'a', name: 'A' }] },
    { slug: '', title: '', stations: [] },
    { slug: 'jazz', title: 'Jazz', stations: [{ stationuuid: 'b', name: 'B' }] },
  ] } };
  assert.deepEqual(normaliseDiscover(data).lists.map((l) => l.slug), ['party', 'jazz']);
  assert.equal(normaliseDiscover(null).lists.length, 0);
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
  assert.doesNotMatch(html, /Collection of the week/);
  assert.doesNotMatch(html, /stations-feature/);
  assert.match(html, /stations-collection-grid/);
  assert.match(html, /My Jazz/);
});

test('renderDiscover shows the submit CTA even when no user playlists exist', () => {
  const html = renderDiscover({
    lists: [{ slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [],
  });
  assert.match(html, /No user playlists yet/);
  assert.match(html, /stations-submit-link/);
  assert.match(html, /Submit Playlist/);
});

test('renderDiscover keeps the user CTA when the database has no collections', () => {
  const html = renderDiscover({ lists: [], genres: [] });
  assert.match(html, /Collections are being prepared/);
  assert.match(html, /Curated by users/);
  assert.match(html, /Submit Playlist/);
});

test('renderDiscover never renders the genre browser', () => {
  const html = renderDiscover({
    lists: [{ slug: 'jazz', title: 'Jazz', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [{ genre: 'pop', label: 'Pop' }, { genre: 'news', label: 'News' }],
  });
  assert.doesNotMatch(html, /Browse by genre/);
  assert.doesNotMatch(html, /data-genre/);
  assert.doesNotMatch(html, /stations-genre-chips/);
});

test('collection cards keep the logo stack and the title/count copy on one row', () => {
  const html = renderDiscover({
    lists: [{ slug: 'news', title: 'News', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] }],
  });
  const card = html.match(/<button[^>]*data-collection="news"[\s\S]*?<\/button>/)[0];
  assert.match(card, /stations-collection-card-top[\s\S]*stations-collection-card-copy/);
  assert.match(card, /stations-collection-card-copy[\s\S]*<strong>News<\/strong>[\s\S]*stations-collection-card-count[^>]*>1 station</);
});

test('collection tiles use the favorite heart instead of a plus', () => {
  const html = renderCollection({
    list: { title: 'News', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] },
  });
  assert.match(html, /data-action="collection-add"[^>]*aria-label="Add to list"[^>]*>\s*<svg/);
  assert.doesNotMatch(html, /aria-label="Add to list"[^>]*>\s*\+/);
});

test('renderDiscover places the compact submit CTA in the user section heading', () => {
  const html = renderDiscover({
    lists: [
      { slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] },
      { slug: 'my-jazz', title: 'My Jazz', source: 'user', stations: [{ stationuuid: 'b', name: 'B' }] },
    ],
    genres: [],
  });
  const sectionStart = html.indexOf('stations-user-collections');
  const headStart = html.indexOf('stations-section-head', sectionStart);
  const linkIndex = html.indexOf('stations-submit-link', sectionStart);
  const gridIndex = html.indexOf('stations-collection-grid', sectionStart);
  assert.ok(headStart >= 0);
  assert.ok(linkIndex > headStart);
  assert.ok(linkIndex < gridIndex);
  assert.ok(!html.includes('stations-submit-card'));
});
