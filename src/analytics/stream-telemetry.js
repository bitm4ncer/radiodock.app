import { isOptedOut } from './listen-session.js';
import { STATIONS_BASE } from '../data/stations-api.js';

// Fire-and-forget playback outcome. This is intentionally separate from the
// Umami event: a failure here must never affect the player or analytics.
export function reportStreamOutcome(payload, {
  endpoint = `${STATIONS_BASE}/api/stream-events`,
  isDev = import.meta.env?.DEV === true,
  storage = globalThis.localStorage,
  nav = globalThis.navigator,
  doc = globalThis.document,
  beacon = globalThis.navigator?.sendBeacon
    ? globalThis.navigator.sendBeacon.bind(globalThis.navigator)
    : null,
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    if (isDev || isOptedOut(storage, nav, doc)) return false;
    const json = JSON.stringify(payload);

    if (typeof beacon === 'function') {
      try {
        if (beacon(endpoint, new Blob([json], { type: 'text/plain' }))) return true;
      } catch {
        return false;
      }
    }

    if (typeof fetchImpl !== 'function') return false;
    try {
      const result = fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: json,
        keepalive: true,
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}
