// Logo source resolution for stations.
//
// Many Radio Browser entries ship without a usable `favicon`, and some that
// have one are unrecognisable thumbnails. We layer fallbacks:
//   1. station.favicon (whatever Radio Browser / community JSON shipped)
//   2. DuckDuckGo icon service for the homepage domain
//   3. Initials chip
//
// Auto chain: try (1), on error try (2), on error or DDG-placeholder use (3).
// The user can also manually pin a source per station via the cycle button —
// that pin is stored as a pref keyed `logo:<stationId>` and overrides auto.

import { getPref, setPref } from './storage.js';

export const LOGO_SOURCES = Object.freeze({
  ORIGINAL: 'original',
  DDG: 'ddg',
  INITIALS: 'initials',
});

// DuckDuckGo returns a 48×48 PNG placeholder (exactly 1478 bytes) when it has
// no icon for a domain. We can't read content-length cross-origin, but the
// natural size is reliably 48×48 — real station logos via DDG come back as
// 30–32 px. This lets us detect a placeholder and fall through to initials.
const DDG_PLACEHOLDER_SIZE = 48;

const OVERRIDE_KEY_PREFIX = 'logo:';

export function extractDomain(homepage) {
  if (!homepage) return '';
  try {
    const u = new URL(homepage);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function getDdgUrl(domain) {
  if (!domain) return '';
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

// Returns the ordered list of *available* sources for a station, used both
// for auto resolution and to drive the cycle button's next-state logic.
export function getLogoCandidates(station) {
  const out = [];
  if (station?.favicon) {
    out.push({ source: LOGO_SOURCES.ORIGINAL, url: station.favicon });
  }
  const domain = extractDomain(station?.homepage);
  if (domain) {
    out.push({ source: LOGO_SOURCES.DDG, url: getDdgUrl(domain) });
  }
  out.push({ source: LOGO_SOURCES.INITIALS, url: '' });
  return out;
}

export function isDdgPlaceholder(imgEl) {
  return imgEl?.naturalWidth === DDG_PLACEHOLDER_SIZE
    && imgEl?.naturalHeight === DDG_PLACEHOLDER_SIZE;
}

export function getLogoOverride(stationId) {
  if (!stationId) return Promise.resolve(null);
  return getPref(OVERRIDE_KEY_PREFIX + stationId, null);
}

export function setLogoOverride(stationId, source) {
  if (!stationId) return Promise.resolve();
  return setPref(OVERRIDE_KEY_PREFIX + stationId, source);
}
