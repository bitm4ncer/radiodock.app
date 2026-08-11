// Cross-provider ids for a detected track (Spotify / Apple Music / Tidal /
// YouTube), resolved by our own server and cached per device.
//
// The note itself is never touched: `data/notes.js` keeps track snapshots
// immutable after capture. These ids are derived data, so they live in their
// own pref-backed cache — which is also why notes captured before this feature
// existed gain Apple/Tidal previews retroactively, the moment their card is
// expanded.
//
// Bounded time, honest result: a slow or dead server resolves to the ids the
// note already carries. No spinner outlives the timeout.

import { STATIONS_BASE } from './stations-api.js';
import { getPref, setPref } from './storage.js';

const PREF = 'trackLinks';
const TIMEOUT_MS = 5000;
const MAX_ENTRIES = 300;

const blank = () => ({ spotify: '', apple: { id: '', country: '' }, tidal: '', youtube: '' });

// What the note already knows, in the shape the embed registry expects.
export function idsFromTrack(track = {}) {
  return {
    spotify: track.spotify || '',
    apple: { id: track.apple || '', country: track.appleCountry || '' },
    tidal: track.tidal || '',
    youtube: track.youtube || '',
  };
}

export function cacheKey(track = {}) {
  if (track.isrc) return `isrc:${String(track.isrc).toUpperCase()}`;
  if (track.spotify) return `spotify:${track.spotify}`;
  if (track.deezer) return `deezer:${track.deezer}`;
  return '';
}

// Merge, never overwrite: a resolved id fills a gap, it does not replace what
// the recogniser gave us first-hand.
export function mergeIds(base, extra) {
  const b = { ...blank(), ...base, apple: { ...blank().apple, ...(base?.apple || {}) } };
  if (!extra) return b;
  return {
    spotify: b.spotify || extra.spotify || '',
    apple: {
      id: b.apple.id || extra.apple?.id || '',
      country: b.apple.country || extra.apple?.country || '',
    },
    tidal: b.tidal || extra.tidal || '',
    youtube: b.youtube || extra.youtube || '',
  };
}

async function readCache() {
  const map = await getPref(PREF, null);
  return map && typeof map === 'object' ? map : {};
}

async function writeCache(key, value) {
  const map = await readCache();
  map[key] = { ...value, at: Date.now() };
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (map[a].at ?? 0) - (map[b].at ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete map[k]);
  }
  await setPref(PREF, map);
}

// Returns the fullest id set we can get for this track. Resolution is
// best-effort: on any failure the caller still receives the note's own ids.
export async function resolveTrackIds(track = {}, { fetchImpl = fetch } = {}) {
  const own = idsFromTrack(track);
  const key = cacheKey(track);
  if (!key) return own;

  const cache = await readCache();
  const hit = cache[key];
  if (hit) return mergeIds(own, hit.links || null);

  const params = new URLSearchParams();
  if (track.isrc) params.set('isrc', track.isrc);
  if (track.spotify) params.set('spotify', track.spotify);
  if (track.deezer) params.set('deezer', track.deezer);
  // Apple is resolved by an exact artist+title match server-side — without the
  // pair the server does not guess, so send it when we have it.
  if (track.artist && track.title) {
    params.set('artist', track.artist);
    params.set('title', track.title);
  }

  let data;
  try {
    const res = await fetchImpl(`${STATIONS_BASE}/api/track-links?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    data = await res.json();
  } catch {
    return own; // network/timeout — the note's own ids still play.
  }

  if (!data?.ok) {
    // Remember only a definitive "this track has no counterparts". An outage
    // must not cost the track its previews for the rest of the install.
    if (data?.reason === 'no-match') await writeCache(key, { links: null });
    return own;
  }
  await writeCache(key, { links: data.links });
  return mergeIds(own, data.links);
}
