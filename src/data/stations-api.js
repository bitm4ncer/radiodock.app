// RadioDock Stations API client.
// https://stations.radiodock.app — our own curated station database, a
// contract-compatible mirror of the Radio Browser `/json/stations/*` shape.
// This module mirrors radio-browser.js's two-function surface exactly so the
// source can be swapped by transport, not by adapter. Single origin, no mirror
// rotation — availability is covered by the Radio Browser fallback one layer up
// (see stations-source.js).

export const STATIONS_BASE = 'https://stations.radiodock.app';

const USER_AGENT_HEADER = 'RadioDock/1.0';
const DEFAULT_LIMIT = 30;
const TIMEOUT_MS = 12000;

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
