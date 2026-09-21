// One verdict per listening attempt: did pressing play produce audio?
//
// Why this exists: playability was previously only inferable from
// listen-pings, and that cannot work. The first ping lands after 60 s of
// audio, so a third of all plays never produce one, and the ones that do
// measure how long someone felt like listening, not whether the stream
// works. The existing stream-error event has the mirror problem: `phase:
// 'start'` also fires on reconnect attempts, so its volume mixes recovered
// hiccups, user zapping and genuine failures. Neither answers "can people
// play this station".
//
// So: exactly one `stream-outcome` per attempt, decided as soon as it is
// knowable, carrying the station uuid (which stream-error does not).
//
//   played   audio ran and survived the dwell
//   failed   the attempt ended in an error; `audio` says whether any sound
//            was heard first, which separates "never starts" from
//            "connects and dies immediately"
//   aborted  the listener moved on before audio began; not a defect, but
//            counted so the denominator stays honest
//
// `track` is injected rather than imported so this module stays loadable
// outside a Vite build, which is what makes it testable (same reasoning as
// listen-heartbeat.js).
export function attachStreamOutcome(player, {
  dwellMs = 5000,
  failAfterMs = 12_000,
  track = () => {},
} = {}) {
  let attempt = null;
  let dwellTimer = null;
  let failTimer = null;

  const clearTimers = () => {
    if (dwellTimer) clearTimeout(dwellTimer);
    if (failTimer) clearTimeout(failTimer);
    dwellTimer = null;
    failTimer = null;
  };

  const decide = (outcome) => {
    if (!attempt || attempt.decided) return;
    attempt.decided = true;
    clearTimers();
    const payload = {
      uuid: attempt.id,
      station: attempt.name,
      outcome,
      audio: attempt.hadAudio ? 'yes' : 'no',
    };
    if (outcome === 'failed' && attempt.reason) payload.reason = attempt.reason;
    track('stream-outcome', payload);
  };

  player.on('stationchange', (evt) => {
    const station = evt.detail?.station ?? null;
    const id = station?.id ?? '';
    // The recovery layer replays the SAME station through playStation(), which
    // emits stationchange again. That is the same attempt, not a new one.
    if (attempt && attempt.id === id) return;
    decide('aborted');
    clearTimers();
    attempt = { id, name: station?.name ?? '', hadAudio: false, decided: false, reason: '' };
  });

  player.on('playing', () => {
    if (!attempt || attempt.decided || attempt.hadAudio) return;
    attempt.hadAudio = true;
    if (failTimer) { clearTimeout(failTimer); failTimer = null; }
    // Sound alone is not success: a stream that dies after two seconds would
    // otherwise look identical to one that plays for an hour.
    dwellTimer = setTimeout(() => decide('played'), dwellMs);
  });

  const onError = (evt) => {
    // AbortError is the previous load being interrupted by the next station,
    // i.e. fast zapping. Not a stream problem, and not a reason.
    if ((evt?.detail?.name ?? '') === 'AbortError') return;
    if (!attempt || attempt.decided) return;
    if (!attempt.reason) attempt.reason = evt?.detail?.name ?? '';
    // Usually the recovery layer decides this for us by giving up. The timer is
    // the backstop for error paths that never reach it.
    if (!attempt.hadAudio && !failTimer) failTimer = setTimeout(() => decide('failed'), failAfterMs);
  };
  player.on('error', onError);
  player.on('mediaerror', onError);

  player.on('recoveryfailed', () => decide('failed'));

  const onStop = () => {
    if (!attempt || attempt.decided) return;
    if (attempt.hadAudio) { decide('played'); return; }
    // A pause that follows an error is the failure itself, not the listener
    // moving on: the element pauses the moment its source dies, and that
    // happens long before the recovery layer has spent its attempts. Leave the
    // verdict to recoveryfailed (or the backstop timer).
    if (attempt.reason) return;
    decide('aborted');
  };
  player.on('stopped', onStop);
  player.on('paused', onStop);
}
