// Records the live stream into an Opus/WebM blob. A dedicated,
// CORS-enabled <audio> (pointed at the relay) is routed through a Web Audio
// graph into a MediaRecorder. The MAIN player element stays CORS-free and
// keeps playing directly — this is a separate, silent capture path.

import { relayUrl } from '../data/relay.js';

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) ?? null;
}

export function isRecordingSupported() {
  return typeof MediaRecorder !== 'undefined'
    && typeof AudioContext !== 'undefined'
    && pickMime() != null;
}

export function mountRecorder({ maxDurationMs = 60 * 60 * 1000 } = {}) {
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

  let audioEl = null, ctx = null, srcNode = null, destNode = null, recorder = null;
  let chunks = [], bytes = 0, startedAt = 0, ticker = null, hardStop = null;
  let recording = false, currentStation = null;

  function tick() {
    emit('progress', { seconds: Math.floor((Date.now() - startedAt) / 1000), bytes });
  }

  function cleanup() {
    try { srcNode?.disconnect(); } catch {}
    try { destNode?.disconnect(); } catch {}
    try { audioEl?.pause(); audioEl?.removeAttribute('src'); audioEl?.load(); } catch {}
    try { ctx?.close(); } catch {}
    audioEl = ctx = srcNode = destNode = recorder = null;
  }

  async function start(station) {
    if (recording) return;
    const uuid = station?.id;
    if (!uuid) { emit('error', { message: 'Station cannot be recorded (no id).' }); return; }
    const mime = pickMime();
    if (!mime) { emit('error', { message: 'Recording is not supported in this browser.' }); return; }

    currentStation = station;
    chunks = []; bytes = 0;

    audioEl = document.createElement('audio');
    audioEl.crossOrigin = 'anonymous'; // relay sends CORS headers → graph not tainted
    audioEl.preload = 'auto';
    audioEl.src = relayUrl(uuid);
    audioEl.addEventListener('error', () => { if (recording) { emit('streamdrop', {}); stop(); } });
    audioEl.addEventListener('ended', () => { if (recording) { emit('streamdrop', {}); stop(); } });

    ctx = new AudioContext();
    try { await ctx.resume(); } catch {}
    srcNode = ctx.createMediaElementSource(audioEl);
    destNode = ctx.createMediaStreamDestination();
    srcNode.connect(destNode); // capture only — NOT to ctx.destination (no double audio)

    try {
      await audioEl.play();
    } catch (err) {
      cleanup();
      emit('error', { message: 'Could not start the recording stream.', name: err?.name });
      return;
    }

    recorder = new MediaRecorder(destNode.stream, { mimeType: mime });
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) { chunks.push(e.data); bytes += e.data.size; }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime });
      emit('stopped', { blob, mime, durationMs: Date.now() - startedAt, bytes: blob.size, station: currentStation });
      cleanup();
    };
    recorder.onerror = () => { emit('error', { message: 'Recorder error.' }); stop(); };

    startedAt = Date.now();
    recording = true;
    recorder.start(1000); // 1s timeslice → periodic size updates
    ticker = setInterval(tick, 1000);
    hardStop = setTimeout(stop, maxDurationMs);
    emit('started', { station });
    tick();
  }

  function stop() {
    if (!recording) return;
    recording = false;
    clearInterval(ticker); ticker = null;
    clearTimeout(hardStop); hardStop = null;
    try { recorder?.stop(); } catch {} // → onstop emits 'stopped'
  }

  return {
    start,
    stop,
    isRecording: () => recording,
    on: (type, handler) => { events.addEventListener(type, handler); return () => events.removeEventListener(type, handler); },
  };
}
