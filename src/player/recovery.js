// Lightweight stream-recovery layer. Attaches to the shared audio element
// and re-tries playback with backoff when the element errors or stalls.
// Replaces the extension's chrome.alarms-driven health monitor with plain timers.
// A backgrounded sleeping tab may not self-heal on desktop — accepted tradeoff.

const MAX_ATTEMPTS = 3;
const DELAYS_MS = [800, 2000, 4000];
const STALL_THRESHOLD_MS = 15000;

export function attachRecovery(player) {
  const audio = player._element();
  let attempts = 0;
  let gaveUp = false;
  let stallTimer = null;
  let recoveryTimer = null;
  let waitingForNetwork = false;

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

  const reset = () => {
    // Playback resumed after at least one scheduled retry — the recovery
    // layer actually healed something, worth surfacing to analytics.
    if (attempts > 0 && !gaveUp) emit('recovered', { attempts });
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
    clearStallTimer();
    clearRecoveryTimer();
  };

  // Manual station switch: drop pending retries and reset the counter
  // silently, so the new station neither inherits the old one's attempt
  // budget nor produces a phantom 'recovered' when it starts playing.
  const resetSilently = () => {
    attempts = 0;
    gaveUp = false;
    waitingForNetwork = false;
    clearStallTimer();
    clearRecoveryTimer();
  };

  const tryRecover = () => {
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
      return;
    }
    const delay = DELAYS_MS[attempts] ?? DELAYS_MS.at(-1);
    attempts++;
    console.info(`[recovery] attempt ${attempts}/${MAX_ATTEMPTS} in ${delay}ms`);
    clearRecoveryTimer();
    recoveryTimer = setTimeout(() => {
      const current = player.getCurrentStation();
      if (!current) return;
      player.playStation(current);
    }, delay);
  };

  audio.addEventListener('playing', reset);
  audio.addEventListener('pause', () => {
    clearStallTimer();
    // While parked no retries run, so a pause during park is user intent —
    // don't let the online handler override it.
    waitingForNetwork = false;
  });
  // playStation() emits stationchange on every call — including our own
  // retries of the SAME station — so only an actual id change may reset,
  // otherwise each retry would refill its own attempt budget.
  let lastStationId = null;
  player.on('stationchange', (evt) => {
    const id = evt.detail?.station?.id ?? null;
    if (lastStationId !== null && id !== lastStationId) resetSilently();
    lastStationId = id;
  });
  audio.addEventListener('ended', () => {
    // Live streams shouldn't "end" — treat as a recoverable error.
    tryRecover();
  });
  audio.addEventListener('error', () => {
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
    if (recoveryTimer || stallTimer) {
      waitingForNetwork = true;
      clearRecoveryTimer();
      clearStallTimer();
    }
  });

  window.addEventListener('online', () => {
    const station = player.getCurrentStation();
    if (!station) return;
    if (!waitingForNetwork && !recoveryTimer && !gaveUp) return;
    waitingForNetwork = false;
    gaveUp = false;
    if (attempts === 0) attempts = 1;
    clearRecoveryTimer();
    clearStallTimer();
    player.playStation(station);
  });
}
