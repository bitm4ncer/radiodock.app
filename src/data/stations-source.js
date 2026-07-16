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

// Hidden beta toggle (About): force a backend for debugging. 'radiodock' pins
// the primary (no fallback, so its raw behaviour is visible); 'radio-browser'
// pins the fallback; null is the normal default+fallback behaviour.
let backendOverride = null;
export function setBackendOverride(mode) {
  backendOverride = (mode === 'radiodock' || mode === 'radio-browser') ? mode : null;
}
export function getBackendOverride() {
  return backendOverride;
}

export function createStationsSource({
  primary = radiodock,
  fallback = radiobrowser,
  retryAfterMs = DEFAULT_RETRY_AFTER_MS,
  now = () => Date.now(),
  getOverride = () => null,
} = {}) {
  let primaryDownUntil = 0;

  const primaryCooling = () => now() < primaryDownUntil;
  const tripCooldown = () => { primaryDownUntil = now() + retryAfterMs; };

  async function searchStations(opts, transport = {}) {
    const override = getOverride();
    const report = (b) => { try { transport.onBackend?.(b); } catch { /* analytics must never break search */ } };

    if (override === 'radio-browser' || (override !== 'radiodock' && primaryCooling())) {
      const r = await fallback.searchStations(opts, transport);
      report('radio-browser');
      return r;
    }
    try {
      const r = await primary.searchStations(opts, transport);
      report('radiodock');
      return r;
    } catch (err) {
      if (transport.signal?.aborted) throw err; // user cancelled — don't fall back
      if (override === 'radiodock') throw err;  // forced primary — surface the error
      tripCooldown();
      console.warn('Stations API search failed, falling back to Radio Browser:', err?.message);
      const r = await fallback.searchStations(opts, transport);
      report('radio-browser');
      return r;
    }
  }

  async function getStationByUuid(uuid, transport = {}) {
    const override = getOverride();

    if (override === 'radio-browser' || (override !== 'radiodock' && primaryCooling())) {
      return fallback.getStationByUuid(uuid, transport);
    }
    try {
      const station = await primary.getStationByUuid(uuid, transport);
      if (station) return station;
      // null = 404/unknown on the primary. Under a forced-primary override,
      // report it honestly; otherwise fall through to the fallback WITHOUT
      // tripping the cooldown — the primary is up, this UUID is just not in our DB.
      if (override === 'radiodock') return null;
      return fallback.getStationByUuid(uuid, transport);
    } catch (err) {
      if (transport.signal?.aborted) throw err;
      if (override === 'radiodock') throw err;
      tripCooldown();
      console.warn('Stations API byuuid failed, falling back to Radio Browser:', err?.message);
      return fallback.getStationByUuid(uuid, transport);
    }
  }

  return { searchStations, getStationByUuid };
}

const defaultSource = createStationsSource({ getOverride: () => backendOverride });

export const searchStations = defaultSource.searchStations;
export const getStationByUuid = defaultSource.getStationByUuid;
