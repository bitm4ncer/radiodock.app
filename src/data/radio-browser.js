// Radio Browser API client.
// https://api.radio-browser.info — community-run global radio directory.
// Multiple mirror servers exist; we cycle through them on error.

const SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
];

const USER_AGENT_HEADER = 'RadioDock/1.0';
const DEFAULT_LIMIT = 30;
const TIMEOUT_MS = 12000;

let serverIndex = Math.floor(Math.random() * SERVERS.length);

function pickServer() {
  return SERVERS[serverIndex];
}

function rotateServer() {
  serverIndex = (serverIndex + 1) % SERVERS.length;
}

function buildSearchUrl(server, { query, filter }) {
  // We use the unified `/json/stations/search` endpoint.
  const params = new URLSearchParams({
    limit: String(DEFAULT_LIMIT),
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  if (filter === 'tag') params.set('tag', query);
  else if (filter === 'country') params.set('country', query);
  else params.set('name', query);
  return `${server}/json/stations/search?${params.toString()}`;
}

/** Normalise a Radio Browser station response into our internal shape. */
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
 * Search the Radio Browser API.
 * @param {{query: string, filter: 'name'|'tag'|'country'}} opts
 * @param {{signal?: AbortSignal}} [transport]
 * @returns {Promise<Array<{id, name, url, countrycode, favicon, homepage, tags, bitrate, codec}>>}
 */
export async function searchStations({ query, filter = 'name' }, { signal } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return [];

  let lastError = null;
  for (let attempt = 0; attempt < SERVERS.length; attempt++) {
    const server = pickServer();
    const url = buildSearchUrl(server, { query: q, filter });
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
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Unexpected response shape');
      // De-dupe by name+url (the API sometimes returns identical entries from multiple sources)
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
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) throw err; // caller cancelled
      lastError = err;
      rotateServer();
    }
  }
  throw new Error(`Radio Browser search failed: ${lastError?.message ?? 'unknown error'}`);
}
