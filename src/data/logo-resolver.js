// Single-origin logo resolution.
//
// Every station logo is served from our own CDN, keyed by station UUID:
//   https://stations.radiodock.app/logos/{uuid}?size={64|512}
// The server looks the favicon up by UUID in its own DB, re-encodes it to fixed
// sizes, and serves it with immutable cache headers. It never accepts a
// client-supplied URL, so there is no SSRF surface.
//
// The chain is just: server logo → initials. All direct third-party favicon
// loads and the DuckDuckGo fallback are gone — opening the app no longer leaks
// the user's IP to dozens of station hosts before they press play (GDPR). If the
// VPS is down, logos degrade to initials while playback and search are untouched.

import { STATIONS_BASE } from './stations-api.js';
import { getAllPrefs, removePref } from './storage.js';

const LOGO_SIZE_PX = Object.freeze({ sm: 64, lg: 512 });

const ORPHANED_PREF_PREFIX = 'logo:';

/**
 * The CDN logo URL for a station, or '' when there is no id (caller shows initials).
 * @param {{id?: string, stationuuid?: string}} station
 * @param {number} [size=64] pixel size the CDN re-encodes to (64 list chip, 512 artwork)
 */
export function getLogoUrl(station, size = 64) {
  const id = station?.id ?? station?.stationuuid ?? '';
  if (!id) return '';
  return `${STATIONS_BASE}/logos/${encodeURIComponent(id)}?size=${size}`;
}

export function logoSizePx(size) {
  return LOGO_SIZE_PX[size] ?? LOGO_SIZE_PX.sm;
}

/**
 * The manual logo-pin feature (a `logo:<stationId>` pref per station) is gone —
 * a wrong logo is now fixed once in the dashboard for everyone. Those prefs are
 * dead weight; sweep them on load. Returns the count removed.
 */
export async function cleanupOrphanedLogoPrefs() {
  try {
    const prefs = await getAllPrefs();
    const orphaned = Object.keys(prefs ?? {}).filter((k) => k.startsWith(ORPHANED_PREF_PREFIX));
    await Promise.all(orphaned.map((k) => removePref(k)));
    return orphaned.length;
  } catch {
    return 0;
  }
}
