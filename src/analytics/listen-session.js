import { STATIONS_BASE } from '../data/stations-api.js';

const LISTENER_KEY = 'rd_listener_id';
const OPT_OUT_KEYS = ['umami.disabled', 'rd_analytics_opt_out'];

export function isOptedOut(storage = globalThis.localStorage, nav = globalThis.navigator) {
  if (storage) {
    if (OPT_OUT_KEYS.some((key) => storage.getItem(key) === '1')) return true;
  }
  const dnt = nav?.doNotTrack;
  return dnt === '1' || dnt === 'yes';
}

function readListenerId(storage, randomUUID) {
  let id = storage?.getItem(LISTENER_KEY);
  if (!id) {
    id = randomUUID();
    storage?.setItem(LISTENER_KEY, id);
  }
  return id;
}

/**
 * Anonymous listening sessions for the Popular v2 feed.
 *
 * The PWA already has a per-minute Umami ping, but Umami's propertyValues API
 * only exposes the top 100 values and cannot count distinct listeners. This
 * module sends the same audible time to our own ingest endpoint with a
 * per-install listener id, so the server can cap one listener and count reach.
 */
export function attachListenSession(player, {
  endpoint = `${STATIONS_BASE}/api/listen`,
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
  now = () => Date.now(),
  randomUUID = () => globalThis.crypto?.randomUUID?.(),
  isDev = import.meta.env?.DEV === true,
  beacon = globalThis.navigator?.sendBeacon?.bind(globalThis.navigator),
  windowImpl = globalThis.window,
  documentImpl = globalThis.document,
} = {}) {
  if (!player || !windowImpl || isDev || isOptedOut(storage)) {
    return { stop() {} };
  }

  let session = null;
  let timer = null;
  let audible = false;
  let stopped = false;

  function post(url, body, { useBeacon = false } = {}) {
    const json = JSON.stringify(body);
    try {
      if (useBeacon && typeof beacon === 'function') {
        beacon(url, new Blob([json], { type: 'text/plain' }));
        return;
      }
      fetchImpl?.(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
      })?.catch?.(() => {});
    } catch {
      // Analytics is best-effort and must never break playback.
    }
  }

  function clearTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function sendUpdate(current, { ended = false, endReason = null, useBeacon = false } = {}) {
    if (!current) return;
    post(`${endpoint}/session/${current.id}`, {
      listenerId: current.listenerId,
      foregroundMinutes: current.foregroundMinutes,
      backgroundMinutes: current.backgroundMinutes,
      plays: current.plays,
      errors: current.errors,
      ended,
      ...(endReason ? { endReason } : {}),
    }, { useBeacon });
  }

  function end(reason, { useBeacon = false } = {}) {
    if (!session) return;
    const current = session;
    session = null;
    audible = false;
    clearTimer();
    current.ended = true;
    sendUpdate(current, { ended: true, endReason: reason, useBeacon });
  }

  function start(station, source) {
    if (!station?.id) return;
    end('stationchange');
    if (stopped) return;
    const listenerId = readListenerId(storage, randomUUID);
    const id = randomUUID();
    session = {
      id,
      listenerId,
      stationId: station.id,
      foregroundMinutes: 0,
      backgroundMinutes: 0,
      plays: 1,
      errors: 0,
      ended: false,
    };
    post(`${endpoint}/session`, {
      listenerId,
      sessionId: id,
      stationuuid: station.id,
      source: String(source ?? 'unknown').slice(0, 40),
      startedAt: new Date(now()).toISOString(),
    });
  }

  function onPlay(event) {
    const detail = event?.detail ?? {};
    if (detail.station?.id) start(detail.station, detail.source);
  }

  function tick() {
    if (!session || session.ended || !audible || !player.isPlaying?.()) return;
    const background = documentImpl?.visibilityState === 'hidden';
    if (background) session.backgroundMinutes += 1;
    else session.foregroundMinutes += 1;
    sendUpdate(session);
  }

  function ensureTimer() {
    if (!timer) timer = setInterval(tick, 60_000);
  }

  function onPlaying() {
    audible = true;
    ensureTimer();
  }

  function onLoading() {
    audible = false;
  }

  function onPaused() {
    end('pause');
  }

  function onStopped() {
    end('stop');
  }

  function onError() {
    if (session) session.errors += 1;
    end('error');
  }

  function onStationChange(event) {
    const next = event?.detail?.station;
    if (session && next?.id && session.stationId !== next.id) end('stationchange');
  }

  function onPageHide() {
    end('pagehide', { useBeacon: true });
  }

  function onOptOut(event) {
    if (event?.detail?.off) end('opt-out');
  }

  const playerEvents = {
    playing: onPlaying,
    loading: onLoading,
    paused: onPaused,
    stopped: onStopped,
    error: onError,
    stationchange: onStationChange,
  };
  for (const [name, fn] of Object.entries(playerEvents)) player.on?.(name, fn);
  windowImpl.addEventListener('rd:station-play', onPlay);
  windowImpl.addEventListener('pagehide', onPageHide);
  windowImpl.addEventListener('rd:analytics-opt-out', onOptOut);

  return {
    stop() {
      stopped = true;
      end('stop');
      clearTimer();
      windowImpl.removeEventListener?.('rd:station-play', onPlay);
      windowImpl.removeEventListener?.('pagehide', onPageHide);
      windowImpl.removeEventListener?.('rd:analytics-opt-out', onOptOut);
      for (const [name, fn] of Object.entries(playerEvents)) player.off?.(name, fn);
    },
  };
}
