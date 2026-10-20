// RadioDock Stations API client.
// https://stations.radiodock.app — our own curated station database, a
// contract-compatible mirror of the Radio Browser `/json/stations/*` shape.
// This module mirrors radio-browser.js's two-function surface exactly so the
// source can be swapped by transport, not by adapter. Single origin, no mirror
// rotation — availability is covered by the Radio Browser fallback one layer up
// (see stations-source.js).

// Production always uses the hosted origin. In dev, VITE_STATIONS_BASE can point
// the client at a locally-running Stations server for end-to-end testing.
export const STATIONS_BASE = import.meta.env?.DEV
  ? (import.meta.env.VITE_STATIONS_BASE || 'https://stations.radiodock.app')
  : 'https://stations.radiodock.app';

const USER_AGENT_HEADER = 'RadioDock/1.0';
const DEFAULT_LIMIT = 30;
const TIMEOUT_MS = 12000;

/**
 * Fetch JSON with a linked timeout. Exported for the Discover loader, which
 * uses the same transport rules against a same-origin file.
 */
export async function fetchJson(url, { signal, timeoutMs = TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function buildSearchUrl({ query, filter }) {
  const params = new URLSearchParams({
    limit: String(DEFAULT_LIMIT),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  // Country was removed as a product decision; anything other than 'tag' is a
  // name search.
  if (filter === 'tag') params.set('tag', query);
  else params.set('name', query);
  return `${STATIONS_BASE}/json/stations/search?${params.toString()}`;
}

/** Normalise a station response into our internal shape (identical to radio-browser.js). */
function normaliseStation(rb) {
  return {
    id: rb.stationuuid,
    name: rb.name?.trim() ?? '',
    url: rb.url_resolved || rb.url || '',
    countrycode: rb.countrycode ?? '',
    favicon: rb.favicon || '',
    homepage: rb.homepage || '',
    tags: typeof rb.tags === 'string' ? rb.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    bitrate: rb.bitrate ?? 0,
    codec: rb.codec ?? '',
    votes: rb.votes ?? 0,
    clickcount: rb.clickcount ?? 0,
  };
}

/**
 * Search the Stations API.
 * @param {{query: string, filter: 'name'|'tag'}} opts
 * @param {{signal?: AbortSignal}} [transport]
 * @returns {Promise<Array>} normalised stations; throws on error so the caller can fall back.
 */
export async function searchStations({ query, filter = 'name' }, { signal } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];

  const url = buildSearchUrl({ query: q, filter });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response shape');
    const seen = new Set();
    const out = [];
    for (const rb of data) {
      const station = normaliseStation(rb);
      if (!station.id || !station.url) continue;
      const key = `${station.name.toLowerCase()}|${station.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(station);
    }
    return out;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetch a single station by UUID. Returns the normalised shape, or null when the
 * UUID is unknown (404) or the result is empty. Throws on other errors. A
 * tombstoned station 404s here — the fallback layer retries against Radio
 * Browser so a station the user already holds still fills its info panel.
 * @param {string} uuid
 * @param {{signal?: AbortSignal}} [transport]
 */
export async function getStationByUuid(uuid, { signal } = {}) {
  const id = String(uuid ?? '').trim();
  if (!id) return null;

  const url = `${STATIONS_BASE}/json/stations/byuuid/${encodeURIComponent(id)}`;
  // Own timeout linked to the caller's signal, so a VPS that accepts the socket
  // but never responds aborts and lets the source layer fall back to Radio
  // Browser instead of hanging the info panel forever.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_HEADER },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return normaliseStation(data[0]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Our consolidated curated station info (tags, city, country, socials, contact,
 * codec, bitrate). Returns null on 404 (uuid not in our DB) or any error, so the
 * caller can fall back to the Radio Browser by-uuid path.
 * @param {string} uuid
 * @param {{signal?: AbortSignal}} [transport]
 * @returns {Promise<object|null>}
 */
export async function getStationInfo(uuid, { signal } = {}) {
  const id = String(uuid ?? '').trim();
  if (!id) return null;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${STATIONS_BASE}/api/stations/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Extend the common station shape with browse-specific fields. */
function normaliseBrowseStation(rb) {
  const base = normaliseStation({ ...rb, stationuuid: rb.stationuuid ?? rb.id });
  const tags = Array.isArray(rb.tags)
    ? rb.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : base.tags;
  return {
    ...base,
    tags,
    country: rb.country ?? '',
    city: rb.city ?? '',
    genre: rb.genre ?? '',
    genreLabel: rb.genreLabel ?? '',
    info: rb.info ?? '',
    plays: rb.plays ?? 0,
    listenMinutes: rb.listenMinutes ?? 0,
    avgMinutes: rb.avgMinutes ?? 0,
    score: rb.score ?? 0,
    reach: rb.reach ?? 0,
    depth: rb.depth ?? 0,
    repeat: rb.repeat ?? 0,
    quality: rb.quality ?? 0,
    confidence: rb.confidence ?? 0,
    rank: rb.rank ?? null,
  };
}

function browseQuery(params = {}, keys = ['mode', 'q', 'letter', 'country', 'genre', 'limit', 'offset']) {
  const search = new URLSearchParams({ hidebroken: 'true' });
  for (const key of keys) {
    const value = params[key];
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  
  return search;
}

/**
 * Browse the station database. Returns one page plus letter counts for A-Z.
 * @param {object} params
 * @param {{signal?: AbortSignal}} [transport]
 */
export async function browseStations(params = {}, { signal } = {}) {
  const url = `${STATIONS_BASE}/json/stations/browse?${browseQuery(params).toString()}`;
  const data = await fetchJson(url, { signal });
  const rows = Array.isArray(data?.stations) ? data.stations : [];
  const seen = new Set();
  const stations = [];
  for (const row of rows) {
    const station = normaliseBrowseStation(row);
    if (!station.id || seen.has(station.id)) continue;
    seen.add(station.id);
    stations.push(station);
  }
  return {
    stations,
    total: data?.total ?? 0,
    offset: data?.offset ?? 0,
    limit: data?.limit ?? stations.length,
    nextOffset: data?.nextOffset ?? null,
    letterCounts: data?.letterCounts ?? null,
    statsUpdatedAt: data?.statsUpdatedAt ?? null,
    popularMinPlays: data?.popularMinPlays ?? 5,
    algorithm: data?.algorithm ?? null,
    algorithmVersion: data?.algorithmVersion ?? null,
    computedAt: data?.computedAt ?? null,
    popularMinListeners: data?.popularMinListeners ?? null,
  };
}

/** Fetch filter counts and labels for the Stations surface. */
export async function getBrowseMeta({ signal } = {}) {
  const data = await fetchJson(`${STATIONS_BASE}/json/stations/browse/meta`, { signal });
  return {
    ...data,
    countries: Array.isArray(data?.countries) ? data.countries : [],
    genres: Array.isArray(data?.genres) ? data.genres : [],
  };
}

/** Fetch one random station for the current filters. */
export async function getRandomStation(filters = {}, { signal } = {}) {
  const keys = ['mode', 'letter', 'country', 'genre'];
  const url = `${STATIONS_BASE}/json/stations/browse/random?${browseQuery(filters, keys).toString()}`;
  const data = await fetchJson(url, { signal });
  return data?.station ? normaliseBrowseStation(data.station) : null;
}
