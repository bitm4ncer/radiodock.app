# Tape Recording in Notes — PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the live radio stream into a note as a small tape-player card, captured client-side via the Stations VPS relay, with limits, download-then-delete, and a desktop cable flourish.

**Architecture:** A dedicated `<audio crossorigin="anonymous">` element pointed at `stations.radiodock.app/api/relay?uuid=` feeds a Web Audio graph (`MediaElementSource → MediaStreamDestination → MediaRecorder`) that encodes Opus/WebM client-side. The blob lands in a new IndexedDB `recordings` store; a `type:'recording'` note renders as a cassette card in the notes feed. The main player element stays untouched (CORS-free, direct).

**Tech Stack:** Vanilla JS, Vite 5, IndexedDB, Web Audio + MediaRecorder. No new deps. Verification via Claude Preview MCP (project has no unit-test framework).

**Prerequisite:** The relay endpoint (`RadioDock-Stations` plan `2026-07-14-tape-recording-relay.md`) must be **deployed and live** before Task 3+ can be verified.

## Global Constraints

- Mobile-first CSS; column max 480px; dark `#1a1a1a`. Reuse existing notes classnames (`notes-panel__*`, `notes-card`, `notes-card__*`) verbatim; don't invent BEM variants.
- **`crossorigin` is forbidden on the MAIN `<audio>`** — the recorder uses a **separate** element; the main player element (`src/player/audio.js`) is never touched.
- IndexedDB writes go through `data/storage.js` / `data/notes.js`; UI modules never touch IDB directly.
- UI modules expose `mount…()` returning callbacks; `main.js` is the only place wiring UI ↔ data.
- Default to no code comments; comment only non-obvious WHY.
- Add Claude Preview MCP behavioural verification after every observable change.
- Relay base URL: `https://stations.radiodock.app`. Recording requires the live VPS (no local relay in dev unless the Stations server runs locally).
- Limits: **max 60 min/recording**, **500 MB total budget** (warn 80%, block 100%).

---

### Task 1: `recordings` IndexedDB store + helpers

**Files:**
- Modify: `src/data/storage.js`

**Interfaces:**
- Produces: `putRecordingAudio(id, blob)`, `getRecordingAudio(id) → Blob|undefined`, `deleteRecordingAudio(id)`, `sumRecordingBytes() → number`. Consumed by `data/notes.js` (Task 2) and `ui/notes-panel.js` (Tasks 5-6).

- [ ] **Step 1: Bump the schema version and add the store**

In `src/data/storage.js`, change `const DB_VERSION = 3;` to `4`, extend the history comment, and add to the `onupgradeneeded` handler (after the `notes` store block):

```js
      // v4 — recording blobs for the tape-recording feature. Kept in a
      // separate store so listing notes never loads audio blobs.
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
```

Update the comment block above `DB_VERSION`:

```js
//   v4 — adds `recordings` store (audio blobs for tape recording).
```

- [ ] **Step 2: Add the helper functions**

Append to `src/data/storage.js` (after the Notes section):

```js
// --- Recordings (audio Blob storage) ---

export async function putRecordingAudio(id, blob) {
  return safeWrite('recordings', (store) => promisify(store.put({ id, blob, bytes: blob.size })));
}

export async function getRecordingAudio(id) {
  const row = await safeRead('recordings', (store) => promisify(store.get(id)), undefined);
  return row?.blob;
}

export async function deleteRecordingAudio(id) {
  return safeWrite('recordings', (store) => promisify(store.delete(id)));
}

export async function sumRecordingBytes() {
  const rows = await safeRead('recordings', (store) => promisify(store.getAll()), []);
  return (rows ?? []).reduce((n, r) => n + (r.bytes ?? 0), 0);
}
```

- [ ] **Step 3: Verify the migration in the browser (Preview MCP)**

Start the dev server (Task 4 sets up the worktree server), then:
- `preview_eval`: `indexedDB.databases().then(d => d)` — confirm `radiodock` at version 4.
- `preview_eval`:
```js
(async () => {
  const { putRecordingAudio, getRecordingAudio, sumRecordingBytes } = await import('/src/data/storage.js');
  await putRecordingAudio('t1', new Blob([new Uint8Array(1000)]));
  const b = await getRecordingAudio('t1');
  const total = await sumRecordingBytes();
  return { size: b?.size, total };
})()
```
Expected: `{ size: 1000, total: 1000 }`. Then clean up: `preview_eval` deleting `t1` via `deleteRecordingAudio`.

- [ ] **Step 4: Commit**

```bash
git add src/data/storage.js
git commit -m "feat(storage): recordings blob store (IDB v4)"
```

---

### Task 2: Relay URL helper + notes facade for recordings

**Files:**
- Create: `src/data/relay.js`
- Modify: `src/data/notes.js`

**Interfaces:**
- Consumes: storage helpers from Task 1; `sanitizeStationSnapshot`/`sanitizeTrackSnapshot` (already in `notes.js`).
- Produces: `relayUrl(uuid) → string` (from `relay.js`); `notes.createRecording({ pageId, station, track, blob, mime, durationMs, bytes }) → note`; `notes.getRecordingBlob(id) → Blob|undefined`. `notes.deleteNote` now cascades to delete audio.

- [ ] **Step 1: Create the relay URL helper**

```js
// src/data/relay.js
// Builds the recording-relay URL on the Stations VPS. UUID-only — the server
// resolves the stream URL from its own DB (SSRF-safe). Recording requires the
// live VPS; there is no local relay unless the Stations server runs locally.
const RELAY_BASE = 'https://stations.radiodock.app';

export function relayUrl(uuid) {
  return `${RELAY_BASE}/api/relay?uuid=${encodeURIComponent(uuid)}`;
}
```

- [ ] **Step 2: Add `createRecording` + `getRecordingBlob` and cascade delete in `notes.js`**

Add the storage import at the top of `src/data/notes.js` (it already imports `* as storage`). Add after `createCapture`:

```js
export async function createRecording({ pageId, station = null, track = null, blob, mime, durationMs = 0, bytes = 0 } = {}) {
  if (!pageId) throw new Error('pageId is required.');
  if (!blob) throw new Error('recording blob is required.');
  const note = {
    id: genNoteId(),
    pageId,
    type: 'recording',
    body: '',
    station: station ? sanitizeStationSnapshot(station) : null,
    track: track ? sanitizeTrackSnapshot(track) : null,
    mime: mime ?? blob.type ?? 'audio/webm',
    durationMs,
    bytes: bytes || blob.size,
    createdAt: now(),
  };
  await storage.putRecordingAudio(note.id, blob);
  await storage.putNote(note);
  return note;
}

export async function getRecordingBlob(id) {
  return storage.getRecordingAudio(id);
}
```

Change `deleteNote` to cascade audio deletion:

```js
export async function deleteNote(id) {
  await storage.deleteRecordingAudio(id); // no-op for non-recordings
  await storage.deleteNote(id);
}
```

- [ ] **Step 3: Verify (Preview MCP)**

`preview_eval`:
```js
(async () => {
  const notes = await import('/src/data/notes.js');
  const n = await notes.createRecording({ pageId: 'journal', blob: new Blob([new Uint8Array(2048)], { type: 'audio/webm' }), mime: 'audio/webm', durationMs: 5000 });
  const b = await notes.getRecordingBlob(n.id);
  const size = b?.size;
  await notes.deleteNote(n.id);
  const gone = await notes.getRecordingBlob(n.id);
  return { type: n.type, size, goneIsUndefined: gone === undefined };
})()
```
Expected: `{ type: 'recording', size: 2048, goneIsUndefined: true }`.

- [ ] **Step 4: Commit**

```bash
git add src/data/relay.js src/data/notes.js
git commit -m "feat(notes): createRecording + relay url + cascade audio delete"
```

---

### Task 3: Recorder pipeline module

**Files:**
- Create: `src/player/recorder.js`

**Interfaces:**
- Consumes: `relayUrl(uuid)` from Task 2. `station.id` is the Radio-Browser UUID (`radio-browser.js#normaliseStation`).
- Produces: `isRecordingSupported() → boolean`; `mountRecorder({ maxDurationMs }) → { start(station), stop(), isRecording(), on(type, handler) }`. Events: `started {station}`, `progress {seconds, bytes}`, `streamdrop {}`, `stopped {blob, mime, durationMs, bytes, station}`, `error {message, name?}`.

- [ ] **Step 1: Write the recorder module**

```js
// src/player/recorder.js
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
```

- [ ] **Step 2: Verify capture support + a real short recording (Preview MCP, live relay required)**

`preview_eval` support check:
```js
import('/src/player/recorder.js').then(m => m.isRecordingSupported())
```
Expected: `true` in Chromium.

Then a live 3-second capture against a real station UUID (replace `<uuid>` with a station present in the Stations DB):
```js
(async () => {
  const { mountRecorder } = await import('/src/player/recorder.js');
  const rec = mountRecorder();
  const done = new Promise((res) => rec.on('stopped', (e) => res(e.detail)));
  rec.on('error', (e) => console.warn('rec error', e.detail));
  rec.start({ id: '<uuid>', name: 'Test' });
  setTimeout(() => rec.stop(), 3000);
  const d = await done;
  return { mime: d.mime, bytes: d.bytes, ms: d.durationMs };
})()
```
Expected: `bytes > 0`, `mime` starting `audio/webm` (or `audio/mp4` on Safari), `ms ≈ 3000`. A `bytes === 0` result means the relay isn't sending CORS/audio correctly — stop and fix the relay before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/player/recorder.js
git commit -m "feat(player): MediaRecorder→Opus recorder pipeline via relay"
```

---

### Task 4: Wire recorder + cable into main.js; pass recorder to notes panel

**Files:**
- Modify: `src/main.js`
- Modify: `src/ui/notes-panel.js` (mount signature only)

**Interfaces:**
- Consumes: `mountRecorder`, `isRecordingSupported` (Task 3); `mountRecordingCable` (Task 7 — import added here, module created there).
- Produces: `recorder` instance passed to `mountNotesPanel`.

- [ ] **Step 1: Import the new modules in main.js**

Near the other UI imports in `src/main.js` (around line 33):

```js
import { mountRecorder, isRecordingSupported } from './player/recorder.js';
import { mountRecordingCable } from './ui/recording-cable.js';
```

- [ ] **Step 2: Create recorder + cable and wire them, then pass recorder into the panel**

Replace the notes-panel mount block (`src/main.js:326-333`) with:

```js
// Notes panel — created async because mountNotesPanel touches IndexedDB
// (`getAllPages` lazy-creates Journal). The notes API is exposed via a
// closure variable so the hamburger entry below can lazily reach it.
let notesApi = null;

// Recorder + desktop cable flourish. The cable follows both windows while
// recording; recorder events drive it from here so it works regardless of
// which surface started the recording.
const recorder = isRecordingSupported() ? mountRecorder({ maxDurationMs: 60 * 60 * 1000 }) : null;
const recordingCable = mountRecordingCable();
if (recorder) {
  recorder.on('started', () => recordingCable.show());
  recorder.on('stopped', () => recordingCable.hide());
  recorder.on('streamdrop', () => recordingCable.hide());
  recorder.on('error', () => recordingCable.hide());
}

mountNotesPanel({ player, getLatestMetadata: () => latestMetadata, recorder })
  .then((api) => { notesApi = api; })
  .catch((err) => console.warn('Notes panel mount failed:', err));
```

- [ ] **Step 3: Accept `recorder` in the panel mount signature**

In `src/ui/notes-panel.js`, change the mount signature (line 35):

```js
export async function mountNotesPanel({ player, getLatestMetadata, recorder = null }) {
```

- [ ] **Step 4: Verify no boot regression (Preview MCP)**

- `preview_logs` / `preview_console_logs` (level error): no new errors on load.
- `preview_eval`: `!!document.querySelector('.notes-panel')` → `true`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/ui/notes-panel.js
git commit -m "feat: wire recorder + recording cable into app shell"
```

---

### Task 5: Rec button in the notes panel

**Files:**
- Modify: `src/ui/notes-panel.js`
- Modify: `src/styles/notes.css` (or the stylesheet that defines `.notes-panel__capture-btn` — locate with grep)

**Interfaces:**
- Consumes: `recorder` (Task 4), `storage.sumRecordingBytes` (Task 1).
- Produces: a `record` panel action; `refreshRecordBtnState()`; budget gate constants `MAX_RECORDING_BYTES`.

- [ ] **Step 1: Inject the Rec button left of Save Moment**

In `buildPanel`'s template (`src/ui/notes-panel.js`), replace the capture button block so a round Rec button precedes it, wrapped in a row:

```js
      <div class="notes-panel__capture-row">
        <button type="button" class="notes-panel__record-btn" data-action="record" aria-label="Record stream" title="Record">
          <span class="notes-panel__record-dot" aria-hidden="true"></span>
          <span class="notes-panel__record-time" data-role="record-time" hidden></span>
        </button>
        <button type="button" class="notes-panel__capture-btn" data-action="capture" aria-label="Save moment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 4h14a2 2 0 0 1 2 2v12l-4-3-4 3-4-3-4 3V6a2 2 0 0 1 2-2z"/>
          </svg>
          <span class="notes-panel__capture-label">Save Moment</span>
        </button>
      </div>
```

- [ ] **Step 2: Add the budget constant + record state helpers**

Near the top of `mountNotesPanel` (after `const state = {...}`), add imports at the file top:

```js
import { sumRecordingBytes } from '../data/storage.js';
```

Add constants at module top (near `PREF_*`):

```js
const MAX_RECORDING_BYTES = 500 * 1024 * 1024; // 500 MB total budget
```

Add these functions inside `mountNotesPanel` (near `refreshCaptureBtnState`):

```js
  async function refreshRecordBtnState() {
    const btn = panel.querySelector('[data-action="record"]');
    if (!btn) return;
    const station = getStation();
    const rec = recorder?.isRecording?.() ?? false;
    const overBudget = (await sumRecordingBytes()) >= MAX_RECORDING_BYTES;
    btn.classList.toggle('is-recording', rec);
    btn.disabled = !recorder || (!rec && (!station || overBudget));
    btn.title = rec ? 'Stop recording'
      : !recorder ? 'Recording not supported'
      : overBudget ? 'Recording storage full (500 MB)'
      : !station ? 'No station playing'
      : `Record ${station.name}`;
  }

  function updateRecordTime({ seconds, bytes }) {
    const el = panel.querySelector('[data-role="record-time"]');
    if (!el) return;
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    el.hidden = false;
    el.textContent = `${mm}:${ss} · ${mb} MB`;
  }
```

- [ ] **Step 3: Add the `record` action + subscribe to recorder events**

In `onPanelClick`'s `switch`, add:

```js
      case 'record':          return toggleRecord();
```

Add the handler (inside `mountNotesPanel`):

```js
  async function toggleRecord() {
    if (!recorder) { toast('Recording is not supported in this browser.'); return; }
    if (recorder.isRecording()) { recorder.stop(); return; }
    const station = getStation();
    if (!station) { toast('No station playing.'); return; }
    if ((await sumRecordingBytes()) >= MAX_RECORDING_BYTES) {
      toast('Recording storage is full (500 MB). Delete some recordings first.');
      return;
    }
    recorder.start(station);
    track('recording-started', { country: station.countrycode ?? '' });
  }
```

Wire recorder subscriptions once, after the `player.on(...)` subscriptions near mount:

```js
  if (recorder) {
    recorder.on('started', () => refreshRecordBtnState());
    recorder.on('progress', (e) => updateRecordTime(e.detail));
    recorder.on('streamdrop', () => toast('Stream dropped — saved what was recorded.'));
    recorder.on('error', (e) => { toast(e.detail?.message ?? 'Recording failed.'); refreshRecordBtnState(); });
    recorder.on('stopped', (e) => onRecordingStopped(e.detail)); // defined in Task 6
    player.on('stationchange', refreshRecordBtnState);
    player.on('stopped', refreshRecordBtnState);
  }
```

Add `refreshRecordBtnState()` to the `render()` function body:

```js
  function render() {
    renderPagePicker();
    renderList();
    refreshCaptureBtnState();
    refreshRecordBtnState();
  }
```

- [ ] **Step 4: Add CSS for the round Rec button**

Locate the stylesheet defining `.notes-panel__capture-btn` (`grep -rl "notes-panel__capture-btn" src/styles`) and append:

```css
.notes-panel__capture-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 0 12px;
}
.notes-panel__capture-row .notes-panel__capture-btn { flex: 1; }

.notes-panel__record-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 40px;
  height: 40px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  background: rgba(255,255,255,0.04);
  color: #fff;
  cursor: pointer;
}
.notes-panel__record-btn:disabled { opacity: 0.4; cursor: default; }
.notes-panel__record-dot {
  width: 12px; height: 12px; border-radius: 50%;
  background: #e23b3b; flex: 0 0 auto;
}
.notes-panel__record-btn.is-recording {
  border-color: #e23b3b;
  box-shadow: 0 0 0 2px rgba(226,59,59,0.35);
}
.notes-panel__record-btn.is-recording .notes-panel__record-dot {
  animation: notes-rec-pulse 1s ease-in-out infinite;
}
.notes-panel__record-time { font-size: 12px; font-variant-numeric: tabular-nums; }
@keyframes notes-rec-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
```

- [ ] **Step 5: Verify (Preview MCP)**

- `preview_inspect` `.notes-panel__record-btn` — present, `height` 40px, left of `.notes-panel__capture-btn` (compare bounding boxes).
- With no station: `preview_eval` `document.querySelector('[data-action="record"]').disabled` → `true`.
- Start a station, then `preview_click` `[data-action="record"]`; `preview_inspect` shows `.is-recording`; `[data-role="record-time"]` becomes visible with `MM:SS · N MB`. Click again to stop.

- [ ] **Step 6: Commit**

```bash
git add src/ui/notes-panel.js src/styles/*.css
git commit -m "feat(notes): record button with live time/size + budget gate"
```

---

### Task 6: Tape-player note card (render, playback, download-then-delete)

**Files:**
- Modify: `src/ui/notes-panel.js`
- Modify: the notes stylesheet (same file as Task 5)

**Interfaces:**
- Consumes: `notes.createRecording`, `notes.getRecordingBlob` (Task 2); `confirmDialog` (already imported).
- Produces: `onRecordingStopped(detail)` (referenced in Task 5); a `recording` branch in `renderCard`; `data-action="tape-play"` / `"tape-download"` handlers.

- [ ] **Step 1: Persist a finished recording as a note**

Add inside `mountNotesPanel`:

```js
  async function onRecordingStopped({ blob, mime, durationMs, bytes, station }) {
    refreshRecordBtnState();
    if (!blob || !bytes) { toast('Recording was empty.'); return; }
    const meta = getMetadata();
    const trackData = (meta && (meta.artist || meta.title || meta.nowPlaying))
      ? { artist: meta.artist ?? null, title: meta.title ?? null, nowPlaying: meta.nowPlaying ?? null }
      : null;
    const created = await notes.createRecording({
      pageId: state.currentPageId, station, track: trackData, blob, mime, durationMs, bytes,
    });
    state.notesByPage.set(state.currentPageId, [created, ...(state.notesByPage.get(state.currentPageId) ?? [])]);
    track('recording-stopped', { seconds: Math.round(durationMs / 1000), mb: +(bytes / 1048576).toFixed(1) });
    if (!state.open) openPanel();
    render();
    const listEl = panel.querySelector('[data-role="list"]');
    if (listEl) listEl.scrollTop = 0;
    toast('Recording saved');
  }
```

- [ ] **Step 2: Add the `recording` branch to `renderCard`**

In `renderCard`, after the `capture` meta/track handling and before building `bodyHtml`, add a dedicated return for recordings. Insert at the top of `renderCard` (right after `const timeStr = ...`):

```js
    if (note.type === 'recording') {
      return renderTapeCard(note, timeStr);
    }
```

Add the tape-card renderer inside `mountNotesPanel`:

```js
  function renderTapeCard(note, timeStr) {
    const card = document.createElement('article');
    card.className = 'notes-card notes-card--recording';
    card.dataset.noteId = note.id;
    const stationName = escapeHtml(note.station?.name || 'Recording');
    const dur = formatDuration(note.durationMs);
    const mb = ((note.bytes ?? 0) / 1048576).toFixed(1);
    card.innerHTML = `
      <div class="notes-card__head">
        <div class="notes-card__meta">
          <span class="notes-card__time">${timeStr}</span>
          <span class="notes-card__sep">·</span>
          <span class="notes-card__station">${stationName}</span>
        </div>
        <button type="button" class="notes-card__menu-btn" data-action="card-menu" aria-label="Recording options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18" r="1.5" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="tape">
        <button type="button" class="tape__play" data-action="tape-play" aria-label="Play recording">▶</button>
        <div class="tape__reels" aria-hidden="true">
          <svg viewBox="0 0 120 44" class="tape__svg">
            <rect x="2" y="2" width="116" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
            <g class="tape__reel"><circle cx="36" cy="22" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="36" cy="22" r="3" fill="currentColor"/><line x1="36" y1="10" x2="36" y2="34" stroke="currentColor" stroke-width="1"/><line x1="24" y1="22" x2="48" y2="22" stroke="currentColor" stroke-width="1"/></g>
            <g class="tape__reel"><circle cx="84" cy="22" r="12" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="84" cy="22" r="3" fill="currentColor"/><line x1="84" y1="10" x2="84" y2="34" stroke="currentColor" stroke-width="1"/><line x1="72" y1="22" x2="96" y2="22" stroke="currentColor" stroke-width="1"/></g>
          </svg>
        </div>
        <div class="tape__info">
          <span class="tape__dur" data-role="tape-dur">${dur}</span>
          <span class="tape__size">${mb} MB</span>
        </div>
        <button type="button" class="tape__dl" data-action="tape-download" aria-label="Download recording" title="Download">⬇</button>
        <audio class="tape__audio" data-role="tape-audio" preload="none"></audio>
      </div>
    `;
    return card;
  }
```

- [ ] **Step 3: Add play + download handlers to `onPanelClick`**

Add cases to the `switch`:

```js
      case 'tape-play':       return toggleTapePlay(card, noteId);
      case 'tape-download':   return downloadRecording(noteId);
```

Add the handlers inside `mountNotesPanel`:

```js
  async function toggleTapePlay(card, noteId) {
    const audio = card?.querySelector('[data-role="tape-audio"]');
    const playBtn = card?.querySelector('[data-action="tape-play"]');
    if (!audio || !playBtn) return;
    if (!audio.src) {
      const blob = await notes.getRecordingBlob(noteId);
      if (!blob) { toast('Recording data missing.'); return; }
      audio.src = URL.createObjectURL(blob);
      audio.addEventListener('ended', () => { card.classList.remove('is-playing'); playBtn.textContent = '▶'; });
    }
    if (audio.paused) { await audio.play(); card.classList.add('is-playing'); playBtn.textContent = '⏸'; }
    else { audio.pause(); card.classList.remove('is-playing'); playBtn.textContent = '▶'; }
  }

  async function downloadRecording(noteId) {
    const list = state.notesByPage.get(state.currentPageId) ?? [];
    const note = list.find((n) => n.id === noteId);
    if (!note) return;
    const blob = await notes.getRecordingBlob(noteId);
    if (!blob) { toast('Recording data missing.'); return; }
    const ext = (note.mime || '').includes('mp4') ? 'm4a' : (note.mime || '').includes('ogg') ? 'ogg' : 'webm';
    const stamp = new Date(note.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '');
    const name = `${(note.station?.name || 'radiodock').replace(/[^\w-]+/g, '_')}-${stamp}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    track('recording-downloaded');
    const del = await confirmDialog({
      title: 'Downloaded',
      message: 'Remove this recording from your notes?',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
    });
    if (del) deleteNoteWithUndo(noteId);
  }
```

Add the `formatDuration` top-level helper (near `dayLabel`):

```js
function formatDuration(ms) {
  const s = Math.round((ms ?? 0) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
```

- [ ] **Step 4: Revoke object URLs on re-render (leak guard)**

At the top of `renderList`, before `listEl.innerHTML = ''`, revoke any live tape audio URLs:

```js
    listEl.querySelectorAll('[data-role="tape-audio"]').forEach((a) => {
      if (a.src) { try { URL.revokeObjectURL(a.src); } catch {} a.pause(); }
    });
```

- [ ] **Step 5: Add cassette CSS**

Append to the notes stylesheet:

```css
.notes-card--recording .tape {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  color: #e9e4d8;
}
.tape__play, .tape__dl {
  border: none; background: rgba(255,255,255,0.08); color: inherit;
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer; font-size: 13px;
}
.tape__svg { width: 120px; height: 44px; color: #cbb995; }
.tape__reel { transform-box: fill-box; transform-origin: center; }
.notes-card--recording.is-playing .tape__reel { animation: tape-spin 1.6s linear infinite; }
.tape__info { display: flex; flex-direction: column; font-size: 11px; font-variant-numeric: tabular-nums; opacity: 0.8; }
@keyframes tape-spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 6: End-to-end verify (Preview MCP, live relay)**

- Play a station, `preview_click` `[data-action="record"]`, wait ~3s, click again.
- `preview_snapshot`: a `notes-card--recording` appears with `MM:SS` + `N MB`.
- `preview_click` `[data-action="tape-play"]`; `preview_inspect` `.notes-card--recording` has `is-playing`; reels animate (`preview_inspect` `.tape__reel` computed `animation-name` = `tape-spin`).
- `preview_click` `[data-action="tape-download"]`; confirm dialog appears; choose Keep → card remains; repeat and choose Delete → card removed, `preview_eval` `notes.getRecordingBlob(id)` → `undefined`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/notes-panel.js src/styles/*.css
git commit -m "feat(notes): tape-player recording card with playback + download/delete"
```

---

### Task 7: Recording cable (desktop flourish)

**Files:**
- Create: `src/ui/recording-cable.js`

**Interfaces:**
- Produces: `mountRecordingCable() → { show(), hide() }` (consumed in Task 4). No-op on coarse pointers.

- [ ] **Step 1: Write the cable module**

```js
// src/ui/recording-cable.js
// Desktop-only flourish: while recording, a slack cable visually connects the
// player container (#app) and the notes panel, re-drawn on drag/resize via
// rAF. No physics engine — a quadratic sag whose depth scales with the gap.

export function mountRecordingCable() {
  if (matchMedia('(pointer: coarse)').matches) {
    return { show() {}, hide() {} };
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '60', display: 'none',
  });
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#e23b3b');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  document.body.appendChild(svg);

  let raf = 0, running = false;

  function edgeAnchor(el, otherRect) {
    const r = el.getBoundingClientRect();
    const side = r.left + r.width / 2 < otherRect.left + otherRect.width / 2 ? r.right : r.left;
    return { x: side, y: r.top + r.height / 2 };
  }

  function draw() {
    const app = document.getElementById('app');
    const panel = document.querySelector('.notes-panel.is-open') || document.querySelector('.notes-panel');
    if (app && panel) {
      const ar = app.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      const a = edgeAnchor(app, pr);
      const b = edgeAnchor(panel, ar);
      const midX = (a.x + b.x) / 2;
      const gap = Math.hypot(b.x - a.x, b.y - a.y);
      const sagY = Math.max(a.y, b.y) + Math.min(140, gap * 0.28);
      path.setAttribute('d', `M ${a.x} ${a.y} Q ${midX} ${sagY} ${b.x} ${b.y}`);
    }
    if (running) raf = requestAnimationFrame(draw);
  }

  return {
    show() {
      if (running) return;
      running = true;
      svg.style.display = '';
      draw();
    },
    hide() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      svg.style.display = 'none';
    },
  };
}
```

- [ ] **Step 2: Verify (Preview MCP, desktop viewport)**

- `preview_resize` desktop; open the notes panel; start a recording.
- `preview_eval`: `getComputedStyle(document.querySelector('svg[aria-hidden="true"]')).display` → not `none` while recording; `preview_eval` on the `<path>` `getAttribute('d')` is non-empty.
- Drag the panel (`preview_eval` dispatching pointer events, or move `#app`) → the `d` attribute changes on the next frame.
- Stop recording → `display: none`.
- `preview_resize` mobile → cable module is a no-op (no SVG appended / stays hidden).

- [ ] **Step 3: Commit**

```bash
git add src/ui/recording-cable.js
git commit -m "feat(ui): recording cable connecting player + notes (desktop)"
```

---

### Task 8: Analytics, legal note, ROADMAP, final verification

**Files:**
- Modify: legal/about copy (locate the legal page markup — `grep -rl "legal\|Impressum\|privacy" src public`)
- Modify: `ROADMAP.md`

**Interfaces:** none new (events already emitted in Tasks 5-6: `recording-started`, `recording-stopped`, `recording-downloaded`; add `recording-deleted`).

- [ ] **Step 1: Emit a delete event**

In `deleteNoteWithUndo` (existing), after the existing `track('note-delete')`, add a recording-specific event:

```js
    if (note.type === 'recording') track('recording-deleted');
```

- [ ] **Step 2: Add the legal note**

In the legal/privacy copy, add a sentence:

> "When you record a station, its audio stream is routed through our server
> (stations.radiodock.app) instead of connecting directly. The recording is
> stored only on your device; we never keep a copy."

- [ ] **Step 3: Tick ROADMAP**

Add under the appropriate section in `ROADMAP.md`:

```markdown
- [x] Tape recording in notes — client-side capture via relay, tape-player card, download/delete, desktop cable
```

- [ ] **Step 4: Full-feature smoke (Preview MCP)**

- Fresh load, no console errors.
- Record → card → play (reels spin) → download (confirm) → delete (undo works).
- `preview_eval` `window.__analyticsDebug` (dev builds buffer events) contains `recording-started` + `recording-stopped`.
- `preview_resize` mobile: record button works, no cable.

- [ ] **Step 5: Commit + deploy**

```bash
git add -A
git commit -m "chore: recording analytics, legal note, roadmap"
git push origin main
gh run watch
```

---

## Self-Review

- **Spec coverage:** relay consumption (Task 2 `relay.js`), MediaRecorder→Opus pipeline w/ dedicated crossorigin element + no double audio (Task 3), separate `recordings` store + `type:'recording'` note + cascade delete (Tasks 1-2), Rec button left of Save Moment w/ live readout + budget gate (Task 5), tape card w/ spinning reels + scrubber-less playback + download-then-delete confirm (Task 6), desktop cable (Task 7), limits 60min/500MB (Tasks 3+5), analytics + legal + iOS-foreground reality (Tasks 5-8), stream-drop keeps partial (Task 3 `streamdrop` → `onstop`). All spec sections mapped.
- **Placeholder scan:** `<uuid>` and grep-locate instructions are operator inputs, not code placeholders. No TBD/TODO.
- **Type consistency:** `mountRecorder`/`isRecordingSupported`, `relayUrl(uuid)`, `createRecording`/`getRecordingBlob`, `putRecordingAudio`/`getRecordingAudio`/`deleteRecordingAudio`/`sumRecordingBytes`, `mountRecordingCable().{show,hide}`, `onRecordingStopped`, `refreshRecordBtnState` — names identical across defining and consuming tasks. `station.id` = RB uuid confirmed in `radio-browser.js#normaliseStation`.
- **Note:** Task 5 references `onRecordingStopped` defined in Task 6 — both land before any end-to-end run; if executing strictly in order, the `stopped` subscription is inert until Task 6, which is acceptable (no recording UI exists until Task 5's button + Task 6's card ship together).
