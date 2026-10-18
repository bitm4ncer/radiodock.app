import test from 'node:test';
import assert from 'node:assert/strict';
import { browseStations, getBrowseMeta, getRandomStation } from '../src/data/stations-api.js';
import { loadDiscover, clearDiscoverCache } from '../src/data/discover.js';

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = original; };
}

test('browseStations sends filters and normalises the response', async () => {
  let seen = '';
  const restore = stubFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({
      stations: [{ stationuuid: 'd1', name: 'Dublab', url: 'http://d1', countrycode: 'US', tags: 'ambient, dub', info: 'Text', city: 'LA', plays: 20, rank: 1 }],
      total: 1, offset: 0, limit: 100, nextOffset: null,
      letterCounts: { All: 1, '#': 0, D: 1 }, statsUpdatedAt: null, popularMinPlays: 5,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const out = await browseStations({ mode: 'az', letter: 'D', country: 'US', genre: 'jazz', hasDescription: true });
    assert.ok(seen.includes('/json/stations/browse?'));
    assert.ok(seen.includes('mode=az'));
    assert.ok(seen.includes('letter=D'));
    assert.ok(seen.includes('country=US'));
    assert.ok(seen.includes('genre=jazz'));
    assert.equal(out.stations[0].id, 'd1');
    assert.deepEqual(out.stations[0].tags, ['ambient', 'dub']);
    assert.equal(out.stations[0].info, 'Text');
    assert.equal(out.total, 1);
  } finally { restore(); }
});

test('meta, random, and discover handle missing data', async () => {
  let restore = stubFetch(() => new Response(JSON.stringify({ totalStations: 1, countries: [], genres: [] }), { status: 200 }));
  try { assert.equal((await getBrowseMeta()).totalStations, 1); } finally { restore(); }

  restore = stubFetch(() => new Response(JSON.stringify({ station: null }), { status: 200 }));
  try { assert.equal(await getRandomStation({ country: 'DE' }), null); } finally { restore(); }

  clearDiscoverCache();
  restore = stubFetch(() => new Response('missing', { status: 404 }));
  try { assert.equal(await loadDiscover(), null); } finally { restore(); }
});
