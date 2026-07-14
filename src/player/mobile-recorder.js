// Server-backed recorder for mobile (iOS can't capture client-side). Drives the
// Stations /api/record endpoints and persists an in-flight handle so a
// background recording survives app restarts and can be finished on return.
// Presents the SAME interface + events as player/recorder.js so notes-panel is
// unchanged.

import { startRecording, stopRecording, fetchRecording, RecordingExpiredError } from '../data/record-client.js';
import { getPref, setPref } from '../data/storage.js';

const PREF_PENDING = 'pendingRecording';

export function mountMobileRecorder() {
  const events = new EventTarget();
  const emit = (type, detail) => events.dispatchEvent(new CustomEvent(type, { detail }));

  let handle = null;      // { id, mime, uuid, station, startedAt }
  let recording = false;
  let ticker = null;
  let fetching = false;

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (!handle) return;
      emit('progress', { seconds: Math.floor((Date.now() - handle.startedAt) / 1000), bytes: null });
    }, 1000);
  }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  // Restore a persisted in-flight recording on mount.
  (async () => {
    const saved = await getPref(PREF_PENDING, null);
    if (saved?.id) {
      handle = saved;
      recording = true;
      startTicker();
      emit('resumed', { station: saved.station });
    }
  })();

  async function start(station) {
    if (recording || fetching) return;
    const uuid = station?.id;
    if (!uuid) { emit('error', { message: 'Station cannot be recorded (no id).' }); return; }
    try {
      const { id, mime } = await startRecording(uuid);
      handle = { id, mime, uuid, station, startedAt: Date.now() };
      await setPref(PREF_PENDING, handle);
      recording = true;
      startTicker();
      emit('started', { station });
      emit('progress', { seconds: 0, bytes: null });
    } catch (err) {
      emit('error', { message: 'Recording could not start.', name: err?.name });
    }
  }

  async function finalizeAndFetch() {
    if (!handle) return;
    const h = handle;
    stopTicker();
    recording = false;
    fetching = true;
    emit('fetching', {});
    try {
      const stopped = await stopRecording(h.id);
      if (!stopped.bytes) {
        await clearHandle();
        emit('error', { message: 'Recording was empty.' });
        return;
      }
      const blob = await fetchRecording(h.id);
      await clearHandle();
      emit('stopped', {
        blob, mime: h.mime || blob.type, bytes: blob.size,
        durationMs: stopped.durationMs || (Date.now() - h.startedAt),
        station: h.station,
      });
    } catch (err) {
      if (err instanceof RecordingExpiredError) {
        await clearHandle();
        emit('error', { message: 'Recording expired before it could be saved.' });
      } else {
        // keep the handle so the user can retry (server keeps the file within grace)
        recording = true;
        emit('error', { message: 'Could not save the recording — try again.' });
      }
    } finally {
      fetching = false;
    }
  }

  async function clearHandle() { handle = null; await setPref(PREF_PENDING, null); }

  function stop() {
    if (!recording && !handle) return;
    finalizeAndFetch();
  }

  return {
    start,
    stop,
    isRecording: () => recording,
    hasPending: () => !!handle,
    on: (type, h2) => { events.addEventListener(type, h2); return () => events.removeEventListener(type, h2); },
  };
}
