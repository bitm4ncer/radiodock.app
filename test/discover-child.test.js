import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseDiscover, renderDiscover, renderDiscoverToolbar, renderCollection, collectionCard, featuredLists, pickFeaturedLists, renderDiscoverUnavailable } from '../src/ui/discover-child.js';

const searchLists = [
  { slug: 'jazz', title: 'Jazz', source: 'radiodock', featured: true, stations: [
    { stationuuid: 'j1', name: 'Jazz FM', countrycode: 'GB' },
  ] },
  { slug: 'news', title: 'News', source: 'radiodock', featured: true, stations: [
    { stationuuid: 'n1', name: 'World News', countrycode: 'US' },
  ] },
  { slug: 'community-jazz', title: 'Community Jazz', source: 'user', featured: false, stations: [
    { stationuuid: 'c1', name: 'Local Jazz', countrycode: 'DE' },
  ] },
];

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

test('renderDiscoverUnavailable produces an honest unavailable message', () => {
  const html = renderDiscoverUnavailable();
  assert.match(html, /unavailable/i);
  assert.ok(!html.includes('Loading'));
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

test('renders the discover toolbar with search and three views', () => {
  const html = renderDiscoverToolbar({ view: 'large', query: 'jazz' });
  assert.match(html, /stations-discover-toolbar/);
  assert.match(html, /type="search"/);
  assert.match(html, /placeholder="Search collections or stations"/);
  assert.match(html, /aria-label="Collection view"/);
  assert.match(html, /data-view="large"[^>]*aria-pressed="true"/);
  assert.match(html, /data-view="small"[^>]*aria-pressed="false"/);
  assert.match(html, /data-view="cloud"[^>]*aria-pressed="false"/);
  assert.equal((html.match(/data-view=/g) ?? []).length, 3);
});

test('renderDiscover keeps the toolbar and results container', () => {
  const html = renderDiscover({ lists: searchLists });
  assert.match(html, /stations-discover-toolbar[\s\S]*id="discoverResults"/);
  assert.match(html, /data-view="small"[^>]*aria-pressed="true"/);
});

test('filters collections and stations by a case-insensitive substring', () => {
  const html = renderDiscover({ lists: searchLists, query: 'JAZZ' });
  assert.match(html, /data-collection="jazz"/);
  assert.match(html, /data-collection="community-jazz"/);
  assert.doesNotMatch(html, /data-collection="news"/);
  assert.match(html, /stations-row-source[^>]*>Jazz<\/span>/);
  assert.match(html, /stations-row-source[^>]*>Community Jazz<\/span>/);
  assert.match(html, /data-id="j1"/);
  assert.match(html, /data-id="c1"/);
});

test('shows station matches with their source collection', () => {
  const html = renderDiscover({ lists: searchLists, query: 'world' });
  assert.match(html, /data-id="n1"/);
  assert.match(html, /World News/);
  assert.match(html, /stations-row-source[^>]*title="News"/);
  assert.doesNotMatch(html, /data-collection="news"/);
});

test('shows a no-results state with a clear action', () => {
  const html = renderDiscover({ lists: searchLists, query: 'zzzz' });
  assert.match(html, /No collections or stations match "zzzz"\./);
  assert.match(html, /data-action="clear-discover-search"/);
});

test('clearing the query restores the normal sections', () => {
  const html = renderDiscover({ lists: searchLists });
  assert.match(html, /Community collections/);
  assert.match(html, /stations-submit-link/);
  assert.match(html, /data-collection="jazz"/);
  assert.match(html, /data-collection="news"/);
});

test('community cards keep their kicker in search', () => {
  const html = renderDiscover({ lists: searchLists, query: 'community' });
  assert.match(html, /stations-collection-card[^"]*is-user/);
  assert.match(html, /Community collection/);
});

test('existing save states still render', () => {
  const html = renderDiscover({ lists: searchLists, isSaved: () => true });
  assert.match(html, /is-saved/);
});

test('large mode renders one card per collection', () => {
  const html = renderDiscover({ lists: searchLists, view: 'large' });
  assert.match(html, /stations-collection-large/);
  assert.match(html, /stations-collection-card is-large/);
  assert.match(html, /data-action="toggle-collection"/);
  assert.match(html, /data-slug="jazz"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Show all stations in Jazz"/);
});

test('large cards keep the save button visible', () => {
  const html = renderDiscover({ lists: searchLists, view: 'large' });
  assert.match(html, /stations-collection-large-actions[\s\S]*stations-collection-save/);
});

test('large expanded card renders every station', () => {
  const news = {
    slug: 'news',
    title: 'News',
    source: 'radiodock',
    stations: Array.from({ length: 51 }, (_, i) => ({ stationuuid: `n${i}`, name: `News ${i}`, countrycode: 'US' })),
  };
  const html = renderDiscover({ lists: [news], view: 'large', expandedSlug: 'news' });
  assert.equal((html.match(/class="stations-collection-tile"/g) ?? []).length, 51);
  assert.match(html, /stations-collection-large-stations/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="Hide stations in News"/);
});

test('only one large collection expands', () => {
  const html = renderDiscover({ lists: searchLists, view: 'large', expandedSlug: 'jazz' });
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/stations-collection-large-stations/g) ?? []).length, 1);
});

test('community collections keep their section in large mode', () => {
  const html = renderDiscover({ lists: searchLists, view: 'large' });
  assert.match(html, /Community collections/);
  assert.match(html, /stations-collection-card is-large is-user/);
});
