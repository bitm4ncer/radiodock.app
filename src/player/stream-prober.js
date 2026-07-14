// Stream prober: checks station URLs once per minute to detect offline streams.
// Sequential probing (one at a time, 5s timeout each) so we don't flood the
// network stack with parallel TCP connections to stream servers.
//
// Uses temporary <audio> elements for probing — unlike fetch(), <audio> can
// load cross-origin streams without CORS headers. We listen for the
// 'loadedmetadata' event (server responded with audio data) vs 'error' with
// MEDIA_ERR_NETWORK code (DNS failure, connection refused, etc.).
//
// Pauses when the tab is hidden (visibilitychange) — no point probing streams
// nobody is looking at. Resumes on visibility restore + immediately re-probes.

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

export function attachStreamProber({ getStations, onStatusChange }) {
  let timer = null;
  let statuses = {};          // { stationId: 'online' | 'offline' }
  let probing = false;
  let aborted = false;

  /**
   * Probe a single station URL by creating a temporary <audio> element.
   * Audio elements bypass CORS — they load cross-origin streams natively.
   *
   * @returns {'online' | 'offline'}
   *   'online'  — server responded with audio data (loadedmetadata) or a
   *               non-network error (unsupported format, decode error).
   *   'offline' — timeout (5s), MEDIA_ERR_NETWORK, or we aborted due to
   *               list change.
   */
  function probeOne(station) {
    return new Promise((resolve) => {
      let settled = false;
      const audio = new Audio();
      audio.preload = 'metadata';
      audio.volume = 0;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        audio.removeAttribute('src');
        audio.load();
        audio.remove();
        resolve(result);
      };

      const timeout = setTimeout(() => {
        finish('offline');
      }, PROBE_TIMEOUT_MS);

      audio.addEventListener('loadedmetadata', () => {
        // Server sent audio data — station is reachable.
        finish('online');
      });

      audio.addEventListener('error', () => {
        const code = audio.error?.code;
        // MEDIA_ERR_NETWORK (2): DNS failure, connection refused, timeout.
        if (code === 2) {
          finish('offline');
        } else {
          // MEDIA_ERR_SRC_NOT_SUPPORTED (4) or MEDIA_ERR_DECODE (3):
          // Server responded with something, just not in a format we
          // recognise. The endpoint is reachable → online.
          finish('online');
        }
      });

      // Also handle the 'canplay' event for streams that fire it before
      // 'loadedmetadata' (some icecast servers). Don't rely on it alone
      // though — 'loadedmetadata' is the canonical signal.
      audio.addEventListener('canplay', () => {
        // If canplay fires without loadedmetadata (edge case), treat as online.
        if (!settled) finish('online');
      });

      audio.src = station.url;
    });
  }

  async function runProbeCycle() {
    if (probing) return; // Previous cycle still running.
    probing = true;
    aborted = false;

    const stations = getStations();
    if (!stations || stations.length === 0) {
      probing = false;
      return;
    }

    const newStatuses = {};
    let changed = false;

    for (const station of stations) {
      if (aborted) break; // List changed mid-cycle — abort.
      if (!station?.url) {
        newStatuses[station.id] = 'online'; // No URL to probe, assume online.
        continue;
      }

      const result = await probeOne(station);
      newStatuses[station.id] = result;

      if (newStatuses[station.id] !== (statuses[station.id] ?? 'online')) {
        changed = true;
      }
    }

    // Any stations that disappeared from the list — mark as changed so the
    // caller can drop stale data-offline attributes.
    if (!changed) {
      const oldKeys = Object.keys(statuses);
      const newKeys = Object.keys(newStatuses);
      if (oldKeys.length !== newKeys.length) changed = true;
      else if (oldKeys.some(k => !(k in newStatuses))) changed = true;
    }

    if (changed || Object.keys(statuses).length === 0) {
      statuses = newStatuses;
      onStatusChange?.(statuses);
    } else {
      statuses = newStatuses;
    }

    probing = false;
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        runProbeCycle();
      }
    }, PROBE_INTERVAL_MS);
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      // Tab just became visible — re-probe immediately so the user
      // sees fresh status, then resume the regular interval.
      if (!probing) runProbeCycle();
      startTimer();
    } else {
      stopTimer();
    }
  }

  // Public API
  function start() {
    statuses = {};
    aborted = true; // Abort any in-flight cycle from previous list.
    startTimer();
    // Probe immediately on first attach.
    if (!probing) runProbeCycle();
  }

  function stop() {
    aborted = true;
    stopTimer();
    probing = false;
    statuses = {};
    onStatusChange?.({});
  }

  function refresh() {
    // Force immediate re-probe (e.g. after list change).
    aborted = true;
    // Wait for any in-flight cycle to notice the abort flag.
    setTimeout(() => {
      aborted = false;
      if (!probing) runProbeCycle();
    }, 100);
  }

  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start,
    stop,
    refresh,
    getStatuses: () => ({ ...statuses }),
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
