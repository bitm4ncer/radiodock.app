// Stream prober: checks station URLs once per minute to detect offline streams.
// Sequential probing (one at a time, 5s timeout each) so we don't flood the
// network stack with parallel TCP connections to stream servers.
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

  async function probeOne(station) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      // Fetch just enough to confirm the server is sending data.
      // We don't read the body — the response headers alone tell us
      // whether the stream endpoint is reachable.
      const resp = await fetch(station.url, {
        method: 'GET',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      // If we get here, the server responded. A 2xx/3xx means the
      // endpoint is alive (most icecast servers return 200 OK with
      // audio/mpeg or similar). Anything else (404, 500) means offline.
      return resp.ok ? 'online' : 'offline';
    } catch (err) {
      if (err.name === 'AbortError') {
        // Our own timeout — server didn't respond in 5s → likely offline.
        return 'offline';
      }
      // TypeError with message containing 'NetworkError' or 'Failed to fetch'
      // means a genuine network failure (DNS, connection refused, etc.).
      if (err.name === 'TypeError') {
        const msg = err.message?.toLowerCase() ?? '';
        if (msg.includes('networkerror') || msg.includes('failed to fetch')) {
          return 'offline';
        }
      }
      // CORS error, mixed-content block, etc. → inconclusive, don't flip status.
      return null;
    } finally {
      clearTimeout(timeout);
    }
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
        newStatuses[station.id] = 'unknown';
        continue;
      }

      const result = await probeOne(station);
      if (result === null) {
        // Inconclusive — keep previous status, or default to 'online'.
        newStatuses[station.id] = statuses[station.id] ?? 'online';
      } else {
        newStatuses[station.id] = result;
      }

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
