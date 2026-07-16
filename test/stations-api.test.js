import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchStations, getStationByUuid, STATIONS_BASE } from '../src/data/stations-api.js';

// Minimal RB-shaped station row the Stations API returns (contract-compatible).
function row(overrides = {}) {
  return {
    stationuuid: 'uuid-1',
    name: '  NTS Radio  ',
    url: 'http://stream/nts',
    url_resolved: 'https://stream/nts',
    countrycode: 'GB',
    favicon: 'https://fav/nts.png',
    homepage: 'https://nts.live',
    tags: 'jazz, ambient',
    bitrate: 128,
    codec: 'MP3',
    votes: 5,
    clickcount: 42,
    ...overrides,
  };
}

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data };
}

test('searchStations hits the Stations API search endpoint with name and maps to the canonical shape', async () => {
  const f = stubFetch(() => jsonResponse([row()]));
  try {
    const out = await searchStations({ query: 'nts', filter: 'name' });
    assert.ok(f.calls[0].url.startsWith(`${STATIONS_BASE}/json/stations/search?`));
    const u = new URL(f.calls[0].url);
    assert.equal(u.searchParams.get('name'), 'nts');
    assert.equal(u.searchParams.get('hidebroken'), 'true');
    assert.deepEqual(out[0], {
      id: 'uuid-1',
      name: 'NTS Radio',
      url: 'https://stream/nts',
      countrycode: 'GB',
      favicon: 'https://fav/nts.png',
      homepage: 'https://nts.live',
      tags: ['jazz', 'ambient'],
      bitrate: 128,
      codec: 'MP3',
      votes: 5,
      clickcount: 42,
    });
  } finally {
    f.restore();
  }
});

test('searchStations with tag filter sends tag=', async () => {
  const f = stubFetch(() => jsonResponse([]));
  try {
    await searchStations({ query: 'ambient', filter: 'tag' });
    const u = new URL(f.calls[0].url);
    assert.equal(u.searchParams.get('tag'), 'ambient');
    assert.equal(u.searchParams.get('name'), null);
  } finally {
    f.restore();
  }
});

test('searchStations never sends a country param (filter removed)', async () => {
  const f = stubFetch(() => jsonResponse([]));
  try {
    await searchStations({ query: 'Germany', filter: 'country' });
    const u = new URL(f.calls[0].url);
    assert.equal(u.searchParams.get('country'), null);
    // an unknown filter falls back to name search
    assert.equal(u.searchParams.get('name'), 'Germany');
  } finally {
    f.restore();
  }
});

test('searchStations throws on a non-ok response so the caller can fall back', async () => {
  const f = stubFetch(() => jsonResponse(null, false, 500));
  try {
    await assert.rejects(() => searchStations({ query: 'x', filter: 'name' }));
  } finally {
    f.restore();
  }
});

test('getStationByUuid hits byuuid and maps the single result', async () => {
  const f = stubFetch(() => jsonResponse([row()]));
  try {
    const s = await getStationByUuid('uuid-1');
    assert.equal(f.calls[0].url, `${STATIONS_BASE}/json/stations/byuuid/uuid-1`);
    assert.equal(s.id, 'uuid-1');
    assert.equal(s.name, 'NTS Radio');
  } finally {
    f.restore();
  }
});

test('getStationByUuid returns null on a 404 (tombstoned/unknown)', async () => {
  const f = stubFetch(() => jsonResponse(null, false, 404));
  try {
    assert.equal(await getStationByUuid('gone'), null);
  } finally {
    f.restore();
  }
});

test('getStationByUuid returns null on an empty array', async () => {
  const f = stubFetch(() => jsonResponse([]));
  try {
    assert.equal(await getStationByUuid('none'), null);
  } finally {
    f.restore();
  }
});
