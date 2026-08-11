// Drives metadata polling on the active station. Subscribes to player events
// to know when the station changes, and emits `metadata` events through the
// same player EventTarget so the UI doesn't care where the data came from.
//
// Polling pauses while the tab is hidden (saves battery on phone-in-pocket).

import { fetchNowPlaying } from '../data/metadata.js';

const MIN_INTERVAL_MS = 10000;   // never poll faster than every 10 s
const DEFAULT_INTERVAL_MS = 15000;
// A single long TTL must not blind the rest of the session: NTS mixtapes ship
// cacheTtl 3600, which used to buy exactly one poll per hour.
const MAX_INTERVAL_MS = 300000;
const LOADING_GRACE_MS = 3000;   // show "Loading metadata…" if first response is slow

export function attachMetadataPoller(player) {
  let currentStation = null;
  let inFlightController = null;
  let timer = null;
  let intervalMs = DEFAULT_INTERVAL_MS;
  let lastPollAt = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function stop() {
    clearTimer();
    inFlightController?.abort();
    inFlightController = null;
    currentStation = null;
  }

  async function poll({ isFirst = false } = {}) {
    if (!currentStation) return;
    if (document.visibilityState === 'hidden') {
      // Sleep and recheck — visibilitychange listener will resume immediately on focus.
      scheduleNext(intervalMs);
      return;
    }
    inFlightController?.abort();
    const ctl = new AbortController();
    inFlightController = ctl;
    lastPollAt = Date.now();
    // Surface a placeholder if the first request after a station change
    // takes long enough that the user would otherwise see an empty line.
    let loadingTimer = null;
    if (isFirst) {
      loadingTimer = setTimeout(() => {
        if (!ctl.signal.aborted) {
          player.events?.dispatchEvent(
            new CustomEvent('metadata', {
              detail: { artist: null, title: null, nowPlaying: 'Loading metadata…', source: 'placeholder' },
            }),
          );
        }
      }, LOADING_GRACE_MS);
    }
    try {
      const result = await fetchNowPlaying(
        {
          streamUrl: currentStation.url,
          stationId: currentStation.id,
          homepage: currentStation.homepage,
          country: currentStation.countrycode,
        },
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      // `empty` is a definitive answer and dispatches too, so an ended show
      // clears instead of hanging on screen. A null result is an outage and
      // leaves the last known line alone.
      const hasText = !!(result?.nowPlaying || result?.artist || result?.title);
      if (result && !result.shouldUseLocal && (hasText || result.empty)) {
        player.events?.dispatchEvent(
          new CustomEvent('metadata', {
            detail: {
              artist: result.artist,
              title: result.title,
              nowPlaying: result.nowPlaying,
              source: result.source ?? 'proxy',
            },
          }),
        );
        // Honour the cache TTL the proxy returns, within our own bounds.
        if (typeof result.cacheTtl === 'number') {
          intervalMs = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, result.cacheTtl * 1000));
        }
      }
    } catch (err) {
      if (!ctl.signal.aborted) console.warn('metadata poll failed:', err.message);
    } finally {
      if (loadingTimer) clearTimeout(loadingTimer);
      if (inFlightController === ctl) inFlightController = null;
    }
    scheduleNext(intervalMs);
  }

  function scheduleNext(ms) {
    clearTimer();
    timer = setTimeout(poll, ms);
  }

  function start(station) {
    stop();
    if (!station?.url) return;
    // Poll HLS streams too — the proxy now ships schedule-aware strategies
    // (e.g. HKCR) that return useful metadata for HLS broadcasts. For HLS
    // streams without a schedule strategy the proxy returns `hls-client` /
    // shouldUseLocal so the dispatch below is suppressed. hls.js continues
    // to read any in-band ID3 tags from audio.js independently of this poller.
    currentStation = station;
    intervalMs = DEFAULT_INTERVAL_MS;
    // Kick the first request immediately; tag as first so the loading
    // placeholder can fire if the response is slow.
    poll({ isFirst: true });
  }

  player.on('stationchange', (evt) => start(evt.detail.station));
  player.on('stopped', stop);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !currentStation) return;
    // The sleeping branch in poll() always leaves a timer pending, so waking up
    // is never a case of "nothing scheduled" — the wake-up has to pre-empt what
    // is scheduled. Without that, a listener coming back to the tab keeps
    // seeing the show that was on air when they left, for up to a full
    // interval. The MIN_INTERVAL_MS floor keeps rapid tab flapping off the
    // proxy.
    const since = Date.now() - lastPollAt;
    clearTimer();
    if (since >= MIN_INTERVAL_MS) poll();
    else scheduleNext(MIN_INTERVAL_MS - since);
  });

  return { stop };
}
