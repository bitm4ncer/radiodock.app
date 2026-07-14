// Stream prober: checks station URLs once per minute to detect offline streams.
// Sequential probing (one at a time, 5s timeout each) so we don't flood the
// network stack with parallel TCP connections to stream servers.
//
// Uses fetch() with mode: 'no-cors' for probing. Unlike regular fetch(),
// no-cors requests succeed for cross-origin resources without CORS headers
// (returning an opaque response). We can't read the response, but the fact
// that the Promise resolved means the server is reachable. Only genuine
// network errors (DNS failure, connection refused, timeout) reject.
//
// Pauses when the tab is hidden (visibilitychange) — no point probing streams
// nobody is looking at. Resumes on visibility restore + immediately re-probes.

const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

export function attachStreamProber({ getStations, onStatusChange }) {
  let timer = null;
  let statuses = {};          // { stationId: 'online' | 'offline' }
  let probing = false;
  let aborted = false;

  /**
   * Probe a single station URL via no-cors fetch.
   *
   * mode: 'no-cors' makes the browser send a real HTTP request but
   * return an opaque response — we can't inspect status/headers, but
   * we don't need to. If the Promise resolves, TCP + TLS succeeded
   * and the server sent data back → reachable. If it rejects, the
   * server is genuinely unreachable.
   *
   * @returns {'online' | 'offline'}
   */
  async function probeOne(station) {
    try {
      await fetch(station.url, {
        method: 'GET',
        mode: 'no-cors',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        cache: 'no-store',
      });
      return 'online';
    } catch (err) {
      // AbortError / TimeoutError → no response in time → offline.
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        return 'offline';
      }
      // TypeError with 'Failed to fetch' / 'NetworkError' → offline.
      if (err.name === 'TypeError') {
        return 'offline';
      }
      // Anything else → inconclusive, keep previous status.
      return null;
    }
  }

  async function runProbeCycle() {
    if (probing) return;
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
      if (aborted) break;
      if (!station?.url) {
        newStatuses[station.id] = 'online';
        continue;
      }

      const result = await probeOne(station);
      if (result === null) {
        newStatuses[station.id] = statuses[station.id] ?? 'online';
      } else {
        newStatuses[station.id] = result;
      }

      if (newStatuses[station.id] !== (statuses[station.id] ?? 'online')) {
        changed = true;
      }
    }

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
      if (!probing) runProbeCycle();
      startTimer();
    } else {
      stopTimer();
    }
  }

  function start() {
    statuses = {};
    aborted = true;
    startTimer();
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
    aborted = true;
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
