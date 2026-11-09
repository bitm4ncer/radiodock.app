// Per-station metadata memo. A lock-screen next/previous switch happens while
// the PWA is hidden, and iOS may not wait for a background metadata fetch (or
// may ignore a late MediaMetadata update). Prefetching the neighbouring
// stations while the app is foregrounded and reading this cache synchronously
// on `stationchange` gives the lock screen the show title immediately.
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 200;
const cache = new Map();

function idOf(stationId) {
  return String(stationId ?? '').trim();
}

export function rememberMetadata(stationId, data) {
  const id = idOf(stationId);
  if (!id || !data) return;
  const entry = {
    nowPlaying: String(data.nowPlaying ?? ''),
    artist: data.artist == null ? null : String(data.artist),
    title: data.title == null ? null : String(data.title),
    source: data.source ?? null,
    at: Date.now(),
  };
  // Refresh insertion order so the eviction below removes the oldest entry.
  cache.delete(id);
  cache.set(id, entry);
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

export function recallMetadata(stationId, { maxAgeMs = DEFAULT_TTL_MS } = {}) {
  const id = idOf(stationId);
  const entry = cache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.at > maxAgeMs) {
    cache.delete(id);
    return null;
  }
  return entry;
}

export function forgetMetadata(stationId) {
  cache.delete(idOf(stationId));
}
