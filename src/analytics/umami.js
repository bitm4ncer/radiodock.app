// Custom Umami events on top of the auto-pageview tracker loaded in
// index.html. Gated to production builds so `npm run dev` doesn't pollute
// the live dashboard. All calls are best-effort: a missing or
// late-loading umami global no-ops rather than throwing.

const ENABLED = import.meta.env.PROD;

function devLog(name, data) {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const log = (window.__analyticsDebug ??= []);
    log.push({ name, data });
    if (log.length > 200) log.shift();
  }
}

// Attach anonymous session-scoped data (shown in Umami's Sessions view).
// Last write wins, so callers can send cumulative values repeatedly.
export function identifySession(data) {
  if (!ENABLED) {
    devLog('$identify', data);
    return;
  }
  const u = typeof window !== 'undefined' ? window.umami : null;
  if (!u || typeof u.identify !== 'function') return;
  try {
    u.identify(data);
  } catch {
    // Analytics failures must never break the app.
  }
}

export function track(name, data) {
  if (!ENABLED) {
    devLog(name, data);
    return;
  }
  const u = typeof window !== 'undefined' ? window.umami : null;
  if (!u || typeof u.track !== 'function') return;
  try {
    if (data !== undefined) u.track(name, data);
    else u.track(name);
  } catch {
    // Analytics failures must never break the app.
  }
}

// Every user-initiated station start goes through here, so the payload stays
// identical across the many entry points: search, the station list, the mobile
// carousel, the Electron tray, a note, and the player card starting a station
// that was only restored into the UI from prefs. Automatic replays must NOT call
// this: the recovery module retrying a stalled stream is not a play, and counting
// it would inflate the number on exactly the flakiest streams.
export function trackStationPlay(station, source) {
  track('station-play', {
    station: station?.name ?? '',
    uuid: station?.id ?? '',
    country: station?.countrycode ?? '',
    source,
  });
}
