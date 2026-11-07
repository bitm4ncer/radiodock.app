import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountRecorder } from '../src/player/recorder.js';
import { mountMobileRecorder } from '../src/player/mobile-recorder.js';

test('repeated rapid starts create exactly one server recording', async () => {
  const original = globalThis.fetch;
  let startCalls = 0;
  let resolveStart;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/record/start')) {
      startCalls++;
      return new Promise((res) => { resolveStart = () => res({ ok: true, status: 200, json: async () => ({ id: 'r1', mime: 'audio/mpeg' }) }); });
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const rec = mountMobileRecorder();
    const p1 = rec.start({ id: 's1' });
    const p2 = rec.start({ id: 's2' }); // before the first resolves
    resolveStart();
    await Promise.all([p1, p2]);
    assert.equal(startCalls, 1, 'exactly one /api/record/start');
    assert.equal(rec.isRecording(), true);
    rec.stop(); // clear the progress interval
  } finally {
    globalThis.fetch = original;
  }
});

test('repeated rapid starts create exactly one AudioContext', async () => {
  let audioContextCount = 0;
  let mediaRecorderCount = 0;
  let resolvePlay;
  let markPlayStarted;
  const playStarted = new Promise((res) => { markPlayStarted = res; });

  const fakeAudio = {
    crossOrigin: '',
    preload: '',
    src: '',
    addEventListener() {},
    removeAttribute() {},
    load() {},
    pause() {},
    play: () => {
      markPlayStarted();
      return new Promise((res) => { resolvePlay = () => res(); });
    },
  };

  const originalDocument = globalThis.document;
  const originalAudioContext = globalThis.AudioContext;
  const originalMediaRecorder = globalThis.MediaRecorder;

  globalThis.document = { createElement: (tag) => (tag === 'audio' ? fakeAudio : {}) };
  globalThis.AudioContext = class {
    constructor() { audioContextCount++; }
    resume() { return Promise.resolve(); }
    createMediaElementSource() { return { connect() {}, disconnect() {} }; }
    createMediaStreamDestination() { return { stream: {} }; }
    close() {}
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor() { mediaRecorderCount++; }
    start() {}
    stop() {}
  };

  try {
    const rec = mountRecorder();
    const p1 = rec.start({ id: 's1' });
    const p2 = rec.start({ id: 's2' }); // before the first resolves
    assert.equal(rec.isRecording(), true, 'starting counts as recording');
    await playStarted; // the first start has reached audioEl.play()
    resolvePlay();
    await Promise.all([p1, p2]);
    assert.equal(audioContextCount, 1);
    assert.equal(mediaRecorderCount, 1);
    rec.stop(); // clear the tick + hard-stop timers
  } finally {
    globalThis.document = originalDocument;
    globalThis.AudioContext = originalAudioContext;
    globalThis.MediaRecorder = originalMediaRecorder;
  }
});

test('a second stop tap during save is ignored (no duplicate fetch)', async () => {
  const original = globalThis.fetch;
  let stopCalls = 0;
  let fetchCalls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/record/start')) {
      return new Response(JSON.stringify({ id: 'r1', mime: 'audio/mpeg' }), { status: 200 });
    }
    if (u.endsWith('/api/record/stop')) {
      stopCalls += 1;
      return new Response(JSON.stringify({ id: 'r1', bytes: 10, durationMs: 1000, error: null }), { status: 200 });
    }
    if (u.includes('/api/record/fetch')) {
      fetchCalls += 1;
      return new Response(new Blob(['audio'], { type: 'audio/mpeg' }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    const rec = mountMobileRecorder();
    await rec.start({ id: 's1' });
    rec.stop();
    rec.stop(); // must not start a second finalize while the first is fetching
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stopCalls, 1, 'one /api/record/stop');
    assert.equal(fetchCalls, 1, 'one /api/record/fetch');
  } finally {
    globalThis.fetch = original;
  }
});

test('server HLS rejection is surfaced instead of a generic failure', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'hls-unsupported' }), { status: 422 });
  try {
    const rec = mountMobileRecorder();
    let message = '';
    rec.on('error', (e) => { message = e.detail?.message ?? ''; });
    await rec.start({ id: 's1' });
    assert.match(message, /HLS/);
    assert.equal(rec.isRecording(), false);
  } finally {
    globalThis.fetch = original;
  }
});
