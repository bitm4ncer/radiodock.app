import assert from 'node:assert/strict';
import test from 'node:test';
import { player } from '../src/player/audio.js';

const UUID = '44444444-4444-4444-8444-444444444444';

function makeAudioStub() {
  const listeners = {};
  return {
    id: '',
    preload: 'none',
    playsInline: true,
    volume: 0.8,
    paused: true,
    _attr: null,
    _src: '',
    style: {},
    get src() { return this._src; },
    set src(value) { this._src = value; this._attr = value; },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    setAttribute(name, value) { if (name === 'src') this.src = value; },
    getAttribute(name) { return name === 'src' ? this._attr : null; },
    removeAttribute(name) { if (name === 'src') { this._src = ''; this._attr = null; } },
    pause() {
      const wasPlaying = !this.paused;
      this.paused = true;
      if (wasPlaying) listeners.pause?.forEach((fn) => fn());
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    load() {},
    canPlayType() { return ''; },
    fire(type) { listeners[type]?.forEach((fn) => fn()); },
    listeners,
  };
}

// audio.js expects a browser document and a secure context. The element is a
// module singleton, so one stub serves every test in this file.
globalThis.window = { isSecureContext: true };
globalThis.document = {
  createElement: () => makeAudioStub(),
  body: { append() {} },
  documentElement: { append() {} },
};

test('a station switch is announced before any await', async () => {
  player.stop();
  const seen = [];
  const off = player.on('stationchange', (evt) => seen.push(evt.detail.station.id));
  const pending = player.playStation({ id: UUID, url: 'https://stream.example/live.mp3' });
  assert.deepEqual(seen, [UUID], 'the UI and media session must update on the tap, not after I/O');
  await pending;
  off();
  player.stop();
});

test('pausing cancels an in-flight station load', async () => {
  player.stop();
  const station = { id: UUID, url: 'https://stream.example/live.mp3' };
  const main = player._element();
  const pending = player.playStation(station);
  player.pause();
  assert.equal(main.paused, true, 'pause applies immediately');
  await pending;
  assert.equal(main.paused, true, 'the superseded load must not start audio after the pause');
  assert.notEqual(main.getAttribute('src'), station.url, 'no src is assigned by the cancelled load');
  player.stop();
});
