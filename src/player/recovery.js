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
  let stallTimer = null;
  let recoveryTimer = null;

  const clearStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  };

  const clearRecoveryTimer = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  const reset = () => {
    attempts = 0;
    clearStallTimer();
    clearRecoveryTimer();
  };

  const tryRecover = () => {
    const station = player.getCurrentStation();
    if (!station) return;
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`[recovery] giving up after ${MAX_ATTEMPTS} attempts`);
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
  audio.addEventListener('pause', clearStallTimer);
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
}
