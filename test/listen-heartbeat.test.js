import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { attachListenHeartbeat } from '../src/analytics/listen-heartbeat.js';

// The heartbeat only stops counting an unattended background tab if its
// "continuous background minutes" budget actually accumulates. Streams rebuffer
// and the recovery module re-plays the same station after a stall, and both look
// like fresh playback from here; if either renewed the budget the cap could never
// trip and a forgotten tab would inflate listening stats forever.

function harness({ cap = 3 } = {}) {
  globalThis.document = { visibilityState: 'visible' };
  const handlers = new Map();
  const state = { station: { id: 'a', name: 'A', countrycode: 'DE' }, pings: [] };
  const player = {
    on: (type, fn) => handlers.set(type, [...(handlers.get(type) ?? []), fn]),
    isPlaying: () => true,
    getCurrentStation: () => state.station,
  };
  attachListenHeartbeat(player, {
    intervalMs: 1000,
    capBackgroundMinutes: cap,
    track: (name, data) => { if (name === 'listen-ping') state.pings.push(data); },
  });
  const emit = (type, detail) => (handlers.get(type) ?? []).forEach((fn) => fn({ detail }));
  return {
    state,
    emit,
    setBackground: (v) => { globalThis.document.visibilityState = v ? 'hidden' : 'visible'; },
    minutes: (n) => mock.timers.tick(1000 * n),
    // Play `a` in a background tab and burn the whole budget.
    exhaustBudget() {
      emit('playing');
      emit('stationchange', { station: state.station });
      this.setBackground(true);
      this.minutes(cap);
      assert.equal(state.pings.length, cap, 'budget should be spent, not more');
      this.minutes(1);
      assert.equal(state.pings.length, cap, 'and then the cap holds');
    },
  };
}

test('a rebuffer does not renew the unattended-background budget', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = harness();
    h.exhaustBudget();
    h.emit('loading'); // stall
    h.emit('playing'); // ...and back, without the timer ever stopping
    h.minutes(3);
    assert.equal(h.state.pings.length, 3, 'a rebuffer must not buy more minutes');
  } finally { mock.timers.reset(); }
});

test('recovery replaying the same station does not renew the budget', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = harness();
    h.exhaustBudget();
    // recovery calls playStation(current), which emits stationchange for the
    // station that is already playing
    h.emit('stationchange', { station: h.state.station });
    h.minutes(3);
    assert.equal(h.state.pings.length, 3, 'a stall retry must not buy more minutes');
  } finally { mock.timers.reset(); }
});

test('switching to a different station renews the budget', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = harness();
    h.exhaustBudget();
    h.state.station = { id: 'b', name: 'B', countrycode: 'GB' };
    h.emit('stationchange', { station: h.state.station });
    h.minutes(2);
    assert.equal(h.state.pings.length, 5, 'switching station is a real user action');
  } finally { mock.timers.reset(); }
});

test('foregrounding the page renews the budget', () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = harness();
    h.exhaustBudget();
    h.setBackground(false);
    h.minutes(2);
    assert.equal(h.state.pings.length, 5, 'someone is looking at it again');
  } finally { mock.timers.reset(); }
});
