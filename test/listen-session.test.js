import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { attachListenSession, isOptedOut } from '../src/analytics/listen-session.js';

class MapStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const STATION_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha', countrycode: 'DE' };
const STATION_B = { id: '22222222-2222-4222-8222-222222222222', name: 'Beta', countrycode: 'GB' };

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup({ isDev = false, storage = new MapStorage(), optOut = false } = {}) {
  if (optOut) storage.setItem('rd_analytics_opt_out', '1');
  const win = new EventTarget();
  const doc = { visibilityState: 'visible' };
  const handlers = new Map();
  const sent = [];
  const beacons = [];
  const state = { station: STATION_A, playing: true };
  let clock = Date.parse('2026-10-18T10:00:00.000Z');
  let sequence = 0;

  const player = {
    on(type, fn) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
    isPlaying: () => state.playing,
    getCurrentStation: () => state.station,
  };
  const fetchImpl = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return { ok: true };
  };
  const beacon = (url, blob) => {
    beacons.push({ url, blob });
    return true;
  };
  const session = attachListenSession(player, {
    endpoint: 'https://stations.test/api/listen',
    fetchImpl,
    storage,
    now: () => clock,
    randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    isDev,
    beacon,
    windowImpl: win,
    documentImpl: doc,
  });

  return {
    player,
    state,
    win,
    doc,
    sent,
    beacons,
    storage,
    session,
    emit(type, detail) { (handlers.get(type) ?? []).forEach((fn) => fn({ detail })); },
    dispatchPlay(station = STATION_A) {
      win.dispatchEvent(new CustomEvent('rd:station-play', { detail: { station, source: 'test' } }));
    },
    advance(ms) { clock += ms; },
  };
}

test('isOptedOut respects both storage keys and Do Not Track', () => {
  const storage = new MapStorage();
  assert.equal(isOptedOut(storage, {}), false);
  storage.setItem('umami.disabled', '1');
  assert.equal(isOptedOut(storage, {}), true);
  storage.removeItem('umami.disabled');
  storage.setItem('rd_analytics_opt_out', '1');
  assert.equal(isOptedOut(storage, {}), true);
  assert.equal(isOptedOut(new MapStorage(), { doNotTrack: '1' }), true);
  assert.equal(isOptedOut(new MapStorage(), { doNotTrack: 'yes' }), true);
});

test('does not send when dev or opted out', async () => {
  const dev = setup({ isDev: true });
  dev.dispatchPlay();
  await flush();
  assert.equal(dev.sent.length, 0);

  const optedOut = setup({ optOut: true });
  optedOut.dispatchPlay();
  await flush();
  assert.equal(optedOut.sent.length, 0);
});

test('starts one session and sends cumulative updates', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = setup();
    h.dispatchPlay();
    await flush();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].url, 'https://stations.test/api/listen/session');
    assert.equal(h.sent[0].body.stationuuid, STATION_A.id);
    assert.equal(h.sent[0].body.source, 'test');
    assert.equal(h.sent[0].body.listenerId, h.storage.getItem('rd_listener_id'));

    h.emit('playing');
    h.advance(60_000);
    mock.timers.tick(60_000);
    await flush();

    assert.equal(h.sent.length, 2);
    assert.match(h.sent[1].url, /\/session\/00000000-0000-4000-8000-000000000002$/);
    assert.equal(h.sent[1].body.foregroundMinutes, 1);
    assert.equal(h.sent[1].body.backgroundMinutes, 0);
    assert.equal(h.sent[1].body.plays, 1);
    assert.equal(h.sent[1].body.ended, false);
  } finally {
    mock.timers.reset();
  }
});

test('ends the session on pause and pagehide', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const h = setup();
    h.dispatchPlay();
    await flush();
    h.emit('playing');
    h.advance(60_000);
    mock.timers.tick(60_000);
    await flush();

    h.emit('paused');
    await flush();
    const paused = h.sent.at(-1);
    assert.equal(paused.body.ended, true);
    assert.equal(paused.body.endReason, 'pause');

    h.dispatchPlay(STATION_B);
    await flush();
    h.win.dispatchEvent(new Event('pagehide'));
    await flush();
    assert.equal(h.beacons.length, 1);
    assert.equal(h.beacons[0].url, 'https://stations.test/api/listen/session/00000000-0000-4000-8000-000000000003');
    assert.equal(h.beacons[0].blob.type, 'text/plain');
    const body = JSON.parse(await h.beacons[0].blob.text());
    assert.equal(body.ended, true);
    assert.equal(body.endReason, 'pagehide');
  } finally {
    mock.timers.reset();
  }
});

test('a new play ends the previous session and keeps the listener id', async () => {
  const h = setup();
  h.dispatchPlay(STATION_A);
  await flush();
  const listenerId = h.storage.getItem('rd_listener_id');
  assert.ok(listenerId);

  h.dispatchPlay(STATION_B);
  await flush();

  assert.equal(h.sent.length, 3);
  assert.equal(h.sent[1].body.ended, true);
  assert.equal(h.sent[1].body.endReason, 'stationchange');
  assert.equal(h.sent[2].body.stationuuid, STATION_B.id);
  assert.equal(h.sent[2].body.listenerId, listenerId);
  assert.equal(h.storage.getItem('rd_listener_id'), listenerId);
});
