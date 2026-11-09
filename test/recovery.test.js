import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRecovery } from '../src/player/recovery.js';

function harness() {
  const listeners = {};
  const windowListeners = {};
  const docListeners = {};
  const timers = [];
  const audio = { addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); }, paused: true, readyState: 0 };
  const station = { id: 's1', url: 'http://s1' };
  const plays = [];
  let userPaused = false;
  const player = {
    _element: () => audio,
    getCurrentStation: () => station,
    isUserPaused: () => userPaused,
    events: new EventTarget(),
    on: (t, fn) => { player.events.addEventListener(t, fn); },
    playStation: () => { plays.push('playStation'); },
  };
  return {
    audio, listeners, windowListeners, docListeners, timers, player, plays,
    document: null,
    setUserPaused: (v) => { userPaused = v; },
    setVisibility(state) {
      this.document.visibilityState = state;
      docListeners.visibilitychange?.forEach((fn) => fn());
    },
    fire: (t) => listeners[t]?.forEach((fn) => fn()),
    fireWindow: (t) => windowListeners[t]?.forEach((fn) => fn()),
    invokeTimers: () => {
      const run = timers.splice(0);
      for (const t of run) if (!t.cleared) t.fn();
    },
  };
}

function stubGlobals(h) {
  h.originalWindow = globalThis.window;
  h.navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  h.documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  h.originalSetTimeout = globalThis.setTimeout;
  h.originalClearTimeout = globalThis.clearTimeout;
  globalThis.window = { addEventListener: (t, fn) => { (h.windowListeners[t] ??= []).push(fn); } };
  h.document = {
    visibilityState: 'visible',
    addEventListener: (t, fn) => { (h.docListeners[t] ??= []).push(fn); },
  };
  Object.defineProperty(globalThis, 'document', { value: h.document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  globalThis.setTimeout = (fn, ms) => { const id = { fn, ms, cleared: false }; h.timers.push(id); return id; };
  globalThis.clearTimeout = (id) => { if (id) id.cleared = true; };
}

function restoreGlobals(h) {
  globalThis.window = h.originalWindow;
  if (h.navigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', h.navigatorDescriptor);
  } else {
    delete globalThis.navigator;
  }
  if (h.documentDescriptor) {
    Object.defineProperty(globalThis, 'document', h.documentDescriptor);
  } else {
    delete globalThis.document;
  }
  globalThis.setTimeout = h.originalSetTimeout;
  globalThis.clearTimeout = h.originalClearTimeout;
}

test('error then pause does not call playStation', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.fire('error');        // schedules a retry
    h.setUserPaused(true);
    h.fire('pause');        // user pauses
    h.fireWindow('online'); // online recovery must not override the pause
    h.invokeTimers();       // a cleared retry must not fire
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});

test('an escalation in flight is not raced by a recovery retry', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.player.isEscalating = () => true;
    h.fire('error');
    h.invokeTimers();
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});

test('an internal loading pause does not cancel a real retry', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.fire('error'); // schedules a retry
    h.audio.paused = false; // the stream was playing when the switch paused it
    h.player.events.dispatchEvent(new CustomEvent('stationchange', { detail: { station: { id: 's1' } } }));
    h.fire('pause'); // internal pause from playStation's own audio.pause()
    assert.equal(h.plays.length, 0, 'no playStation before the retry timer fires');
    h.invokeTimers();
    assert.equal(h.plays.length, 1, 'the retry fires after the internal pause');
  } finally {
    restoreGlobals(h);
  }
});

test('a cold-start pause is a user pause, not an internal one', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    // Cold start: the element is still paused, so playStation's audio.pause()
    // is a no-op and no pause event fires. The stale "internal pause expected"
    // flag must not swallow the user's later pause.
    h.player.events.dispatchEvent(new CustomEvent('stationchange', { detail: { station: { id: 's1' } } }));
    h.fire('error'); // the stream fails before playing; schedules a retry
    h.setUserPaused(true);
    h.fire('pause'); // the user genuinely pauses
    h.fireWindow('online'); // online recovery must not override the pause
    h.invokeTimers(); // a cleared retry must not fire
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});

test('a failed relay escalation still schedules a retry after the grace', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    let checks = 0;
    h.player.isEscalating = () => checks++ === 0; // grace active only on the first check
    h.fire('error');     // schedules the post-escalation retry
    h.invokeTimers();    // grace timer -> normal recovery attempt
    h.invokeTimers();    // recovery delay -> playStation
    assert.equal(h.plays.length, 1, 'playback is retried after the relay handoff window');
  } finally {
    restoreGlobals(h);
  }
});

test('an HLS fatal player error schedules recovery', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.player.events.dispatchEvent(new CustomEvent('error', { detail: { name: 'HlsFatalError', message: 'no manifest' } }));
    h.invokeTimers();
    assert.equal(h.plays.length, 1, 'hls.js fatals never reach the audio element, so recovery must listen here');
  } finally {
    restoreGlobals(h);
  }
});

test('duplicate failure signals consume only one attempt', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.fire('error');
    h.player.events.dispatchEvent(new CustomEvent('error', { detail: { name: 'HlsFatalError' } }));
    h.invokeTimers();
    assert.equal(h.plays.length, 1, 'the second signal must not schedule a second retry');
  } finally {
    restoreGlobals(h);
  }
});

test('an autoplay rejection is not treated as a stream failure', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.player.events.dispatchEvent(new CustomEvent('error', { detail: { name: 'NotAllowedError' } }));
    h.invokeTimers();
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});

test('replaying the same station after stop gets a fresh attempt budget', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    // Exhaust the budget without running the retry timers.
    h.fire('error');
    h.fire('error');
    h.fire('error');
    h.fire('error'); // gives up
    h.player.events.dispatchEvent(new CustomEvent('stopped'));
    h.fire('error');
    h.invokeTimers();
    assert.equal(h.plays.length, 1, 'the replay is not stuck in gave-up state');
  } finally {
    restoreGlobals(h);
  }
});

test('a background pause is not user intent and foregrounding reconnects', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.setUserPaused(false);
    h.setVisibility('hidden');
    h.fire('pause'); // OS/background pause, no user intent
    h.setVisibility('visible');
    assert.equal(h.plays.length, 1, 'foregrounding reconnects to the live edge');
  } finally {
    restoreGlobals(h);
  }
});

test('an explicit pause survives foregrounding', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.setUserPaused(true);
    h.setVisibility('hidden');
    h.fire('pause'); // lock-screen/user pause while backgrounded
    h.setVisibility('visible');
    assert.equal(h.plays.length, 0, 'the app must not override a real pause');
  } finally {
    restoreGlobals(h);
  }
});

test('a healthy background stream is not interrupted on return', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.setUserPaused(false);
    h.audio.paused = false;
    h.audio.readyState = 4;
    h.setVisibility('visible');
    assert.equal(h.plays.length, 0, 'a still-playing stream keeps its buffer');
  } finally {
    restoreGlobals(h);
  }
});

test('pageshow also reconnects after a background pause', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    h.setUserPaused(false);
    h.setVisibility('hidden');
    h.fire('pause');
    h.document.visibilityState = 'visible';
    h.fireWindow('pageshow');
    assert.equal(h.plays.length, 1);
  } finally {
    restoreGlobals(h);
  }
});

test('after giving up, a slow retry keeps checking without a user tap', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    let failed = 0;
    h.player.events.addEventListener('recoveryfailed', () => { failed += 1; });
    for (let i = 0; i < 3; i += 1) {
      h.fire('error');
      h.invokeTimers(); // let each scheduled retry fire before the next failure
    }
    h.fire('error'); // budget exhausted -> recoveryfailed + slow retry
    assert.equal(failed, 1, 'recoveryfailed is emitted once per outage');
    const slow = h.timers.find((t) => t.ms === 30000);
    assert.ok(slow, 'a slow retry is armed after the fast budget');
    h.plays.length = 0;
    slow.fn();
    assert.deepEqual(h.plays, ['playStation'], 'the slow retry reconnects automatically');
  } finally {
    restoreGlobals(h);
  }
});

test('an explicit pause cancels the slow retry', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    for (let i = 0; i < 3; i += 1) {
      h.fire('error');
      h.invokeTimers();
    }
    h.fire('error');
    const slow = h.timers.find((t) => t.ms === 30000);
    assert.ok(slow, 'slow retry armed');
    h.setUserPaused(true);
    h.fire('pause');
    assert.equal(slow.cleared, true, 'a real pause must stop the background retry');
    h.plays.length = 0;
    if (!slow.cleared) slow.fn();
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});

test('a successful playing resets the slow-retry state', () => {
  const h = harness();
  stubGlobals(h);
  try {
    attachRecovery(h.player);
    for (let i = 0; i < 3; i += 1) {
      h.fire('error');
      h.invokeTimers();
    }
    h.fire('error');
    const slow = h.timers.find((t) => t.ms === 30000);
    h.fire('playing');
    assert.equal(slow.cleared, true, 'recovery is fully reset after audio flows');
  } finally {
    restoreGlobals(h);
  }
});
