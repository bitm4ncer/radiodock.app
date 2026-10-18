import { fetchJson } from './stations-api.js';

let cached = null;

/**
 * Load the generated Discover payload. Network-first, in-memory cached, and
 * null on any failure so the Stations surface can show an honest empty state.
 * @param {{signal?: AbortSignal, force?: boolean}} [opts]
 * @returns {Promise<object|null>}
 */
export async function loadDiscover({ signal, force = false } = {}) {
  if (cached && !force) return cached;
  try {
    const data = await fetchJson('/discover.json', { signal });
    if (!data || typeof data !== 'object') return null;
    cached = data;
    return cached;
  } catch {
    return null;
  }
}

export function clearDiscoverCache() {
  cached = null;
}
