import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDiscover, renderDiscover, renderCollection, collectionCard, featuredLists, pickFeaturedLists } from '../src/ui/discover-child.js';

test('normaliseDiscover keeps valid curated lists only', () => {
  const data = { curated: { lists: [
    { slug: 'party', title: 'Party', stations: [{ stationuuid: 'a', name: 'A' }] },
    { slug: '', title: '', stations: [] },
    { slug: 'jazz', title: 'Jazz', stations: [{ stationuuid: 'b', name: 'B' }] },
  ] } };
  assert.deepEqual(normaliseDiscover(data).lists.map((l) => l.slug), ['party', 'jazz']);
  assert.equal(normaliseDiscover(null).lists.length, 0);
});

test('renderDiscover uses singular copy for one station', () => {
  const html = renderDiscover({
    lists: [{ slug: 'party', title: 'Party', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [],
  });
  assert.doesNotMatch(html, /Curated by RadioDock/);
  assert.match(html, /1 station/);
  assert.doesNotMatch(html, /1 stations/);
});

test('normaliseDiscover keeps the whole featured pool', () => {
  const lists = Array.from({ length: 8 }, (_, i) => ({
    slug: `list-${i}`,
    title: `List ${i}`,
    featured: i < 7,
    stations: [{ stationuuid: 'a', name: 'A' }],
  }));
  const normalised = normaliseDiscover({ curated: { lists } }).lists;
  assert.equal(normalised[0].featured, true);
  assert.equal(normalised[7].featured, false);
  assert.equal(featuredLists(normalised).length, 7);
  assert.equal(featuredLists(normalised, 2).length, 2);
  assert.deepEqual(featuredLists(normalised).map((l) => l.slug), ['list-0', 'list-1', 'list-2', 'list-3', 'list-4', 'list-5', 'list-6']);
});

test('pickFeaturedLists rotates four unique picks from the featured pool', () => {
  const lists = Array.from({ length: 8 }, (_, i) => ({
    slug: `list-${i}`,
    title: `List ${i}`,
    featured: i < 6,
    stations: [{ stationuuid: 'a', name: 'A' }],
  }));
  const picks = pickFeaturedLists(lists, 4, () => 0.42);
  assert.equal(picks.length, 4);
  assert.equal(new Set(picks.map((l) => l.slug)).size, 4);
  assert.ok(picks.every((l) => l.featured));
});

test('pickFeaturedLists returns the whole pool when it is smaller than four', () => {
  const lists = Array.from({ length: 3 }, (_, i) => ({
    slug: `list-${i}`,
    title: `List ${i}`,
    featured: true,
    stations: [{ stationuuid: 'a', name: 'A' }],
  }));
  assert.deepEqual(pickFeaturedLists(lists).map((l) => l.slug), ['list-0', 'list-1', 'list-2']);
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
  assert.doesNotMatch(html, /Curated by RadioDock/);
  assert.match(html, /Community collections/);
  assert.match(html, /Suggest a collection/);
  assert.doesNotMatch(html, /Collection of the week/);
  assert.doesNotMatch(html, /stations-feature/);
  assert.match(html, /stations-collection-grid/);
  assert.match(html, /My Jazz/);
});

test('renderDiscover shows the submit CTA even when no community collections exist', () => {
  const html = renderDiscover({
    lists: [{ slug: 'jazz', title: 'Jazz', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] }],
    genres: [],
  });
  assert.match(html, /No community collections yet/);
  assert.match(html, /stations-submit-link/);
  assert.match(html, /Suggest a collection/);
});

test('renderDiscover keeps the user CTA when the database has no collections', () => {
  const html = renderDiscover({ lists: [], genres: [] });
  assert.match(html, /Collections are being prepared/);
  assert.match(html, /Community collections/);
  assert.match(html, /Suggest a collection/);
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

test('collection cards expose a separate save-as-list button', () => {
  const html = collectionCard(
    { slug: 'news', title: 'News', stations: [{ stationuuid: 'a', name: 'A' }] },
    { saved: false },
  );
  assert.match(html, /stations-collection-card-wrap/);
  assert.match(html, /stations-collection-card-wrap[\s\S]*data-collection="news"[\s\S]*<\/button>/);
  assert.match(html, /data-action="save-collection"[^>]*data-slug="news"/);
  assert.match(html, /aria-label="Save collection as a list"/);
  assert.match(html, /aria-pressed="false"/);
});

test('saved collections render a checked save button', () => {
  const html = renderDiscover({
    lists: [{ slug: 'news', title: 'News', source: 'radiodock', stations: [{ stationuuid: 'a', name: 'A' }] }],
    isSaved: (slug) => slug === 'news',
  });
  const save = html.match(/<button[^>]*data-action="save-collection"[^>]*>/)[0];
  assert.match(save, /is-saved/);
  assert.match(save, /aria-pressed="true"/);
  assert.match(save, /aria-label="Collection saved as a list"/);
});
