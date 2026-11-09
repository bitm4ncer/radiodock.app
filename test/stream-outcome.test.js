import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachStreamOutcome } from '../src/analytics/stream-outcome.js';

// One verdict per listening attempt, decided as soon as it is knowable.
// The point of this module is that playability stops being something we
// reconstruct from listen-pings: a ping only lands after 60 s of audio, so a
// third of all plays are invisible to it, and duration measures taste anyway.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = { id: 'uuid-a', name: 'Station A' };
const B = { id: 'uuid-b', name: 'Station B' };

function harness({ dwellMs = 5, failAfterMs = 30, report } = {}) {
  const handlers = new Map();
  const events = [];
  const reports = [];
  const reportFn = report ?? ((p) => reports.push(p));
  let current = null;
  let t = 0;
  let uuidSeq = 0;
  const player = {
    on: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    getCurrentStation: () => current,
  };
  attachStreamOutcome(player, {
    dwellMs, failAfterMs,
    now: () => t,
    // First id is pinned for the exact-payload test; later attempts must differ.
    randomUUID: () => (uuidSeq++ === 0
      ? '44444444-4444-4444-8444-444444444444'
      : '55555555-5555-4555-8555-555555555555'),
    getContext: () => ({ hls: true, platform: 'touch', network: '4g' }),
    track: (n, p) => events.push({ n, ...p }),
    report: reportFn,
  });
  const emit = (type, detail) => {
    if (type === 'stationchange') current = detail?.station ?? null;
    for (const fn of handlers.get(type) ?? []) fn({ detail });
  };
  return {
    emit,
    events,
    reports,
    play: (s) => emit('stationchange', { station: s }),
    advance: (ms) => { t += ms; },
  };
}

test('audio that survives the dwell reports played', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  await sleep(25);
  assert.deepEqual(h.events, [{ n: 'stream-outcome', uuid: 'uuid-a', station: 'Station A', outcome: 'played', audio: 'yes' }]);
});

test('reports once, not per rebuffer', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  await sleep(25);
  h.emit('playing');
  h.emit('playing');
  await sleep(25);
  assert.equal(h.events.length, 1);
});

test('a give-up before any audio reports failed with the error name', async () => {
  const h = harness();
  h.play(A);
  h.emit('error', { name: 'NotSupportedError' });
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'failed');
  assert.equal(h.events[0].audio, 'no');
  assert.equal(h.events[0].reason, 'NotSupportedError');
});

test('a station that connects and dies before the dwell reports failed, but with audio', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  h.emit('mediaerror', { name: 'MEDIA_ERR_NETWORK' });
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'failed');
  assert.equal(h.events[0].audio, 'yes');
});

test('dying long after the verdict does not report a second time', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  await sleep(25);
  h.emit('mediaerror', { name: 'MEDIA_ERR_NETWORK' });
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'played');
});

test('errors alone decide failed once the grace period passes', async () => {
  const h = harness({ dwellMs: 5, failAfterMs: 15 });
  h.play(A);
  h.emit('error', { name: 'NotSupportedError' });
  await sleep(40);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'failed');
});

test('switching away before audio reports aborted, and opens the next attempt', async () => {
  const h = harness();
  h.play(A);
  h.play(B);
  h.emit('playing');
  await sleep(25);
  assert.equal(h.events.length, 2);
  assert.deepEqual(h.events.map((e) => [e.uuid, e.outcome]), [['uuid-a', 'aborted'], ['uuid-b', 'played']]);
});

test('a retry of the same station is not a new attempt', async () => {
  const h = harness();
  h.play(A);
  h.emit('mediaerror', { name: 'MEDIA_ERR_NETWORK' });
  h.play(A);            // recovery replays the same station
  h.emit('playing');    // and it works this time
  await sleep(25);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'played');
});

test('stopping after audio but before the dwell still counts as played', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  h.emit('stopped');
  await sleep(25);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].outcome, 'played');
});

test('stopping before any audio reports aborted, not failed', async () => {
  const h = harness();
  h.play(A);
  h.emit('stopped');
  await sleep(25);
  assert.deepEqual(h.events.map((e) => e.outcome), ['aborted']);
});

test('an aborted attempt carries no reason even if an error was seen', async () => {
  const h = harness();
  h.play(A);
  h.emit('error', { name: 'AbortError' });
  h.play(B);
  await sleep(25);
  assert.equal(h.events[0].outcome, 'aborted');
  assert.equal(h.events[0].reason, undefined);
});

test('a pause caused by the failure itself is not an abort', async () => {
  // Found in the live app: a dead station makes the element pause long before
  // the recovery layer gives up, and that pause used to be read as the listener
  // moving on. Radio Flouka reported "aborted" while emitting eight errors and
  // stream-dead.
  const h = harness();
  h.play(A);
  h.emit('error', { name: 'NotSupportedError' });
  h.emit('paused');
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.deepEqual(h.events.map((e) => e.outcome), ['failed']);
  assert.equal(h.events[0].reason, 'NotSupportedError');
});

test('a pause with no error in sight is still an abort', async () => {
  const h = harness();
  h.play(A);
  h.emit('paused');
  await sleep(25);
  assert.deepEqual(h.events.map((e) => e.outcome), ['aborted']);
});

test('reports the enriched attempt once, with startup and context', async () => {
  const h = harness();
  h.play(A);
  h.advance(1200);
  h.emit('playing');
  h.advance(5);
  h.emit('playing'); // must not report twice
  await sleep(25);
  assert.equal(h.reports.length, 1);
  assert.deepEqual(h.reports[0], {
    attemptId: '44444444-4444-4444-8444-444444444444',
    stationuuid: 'uuid-a',
    outcome: 'played',
    audio: true,
    phase: 'playback',
    elapsedMs: 1205,
    startupMs: 1200,
    hls: true,
    platform: 'touch',
    network: '4g',
  });
  assert.deepEqual(h.events[0], {
    n: 'stream-outcome', uuid: 'uuid-a', station: 'Station A', outcome: 'played', audio: 'yes',
  });
});

test('failed before audio omits startupMs and uses phase start', async () => {
  const h = harness();
  h.play(A);
  h.emit('error', { name: 'NotSupportedError' });
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.equal(h.reports[0].audio, false);
  assert.equal(h.reports[0].phase, 'start');
  assert.equal(h.reports[0].startupMs, undefined);
  assert.equal(h.reports[0].reason, 'NotSupportedError');
});

test('a late mid-stream failure corrects the played report, same attempt id', async () => {
  const h = harness();
  h.play(A);
  h.advance(1200);
  h.emit('playing');
  h.advance(5);
  await sleep(25);                 // Umami and telemetry both said played
  h.advance(600_000);              // ten minutes later the stream dies
  h.emit('mediaerror', { name: 'MEDIA_ERR_NETWORK' });
  h.emit('recoveryfailed', { attempts: 3 });
  await sleep(25);
  assert.equal(h.events.length, 1, 'Umami still emits exactly one played event');
  assert.equal(h.reports.length, 2);
  assert.equal(h.reports[1].attemptId, h.reports[0].attemptId);
  assert.equal(h.reports[1].outcome, 'failed');
  assert.equal(h.reports[1].audio, true);
  assert.equal(h.reports[1].phase, 'playback');
  assert.equal(h.reports[1].elapsedMs, 601205);
  assert.equal(h.reports[1].reason, 'MEDIA_ERR_NETWORK');
});

test('the internal pause from a station switch does not abort the new attempt', async () => {
  const h = harness();
  h.play(A);
  h.emit('playing');
  h.advance(5);
  await sleep(25);                 // A is played
  h.play(B);
  h.emit('paused');                // audio.pause() inside playStation()
  h.emit('playing');
  h.advance(5);
  await sleep(25);
  const b = h.reports.find((r) => r.stationuuid === 'uuid-b');
  assert.equal(b.outcome, 'played');
});

test('NotAllowedError is aborted for telemetry while Umami stays unchanged', async () => {
  const h = harness({ failAfterMs: 15 });
  h.play(A);
  h.emit('error', { name: 'NotAllowedError' });
  await sleep(5);
  assert.equal(h.reports[0].outcome, 'aborted');
  assert.equal(h.reports[0].reason, 'NotAllowedError');
  await sleep(25);
  assert.equal(h.events[0].outcome, 'failed', 'Umami keeps its pre-existing failed outcome');
  assert.equal(h.reports.length, 1, 'the later Umami decision does not overwrite the aborted report');
});

test('same-station recovery reuses the attempt id; a new station gets a new one', async () => {
  const h = harness();
  h.play(A);
  h.emit('error', { name: 'MEDIA_ERR_NETWORK' });
  h.play(A);                       // recovery replay: same attempt, no audio was heard
  h.emit('playing');
  h.advance(5);
  await sleep(25);
  assert.equal(h.reports.length, 1);
  assert.equal(h.reports[0].outcome, 'played');

  h.play(B);
  h.emit('paused');                // B follows an audible attempt: internal switch pause
  h.emit('playing');
  h.advance(5);
  await sleep(25);
  assert.equal(new Set(h.reports.map((r) => r.attemptId)).size, 2);
});

test('a throwing report callback cannot suppress Umami or the next attempt', async () => {
  const h = harness({ report: () => { throw new Error('boom'); } });
  h.play(A);
  h.emit('playing');
  await sleep(25);
  assert.equal(h.events.length, 1);
  h.play(B);
  h.emit('playing');
  await sleep(25);
  assert.equal(h.events.length, 2);
});
