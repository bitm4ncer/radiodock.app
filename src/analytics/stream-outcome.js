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
// `track` and `report` are injected rather than imported so this module stays
// loadable outside a Vite build, which is what makes it testable (same
// reasoning as listen-heartbeat.js). `track` is the unchanged Umami event;
// `report` is the anonymous Stations telemetry copy.
export function attachStreamOutcome(player, {
  dwellMs = 5000,
  failAfterMs = 12_000,
  track = () => {},
  report = () => {},
  now = () => performance.now(),
  randomUUID = () => crypto.randomUUID(),
  getContext = () => ({}),
} = {}) {
  let attempt = null;
  let dwellTimer = null;
  let failTimer = null;
  let ignoreSwitchPause = false;

  const clearTimers = () => {
    if (dwellTimer) clearTimeout(dwellTimer);
    if (failTimer) clearTimeout(failTimer);
    dwellTimer = null;
    failTimer = null;
  };

  // The Stations ingest validates UUIDs, so the no-crypto fallback must keep
  // that shape rather than inventing an opaque attempt-… id the server drops.
  const fallbackId = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
  const nextAttemptId = () => {
    try {
      return String(randomUUID() || fallbackId());
    } catch {
      return fallbackId();
    }
  };

  const makeAttempt = (station) => {
    let context = {};
    try {
      context = getContext(station) ?? {};
    } catch {
      context = {};
    }
    return {
      id: station?.id ?? '',
      name: station?.name ?? '',
      attemptId: nextAttemptId(),
      startedAt: now(),
      hadAudio: false,
      startupMs: undefined,
      reason: '',
      decided: false,
      lastOutcome: null,
      reported: false,
      telemetryOutcome: null,
      lateFailureReported: false,
      context,
    };
  };

  const reportTelemetry = (outcome, { late = false } = {}) => {
    if (!attempt) return;
    if (late ? attempt.lateFailureReported : attempt.reported) return;

    const audio = attempt.hadAudio === true;
    const payload = {
      attemptId: attempt.attemptId,
      stationuuid: attempt.id,
      outcome,
      audio,
      phase: audio ? 'playback' : 'start',
      elapsedMs: Math.max(0, Math.round(now() - attempt.startedAt)),
    };
    if (audio && attempt.startupMs !== undefined) payload.startupMs = attempt.startupMs;
    const context = attempt.context;
    if (context && typeof context === 'object') {
      if (context.hls !== undefined) payload.hls = context.hls;
      if (context.platform !== undefined) payload.platform = context.platform;
      if (context.network !== undefined) payload.network = context.network;
    }
    if (outcome === 'failed' || (outcome === 'aborted' && attempt.reason === 'NotAllowedError')) {
      if (attempt.reason) payload.reason = attempt.reason;
    }

    if (late) attempt.lateFailureReported = true;
    else {
      attempt.reported = true;
      attempt.telemetryOutcome = outcome;
    }

    try {
      report(payload);
    } catch {
      // Telemetry must never affect the player or the Umami event.
    }
  };

  const decide = (outcome) => {
    if (!attempt || attempt.decided) return;
    attempt.decided = true;
    attempt.lastOutcome = outcome;
    clearTimers();
    const payload = {
      uuid: attempt.id,
      station: attempt.name,
      outcome,
      audio: attempt.hadAudio ? 'yes' : 'no',
    };
    if (outcome === 'failed' && attempt.reason) payload.reason = attempt.reason;
    try {
      track('stream-outcome', payload);
    } catch {
      // Analytics must never break playback.
    }
    reportTelemetry(outcome);
  };

  player.on('stationchange', (evt) => {
    const station = evt.detail?.station ?? null;
    const id = station?.id ?? '';
    // The recovery layer replays the SAME station through playStation(), which
    // emits stationchange again. That is the same attempt, not a new one.
    if (attempt && attempt.id === id) {
      ignoreSwitchPause = attempt.hadAudio === true;
      return;
    }
    ignoreSwitchPause = attempt?.hadAudio === true;
    decide('aborted');
    clearTimers();
    attempt = makeAttempt(station);
  });

  player.on('playing', () => {
    if (!attempt || attempt.decided || attempt.hadAudio) return;
    attempt.hadAudio = true;
    attempt.startupMs = Math.max(0, Math.round(now() - attempt.startedAt));
    ignoreSwitchPause = false;
    if (failTimer) { clearTimeout(failTimer); failTimer = null; }
    // Sound alone is not success: a stream that dies after two seconds would
    // otherwise look identical to one that plays for an hour.
    dwellTimer = setTimeout(() => decide('played'), dwellMs);
  });

  const onError = (evt) => {
    const name = evt?.detail?.name ?? '';
    // AbortError is the previous load being interrupted by the next station,
    // i.e. fast zapping. Not a stream problem, and not a reason.
    if (name === 'AbortError') return;
    if (!attempt) return;
    if (!attempt.reason) attempt.reason = name;

    // Autoplay denial is a client-side condition, not a station failure. The
    // telemetry copy records it as aborted, while the existing Umami path keeps
    // its original failed verdict.
    if (name === 'NotAllowedError') {
      reportTelemetry('aborted');
      if (!attempt.hadAudio && !failTimer && !attempt.decided) {
        failTimer = setTimeout(() => decide('failed'), failAfterMs);
      }
      return;
    }

    if (attempt.decided) return;
    // Usually the recovery layer decides this for us by giving up. The timer is
    // the backstop for error paths that never reach it.
    if (!attempt.hadAudio && !failTimer) failTimer = setTimeout(() => decide('failed'), failAfterMs);
  };
  player.on('error', onError);
  player.on('mediaerror', onError);

  player.on('recoveryfailed', () => {
    if (!attempt) return;
    // The stream was already counted as played; correct that same row to failed
    // with the same attempt id instead of creating a second attempt.
    if (attempt.telemetryOutcome === 'played') {
      reportTelemetry('failed', { late: true });
      return;
    }
    decide('failed');
  });

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
  player.on('paused', () => {
    // playStation() emits stationchange and then pauses the outgoing element.
    // Only swallow that one pause, and only when the outgoing attempt had
    // actually produced audio (otherwise the player never paused).
    if (ignoreSwitchPause) {
      ignoreSwitchPause = false;
      return;
    }
    onStop();
  });
}
