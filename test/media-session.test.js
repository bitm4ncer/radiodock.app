import { test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const handlers = new Map();
const docListeners = {};

Object.defineProperty(globalThis, 'navigator', {
  value: {
    mediaSession: {
      setActionHandler(action, handler) {
        handlers.set(action, handler);
        calls.push(action);
      },
      metadata: null,
      playbackState: 'none',
    },
  },
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'document', {
  value: {
    visibilityState: 'visible',
    addEventListener(type, fn) {
      (docListeners[type] ??= []).push(fn);
    },
  },
  configurable: true,
  writable: true,
});
globalThis.MediaMetadata = class {
  constructor(data) { Object.assign(this, data); }
};

const { attachMediaSession } = await import('../src/player/media-session.js');

function makePlayer() {
  const events = new EventTarget();
  return {
    events,
    on: (type, fn) => events.addEventListener(type, fn),
    resume() {},
    pause() {},
    stop() {},
  };
}

test('media session clears seek actions and wires previous/next', () => {
  handlers.clear();
  calls.length = 0;
  const session = attachMediaSession(makePlayer());
  assert.equal(handlers.get('seekbackward'), null);
  assert.equal(handlers.get('seekforward'), null);
  assert.equal(handlers.get('seekto'), null);
  assert.equal(typeof handlers.get('previoustrack'), 'function');
  assert.equal(typeof handlers.get('nexttrack'), 'function');

  const fired = [];
  session.setNextTrack(() => fired.push('next'));
  session.setPreviousTrack(() => fired.push('prev'));
  handlers.get('nexttrack')();
  handlers.get('previoustrack')();
  assert.deepEqual(fired, ['next', 'prev']);
});

test('media session re-registers on every playing event and on return', () => {
  handlers.clear();
  calls.length = 0;
  const player = makePlayer();
  attachMediaSession(player);
  const before = calls.length;

  player.events.dispatchEvent(new Event('playing'));
  assert.ok(calls.length > before, 'playing re-registers the actions');
  assert.equal(handlers.get('seekbackward'), null, 'iOS default seek stays cleared');

  const beforeVisible = calls.length;
  docListeners.visibilitychange?.forEach((fn) => fn());
  assert.ok(calls.length > beforeVisible, 'foregrounding re-registers the actions');
});

test('station change shows the brand, not the country, until metadata arrives', () => {
  handlers.clear();
  calls.length = 0;
  const player = makePlayer();
  attachMediaSession(player);

  player.events.dispatchEvent(new CustomEvent('stationchange', {
    detail: { station: { id: 's1', name: 'Sender', countrycode: 'DE' } },
  }));
  assert.equal(navigator.mediaSession.metadata.title, 'Sender');
  assert.equal(navigator.mediaSession.metadata.artist, 'RadioDock');

  player.events.dispatchEvent(new CustomEvent('metadata', {
    detail: { nowPlaying: 'Track', artist: null, title: null },
  }));
  assert.equal(navigator.mediaSession.metadata.title, 'Track');
  assert.equal(navigator.mediaSession.metadata.artist, 'Sender');
});
