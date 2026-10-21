import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRecovery } from '../src/player/recovery.js';

function harness() {
  const listeners = {};
  const windowListeners = {};
  const timers = [];
  const audio = { addEventListener: (t, fn) => { (listeners[t] ??= []).push(fn); }, paused: true };
  const station = { id: 's1', url: 'http://s1' };
  const plays = [];
  const player = {
    _element: () => audio,
    getCurrentStation: () => station,
    events: new EventTarget(),
    on: (t, fn) => { player.events.addEventListener(t, fn); },
    playStation: () => { plays.push('playStation'); },
  };
  return {
    audio, listeners, windowListeners, timers, player, plays,
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
  h.originalSetTimeout = globalThis.setTimeout;
  h.originalClearTimeout = globalThis.clearTimeout;
  globalThis.window = { addEventListener: (t, fn) => { (h.windowListeners[t] ??= []).push(fn); } };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });
  globalThis.setTimeout = (fn) => { const id = { fn, cleared: false }; h.timers.push(id); return id; };
  globalThis.clearTimeout = (id) => { if (id) id.cleared = true; };
}

function restoreGlobals(h) {
  globalThis.window = h.originalWindow;
  if (h.navigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', h.navigatorDescriptor);
  } else {
    delete globalThis.navigator;
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
    h.fire('pause'); // the user genuinely pauses
    h.fireWindow('online'); // online recovery must not override the pause
    h.invokeTimers(); // a cleared retry must not fire
    assert.deepEqual(h.plays, []);
  } finally {
    restoreGlobals(h);
  }
});
