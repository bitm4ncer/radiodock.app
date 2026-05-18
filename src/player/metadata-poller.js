// Drives metadata polling on the active station. Subscribes to player events
// to know when the station changes, and emits `metadata` events through the
// same player EventTarget so the UI doesn't care where the data came from.
//
// Polling pauses while the tab is hidden (saves battery on phone-in-pocket).

import { fetchNowPlaying } from '../data/metadata.js';

const MIN_INTERVAL_MS = 10000;   // never poll faster than every 10 s
const DEFAULT_INTERVAL_MS = 15000;
const LOADING_GRACE_MS = 3000;   // show "Loading metadata…" if first response is slow

export function attachMetadataPoller(player) {
  let currentStation = null;
  let inFlightController = null;
  let timer = null;
  let intervalMs = DEFAULT_INTERVAL_MS;

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
      if (result && !result.shouldUseLocal && (result.nowPlaying || result.artist || result.title)) {
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
        // Honour the cache TTL the proxy returns, but clamp to MIN_INTERVAL_MS.
        if (typeof result.cacheTtl === 'number') {
          intervalMs = Math.max(MIN_INTERVAL_MS, result.cacheTtl * 1000);
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
    if (document.visibilityState === 'visible' && currentStation && !timer) {
      // Resume immediately when the user comes back.
      poll();
    }
  });

  return { stop };
}
