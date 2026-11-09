// Lightweight stream-recovery layer. Attaches to the shared audio element
// and re-tries playback with backoff when the element errors or stalls.
// Replaces the extension's chrome.alarms-driven health monitor with plain timers.
// A backgrounded sleeping tab may not self-heal on desktop — accepted tradeoff.

const MAX_ATTEMPTS = 3;
const DELAYS_MS = [1000, 4000, 10000];
const STALL_THRESHOLD_MS = 15000;
// After the fast budget is exhausted the station may still be in a transient
// upstream outage (a relay restart, a CDN blip, a station that comes back after
// its night break). Keep checking once a minute instead of parking forever on
// a dead play state; the user should not have to re-tap the station.
const GIVE_UP_RETRY_MS = 30000;

export function attachRecovery(player) {
  const audio = player._element();
  let attempts = 0;
  let gaveUp = false;
  let stallTimer = null;
  let recoveryTimer = null;
  let slowRetryTimer = null;
  let waitingForNetwork = false;
  let userPaused = false;
  let internalPauseExpected = false;
  let lastBackgroundResumeAt = 0;

  const isHidden = () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden';

  // audio.js owns the distinction between an explicit pause (player.pause(),
  // lock-screen pause) and a pause imposed by the OS when the app goes to the
  // background. Older/minimal test doubles do not expose it; default to the
  // historical "pause means user intent" behaviour for those.
  const userIntentPause = () =>
    typeof player.isUserPaused === 'function' ? player.isUserPaused() === true : true;

  const emit = (type, detail) =>
    player.events?.dispatchEvent(new CustomEvent(type, { detail }));

  const clearStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };

  const clearRecoveryTimer = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const clearSlowRetryTimer = () => {
    if (slowRetryTimer) clearTimeout(slowRetryTimer);
    slowRetryTimer = null;
  };

  const reset = () => {
    // Playback resumed after at least one scheduled retry — the recovery
    // layer actually healed something, worth surfacing to analytics.
    if (attempts > 0 && !gaveUp) emit('recovered', { attempts });
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
    userPaused = false;
    clearStallTimer();
    clearRecoveryTimer();
    clearSlowRetryTimer();
  };

  // Manual station switch: drop pending retries and reset the counter
  // silently, so the new station neither inherits the old one's attempt
  // budget nor produces a phantom 'recovered' when it starts playing.
  const resetSilently = () => {
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
    userPaused = false;
    clearStallTimer();
    clearRecoveryTimer();
    clearSlowRetryTimer();
  };

  const scheduleSlowRetry = () => {
    if (slowRetryTimer) return;
    slowRetryTimer = setTimeout(() => {
      slowRetryTimer = null;
      if (userPaused) return;
      if (!navigator.onLine) {
        waitingForNetwork = true;
        return;
      }
      const current = player.getCurrentStation();
      if (!current) return;
      // If audio came back through another path (e.g. a foreground reconnect),
      // do not cut it.
      if (!audio.paused) return;
      // Keep `gaveUp` set so 'recoveryfailed' is emitted once per outage, not
      // once per slow-retry cycle; a successful 'playing' clears it.
      attempts = 0;
      player.playStation(current);
    }, GIVE_UP_RETRY_MS);
  };

  const tryRecover = () => {
    if (userPaused) return;
    // A retry is already queued. Element errors, relay play() rejections and
    // HLS fatals can all point at the same failure; burning three attempts on
    // duplicates would give up while the first retry has not even run yet.
    if (recoveryTimer) return;
    // Any new failure supersedes a pending slow retry; the give-up branch
    // below re-arms it after the fast budget is spent again.
    clearSlowRetryTimer();
    // audio.js is already handing this failure to the relay. Do not race that
    // handoff, but DO arm a retry for after the grace: if the relay itself
    // fails immediately (429/503) no further element event follows, and a bare
    // return here used to leave the player silently stuck forever.
    if (player.isEscalating?.()) {
      clearRecoveryTimer();
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        const current = player.getCurrentStation();
        if (!current) return;
        tryRecover();
      }, 1600);
      return;
    }
    const station = player.getCurrentStation();
    if (!station) return;
    if (!navigator.onLine) {
      // No point burning the attempt budget without a network — park and
      // let the window 'online' handler replay immediately.
      waitingForNetwork = true;
      clearRecoveryTimer();
      return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`[recovery] giving up after ${MAX_ATTEMPTS} attempts`);
      if (!gaveUp) {
        gaveUp = true;
        emit('recoveryfailed', { attempts });
      }
      scheduleSlowRetry();
      return;
    }
    const delay = DELAYS_MS[attempts] ?? DELAYS_MS.at(-1);
    attempts++;
    console.info(`[recovery] attempt ${attempts}/${MAX_ATTEMPTS} in ${delay}ms`);
    clearRecoveryTimer();
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      const current = player.getCurrentStation();
      if (!current) return;
      player.playStation(current);
    }, delay);
  };

  audio.addEventListener('playing', reset);
  audio.addEventListener('pause', () => {
    clearStallTimer();
    // playStation() pauses the outgoing stream before switching; that pause
    // is an internal loading step, not user intent, so it must not cancel a
    // pending retry. A real pause (the user tapping pause) does.
    if (internalPauseExpected) {
      internalPauseExpected = false;
      return;
    }
    // A backgrounded app / audio-focus loss pauses the element without the
    // user asking. Treating that as a user pause used to strand the player:
    // isUserPaused() stayed true, so returning to the app never reconnected.
    if (!userIntentPause()) {
      if (isHidden()) {
        // Do not burn retry attempts against a frozen tab; visibilitychange
        // reconnects when the app is foregrounded again.
        clearStallTimer();
        clearRecoveryTimer();
      }
      return;
    }
    userPaused = true;
    clearStallTimer();
    clearRecoveryTimer();
    clearSlowRetryTimer();
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
  });
  // playStation() emits stationchange on every call — including our own
  // retries of the SAME station — so only an actual id change may reset,
  // otherwise each retry would refill its own attempt budget.
  let lastStationId = null;
  player.on('stationchange', (evt) => {
    const id = evt.detail?.station?.id ?? null;
    // Only expect an internal pause when the element was actually playing:
    // on a cold start audio.pause() is a no-op (no pause event), so a flag
    // set unconditionally here would swallow the user's next real pause.
    internalPauseExpected = !audio.paused;
    userPaused = false;
    // Every playStation() attempt supersedes a pending slow retry; otherwise a
    // manual replay and a 30 s timer could race into two simultaneous loads.
    clearSlowRetryTimer();
    if (lastStationId !== null && id !== lastStationId) resetSilently();
    lastStationId = id;
  });
  player.on('stopped', () => {
    // Stopping and replaying the SAME station must start with a fresh attempt
    // budget; otherwise a station that failed earlier replays in gave-up state.
    resetSilently();
    lastStationId = null;
    internalPauseExpected = false;
  });
  audio.addEventListener('ended', () => {
    // Live streams shouldn't "end" — treat as a recoverable error.
    tryRecover();
  });
  audio.addEventListener('error', () => {
    tryRecover();
  });
  // HLS fatal errors exhaust their transport ladder inside audio.js and never
  // touch the element (hls.js owns a MediaSource blob), so the element's
  // 'error' listener cannot see them. The player-level error is the signal
  // that a stream attempt has finally failed and recovery must take over.
  player.on('error', (evt) => {
    const name = evt?.detail?.name;
    if (name === 'NotAllowedError' || name === 'AbortError') return;
    tryRecover();
  });
  audio.addEventListener('stalled', () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      if (!audio.paused) tryRecover();
    }, STALL_THRESHOLD_MS);
  });
  audio.addEventListener('waiting', () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      if (!audio.paused) tryRecover();
    }, STALL_THRESHOLD_MS);
  });

  window.addEventListener('offline', () => {
    if (recoveryTimer || stallTimer || slowRetryTimer) {
      waitingForNetwork = true;
      clearRecoveryTimer();
      clearStallTimer();
      clearSlowRetryTimer();
    }
  });

  window.addEventListener('online', () => {
    if (userPaused || userIntentPause()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    if (!waitingForNetwork && !recoveryTimer && !gaveUp) return;
    waitingForNetwork = false;
    gaveUp = false;
    if (attempts === 0) attempts = 1;
    clearRecoveryTimer();
    clearStallTimer();
    clearSlowRetryTimer();
    player.playStation(station);
  });

  // Mobile app switch: the OS generally suspends (or pauses) a backgrounded
  // audio element. On return the element can be paused, stuck at readyState 0,
  // or holding a stale HLS buffer. Reconnect to the live edge instead of
  // waiting for a stall event that may never fire in a frozen tab.
  const resumeAfterBackground = () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const station = player.getCurrentStation();
    if (!station) return;
    if (userPaused || userIntentPause()) return;
    // An escalation is already running (native relay or HLS manifest load).
    // Re-entering playStation would destroy that attempt before it can produce
    // audio; recovery owns the retry if it really fails.
    if (player.isEscalating?.()) return;
    // A stream that genuinely kept playing in the background is healthy; do
    // not cut it and create a gap.
    if (!audio.paused && (audio.readyState ?? 0) >= 2) return;
    // visibilitychange + pageshow can both fire on the same return.
    const now = Date.now();
    if (now - lastBackgroundResumeAt < 1500) return;
    lastBackgroundResumeAt = now;
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
    clearRecoveryTimer();
    clearStallTimer();
    clearSlowRetryTimer();
    player.playStation(station);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // The tab is frozen; pending attempts would only expire unseen.
        clearStallTimer();
        clearRecoveryTimer();
        clearSlowRetryTimer();
        return;
      }
      resumeAfterBackground();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', resumeAfterBackground);
  }
}
