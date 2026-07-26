// Off-air detection for the active list. Shows an OFF badge on rows whose
// stream is not currently broadcasting (e.g. a community station that goes
// off-air at night) — NOT a permanent dead-channel marker.
//
// Two signal sources, by design:
//
//   1. The station the user is ACTUALLY playing is never probed here. Its
//      liveness is known authoritatively from the audio pipeline: recovery.js
//      emits 'recoveryfailed' once reconnect attempts are exhausted, and
//      'playing'/'recovered' when audio flows. main.js overlays that status.
//      Probing the playing station would open a SECOND connection to the same
//      URL, and many stream servers cap connections per IP — the second one
//      gets refused, which is exactly the old "false OFF while sound plays"
//      bug. So we skip it.
//
//   2. Every OTHER station is briefly loaded into a throwaway, muted <audio>
//      element. <audio> loads cross-origin streams without CORS (the app
//      forbids the crossorigin attribute for this very reason), so we get a
//      real verdict where fetch() cannot:
//        ONLINE  — the element reports audio data (loadedmetadata / canplay /
//                  loadeddata / buffered progress).
//        OFFLINE — a MediaError. A stream that has gone off-air usually
//                  returns a 404 / HTML error page; the <audio> element can't
//                  decode that and fires 'error' (MEDIA_ERR_SRC_NOT_SUPPORTED /
//                  MEDIA_ERR_NETWORK). A hard error is the ONLY confident
//                  off-air signal — that is when we badge OFF.
//        UNKNOWN — the timeout expired with neither data nor error. This is
//                  INCONCLUSIVE, never OFF. Many healthy stations have a slow,
//                  variable cold-start first-byte (icecast under load) that
//                  legitimately exceeds the timeout; flagging those OFF is the
//                  worse error. A false OFF discourages tapping a working
//                  station, so we only ever badge OFF on positive proof.
//      (A no-cors fetch can't read HTTP status — an opaque response looks
//      online — which is why the <audio> decode path is the right probe.)
//
// Sequential-ish with small concurrency so a full pass over the active list
// completes in ~40s without flooding stream servers, then re-checks each
// minute. Pauses when the tab is hidden.

const PROBE_TIMEOUT_MS = 6_000;   // generous for a stream to emit headers/data
const RECHECK_INTERVAL_MS = 60_000;
const CONCURRENCY = 3;

// Mixed-content upgrade, mirrors preferHttps() in audio.js: on secure origins
// an http:// probe would be blocked and read as a false error.
function preferHttps(url) {
  if (typeof window !== 'undefined' && window.isSecureContext && url.startsWith('http://')) {
    return 'https://' + url.slice('http://'.length);
  }
  return url;
}

export function attachStreamProber({ getStations, getPlayingId, onStatusChange }) {
  let timer = null;
  let statuses = {};          // { stationId: 'online' | 'offline' | 'unknown' } — non-playing rows only
  let probing = false;
  let aborted = false;
  // Attaching must not start probing. The visibilitychange listener below is
  // registered once at attach time, so without this gate a caller that never
  // called start() (or that called stop()) would still get a full probe pass —
  // and a repeating timer — on the first tab hide/show.
  let running = false;

  /**
   * Load a station URL into a throwaway muted <audio> and classify.
   * @returns {Promise<'online' | 'offline' | 'unknown'>}
   */
  function probeOne(station) {
    return new Promise((resolve) => {
      let settled = false;
      const audio = new Audio();
      audio.muted = true;
      audio.volume = 0;
      audio.preload = 'auto';   // fetch enough to know data actually flows

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onData);
        audio.removeEventListener('loadeddata', onData);
        audio.removeEventListener('canplay', onData);
        audio.removeEventListener('progress', onProgress);
        audio.removeEventListener('error', onError);
        // Release the connection immediately — we never keep streaming.
        audio.removeAttribute('src');
        try { audio.load(); } catch { /* teardown best-effort */ }
        resolve(result);
      };

      const onData = () => finish('online');
      const onProgress = () => {
        if (audio.buffered && audio.buffered.length > 0) finish('online');
      };
      const onError = () => finish('offline');   // MediaError → confident off-air (404/decode)

      audio.addEventListener('loadedmetadata', onData);
      audio.addEventListener('loadeddata', onData);
      audio.addEventListener('canplay', onData);
      audio.addEventListener('progress', onProgress);
      audio.addEventListener('error', onError);

      // Timeout = inconclusive, NOT offline. A slow-but-healthy stream that
      // hasn't emitted data yet must never be badged OFF (that was the old
      // false-OFF bug on cold-start icecast). Only a hard error flips to OFF.
      const timer = setTimeout(() => finish('unknown'), PROBE_TIMEOUT_MS);

      audio.src = preferHttps(station.url);
      try { audio.load(); } catch { finish('offline'); }
    });
  }

  async function runProbeCycle() {
    if (probing) return;
    probing = true;
    aborted = false;

    const all = getStations?.() ?? [];
    const playingId = getPlayingId?.() ?? null;
    const queue = all.filter((s) => s?.url && s.id !== playingId);

    // Start from a clean map so stale ids (list switched) don't linger.
    const next = {};
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length && !aborted) {
        const station = queue[cursor++];
        const result = await probeOne(station);
        if (aborted) return;
        next[station.id] = result;
        // Emit progressively so rows flip as the scan advances (~40s pass).
        statuses = { ...next };
        onStatusChange?.(statuses);
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (!aborted) {
      statuses = next;
      onStatusChange?.(statuses);
    }
    probing = false;
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') runProbeCycle();
    }, RECHECK_INTERVAL_MS);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function onVisibilityChange() {
    if (!running) return;
    if (document.visibilityState === 'visible') {
      if (!probing) runProbeCycle();
      startTimer();
    } else {
      stopTimer();
    }
  }

  function start() {
    running = true;
    aborted = false;
    statuses = {};
    startTimer();
    if (!probing) runProbeCycle();
  }

  function stop() {
    running = false;
    aborted = true;
    stopTimer();
    probing = false;
    statuses = {};
    onStatusChange?.({});
  }

  // Active list changed: abort the in-flight pass and restart cleanly.
  function refresh() {
    if (!running) return;
    aborted = true;
    probing = false;
    statuses = {};
    onStatusChange?.({});
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
