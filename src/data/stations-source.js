// The PWA's station source: RadioDock Stations API as the default, with the
// Radio Browser API as an automatic fallback. Both clients expose the identical
// two-function surface (searchStations, getStationByUuid), so this composes them
// without an adapter and re-exports the same surface — callers are unchanged.
//
// Fallback policy (mirrors the metadata client, src/data/metadata.js):
//  - primary error/timeout  -> fall back AND trip a 60 s cooldown, so the next
//    calls skip the primary (and its timeout) until it expires.
//  - primary 404 (null)     -> fall back but do NOT trip the cooldown: the
//    primary is healthy, this UUID is just absent from our curated DB (e.g. a
//    tombstoned duplicate the user still holds). Radio Browser may still serve it.
//  - user-cancelled (aborted signal) -> rethrow, never fall back.
//
// The Radio Browser fallback stays wired in permanently — redundancy is the
// point. Never remove it.

import * as radiodock from './stations-api.js';
import * as radiobrowser from './radio-browser.js';

const DEFAULT_RETRY_AFTER_MS = 60000;

export function createStationsSource({
  primary = radiodock,
  fallback = radiobrowser,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS,
  now = () => Date.now(),
} = {}) {
  let primaryDownUntil = 0;

  const primaryCooling = () => now() < primaryDownUntil;
  const tripCooldown = () => { primaryDownUntil = now() + retryAfterMs; };

  async function searchStations(opts, transport = {}) {
    if (!primaryCooling()) {
      try {
        return await primary.searchStations(opts, transport);
      } catch (err) {
        if (transport.signal?.aborted) throw err; // user cancelled — don't fall back
        tripCooldown();
        console.warn('Stations API search failed, falling back to Radio Browser:', err?.message);
      }
    }
    return fallback.searchStations(opts, transport);
  }

  async function getStationByUuid(uuid, transport = {}) {
    if (!primaryCooling()) {
      try {
        const station = await primary.getStationByUuid(uuid, transport);
        if (station) return station;
        // null = 404/unknown on the primary. Fall through to the fallback WITHOUT
        // tripping the cooldown — the primary is up, this UUID is just not in our DB.
      } catch (err) {
        if (transport.signal?.aborted) throw err;
        tripCooldown();
        console.warn('Stations API byuuid failed, falling back to Radio Browser:', err?.message);
      }
    }
    return fallback.getStationByUuid(uuid, transport);
  }

  return { searchStations, getStationByUuid };
}

const defaultSource = createStationsSource();

export const searchStations = defaultSource.searchStations;
export const getStationByUuid = defaultSource.getStationByUuid;
