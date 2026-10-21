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
