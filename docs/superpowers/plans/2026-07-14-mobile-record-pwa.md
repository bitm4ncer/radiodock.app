# Mobile Server-Side Recording — PWA Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable recording on mobile by driving the server-side `/api/record/*` endpoints from a server-backed recorder that mirrors the existing client-side recorder's event interface, so the notes UI works unchanged and background recordings can be finished on return.

**Architecture:** A `mobile-recorder` (same `start/stop/isRecording/on` shape as `player/recorder.js`) calls a thin `record-client` (start/stop/fetch) against the Stations VPS, persists an in-flight handle to IndexedDB (`prefs.pendingRecording`) so it survives app restarts, and emits `stopped {blob,...}` after fetching the finished file — which the existing `onRecordingStopped` turns into the same tape card. `main.js` picks the mobile recorder on coarse pointers and the desktop recorder otherwise.

**Tech Stack:** Vanilla JS, Vite 5, IndexedDB, fetch. Verification via Claude Preview + on-device iPhone.

**Prerequisite:** The Stations plan `2026-07-14-mobile-record-server.md` must be **deployed and live** before Tasks 2+ can be verified.

## Global Constraints

- Mobile-first; reuse existing classnames; no new deps.
- IndexedDB via `data/storage.js` (`getPref`/`setPref`); UI never touches IDB directly.
- The main `<audio>` is never touched — the server records; the client only downloads the finished file. This is what removes the double-audio bug.
- Stations base URL: `https://stations.radiodock.app`.
- Mobile = `matchMedia('(pointer: coarse)').matches`. Desktop path stays exactly as-is.
- Deploy policy: **test locally with the user before pushing** (no auto-deploy); the iPhone on-device test is the ship gate.
- Recording note shape unchanged: `type:'recording'`, blob in `recordings` store, tape card.

---

### Task 1: Record client (`data/record-client.js`)

**Files:**
- Create: `src/data/record-client.js`

**Interfaces:**
- Produces:
  - `startRecording(uuid) → Promise<{ id, mime }>` (throws on non-200)
  - `stopRecording(id) → Promise<{ id, bytes, mime, durationMs }>` (resolves even on 404 → `{ bytes: 0 }`)
  - `fetchRecording(id) → Promise<Blob>` (throws `RecordingExpiredError` on 404)

- [ ] **Step 1: Write the module**

```js
// src/data/record-client.js
// Thin client for the Stations server-side recording endpoints. Mobile only —
// iOS can't capture audio client-side, so the VPS records and we download the
// finished file. See docs/superpowers/specs/2026-07-14-mobile-server-recording-design.md
const BASE = 'https://stations.radiodock.app';

export class RecordingExpiredError extends Error {}

export async function startRecording(uuid) {
  const res = await fetch(`${BASE}/api/record/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uuid }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  return res.json(); // { id, mime }
}

export async function stopRecording(id) {
  const res = await fetch(`${BASE}/api/record/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (res.status === 404) return { id, bytes: 0, mime: 'audio/mpeg', durationMs: 0 };
  if (!res.ok) throw new Error(`stop failed: ${res.status}`);
  return res.json();
}

export async function fetchRecording(id) {
  const res = await fetch(`${BASE}/api/record/fetch?id=${encodeURIComponent(id)}`);
  if (res.status === 404) throw new RecordingExpiredError('recording expired');
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.blob();
}
```

- [ ] **Step 2: Verify against the live endpoints (Preview MCP)**

Start the dev server; `preview_eval` (replace `<uuid>` with a real station UUID):
```js
(async () => {
  const rc = await import('/src/data/record-client.js');
  const { id } = await rc.startRecording('<uuid>');
  await new Promise(r => setTimeout(r, 3000));
  const stopped = await rc.stopRecording(id);
  const blob = await rc.fetchRecording(id);
  let expired = false;
  try { await rc.fetchRecording(id); } catch (e) { expired = e instanceof rc.RecordingExpiredError; }
  return { bytes: stopped.bytes, blobSize: blob.size, mime: blob.type, deletedAfterFetch: expired };
})()
```
Expected: `bytes > 0`, `blobSize > 0`, `mime` ~`audio/mpeg`, `deletedAfterFetch: true`.

- [ ] **Step 3: Commit**

```bash
git add src/data/record-client.js
git commit -m "feat(data): record-client for server-side recording endpoints"
```

---

### Task 2: Mobile recorder (`player/mobile-recorder.js`)

**Files:**
- Create: `src/player/mobile-recorder.js`

**Interfaces:**
- Consumes: `startRecording/stopRecording/fetchRecording/RecordingExpiredError` (Task 1); `getPref/setPref` from `data/storage.js`; `station.id` is the RB UUID.
- Produces: `mountMobileRecorder() → { start(station), stop(), isRecording(), hasPending(), on(type, handler) }`.
  - Events mirror the desktop recorder so `notes-panel` works unchanged: `started {station}`, `progress {seconds, bytes:null}`, `fetching {}`, `stopped {blob, mime, durationMs, bytes, station}`, `error {message}`.
  - On mount, if a persisted handle exists, the recorder is already "recording" (resumes the elapsed clock) so the button shows recording state and a tap finishes it.

- [ ] **Step 1: Write the module**

```js
// src/player/mobile-recorder.js
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
```

- [ ] **Step 2: Verify the full mobile flow (Preview MCP, live server)**

`preview_eval` (real `<uuid>`):
```js
(async () => {
  const { mountMobileRecorder } = await import('/src/player/mobile-recorder.js');
  const rec = mountMobileRecorder();
  const done = new Promise((res) => rec.on('stopped', e => res(e.detail)));
  const errs = []; rec.on('error', e => errs.push(e.detail.message));
  rec.start({ id: '<uuid>', name: 'Test', countrycode: 'US' });
  await new Promise(r => setTimeout(r, 500));
  const recordingAfterStart = rec.isRecording();
  setTimeout(() => rec.stop(), 3000);
  const d = await Promise.race([done, new Promise(r => setTimeout(() => r(null), 15000))]);
  return d ? { recordingAfterStart, mime: d.mime, bytes: d.bytes, ms: d.durationMs, errs } : { timedOut: true, errs };
})()
```
Expected: `recordingAfterStart: true`, `bytes > 0`, `mime` ~`audio/mpeg`, `ms ≈ 3000`, `errs: []`. Confirm `pendingRecording` pref is cleared afterward: `preview_eval` `import('/src/data/storage.js').then(s=>s.getPref('pendingRecording',null))` → `null`.

- [ ] **Step 3: Verify restart-resume**

`preview_eval`: start a recording, then WITHOUT stopping, simulate restart by mounting a fresh recorder and checking it resumes:
```js
(async () => {
  const { mountMobileRecorder } = await import('/src/player/mobile-recorder.js');
  const a = mountMobileRecorder();
  a.start({ id: '<uuid>', name: 'Test' });
  await new Promise(r => setTimeout(r, 1500));
  const b = mountMobileRecorder(); // fresh instance = "after restart"
  await new Promise(r => setTimeout(r, 300));
  const resumed = b.hasPending() && b.isRecording();
  const done = new Promise(res => b.on('stopped', e => res(e.detail)));
  b.stop();
  const d = await Promise.race([done, new Promise(r => setTimeout(() => r(null), 15000))]);
  return { resumed, savedBytes: d?.bytes };
})()
```
Expected: `resumed: true`, `savedBytes > 0`.

- [ ] **Step 4: Commit**

```bash
git add src/player/mobile-recorder.js
git commit -m "feat(player): server-backed mobile recorder with restart-resume"
```

---

### Task 3: Wire mobile recorder + re-enable the mobile button

**Files:**
- Modify: `src/main.js`
- Modify: `src/ui/record-button.js`
- Modify: `src/ui/notes-panel.js`

**Interfaces:**
- Consumes: `mountMobileRecorder` (Task 2); existing `mountRecorder`, `mountRecordButton`, `mountRecordingCable`, `detectStandalone`, `isElectron`.

- [ ] **Step 1: Import + pick the recorder by pointer type in `main.js`**

Add the import near the recorder imports:

```js
import { mountMobileRecorder } from './player/mobile-recorder.js';
```

Replace the recorder-creation + gating block (the `const recorder = isRecordingSupported() ...` down through the `mountRecordButton` call) with:

```js
const isCoarsePointer = matchMedia('(pointer: coarse)').matches;
const recordDesktopApp = !isCoarsePointer && (detectStandalone() || isElectron());

// Mobile records server-side (iOS can't capture client-side); desktop records
// client-side. The two share the same event interface, so the notes UI is
// identical. The record button shows in app contexts (mobile, installed PWA,
// Electron); a regular desktop browser uses the notes-panel button instead.
const recorder = isCoarsePointer
  ? mountMobileRecorder()
  : (isRecordingSupported() ? mountRecorder({ maxDurationMs: 60 * 60 * 1000 }) : null);

const recordingCable = mountRecordingCable(); // desktop-only internally
if (recorder && !isCoarsePointer) {
  recorder.on('started', () => recordingCable.show());
  recorder.on('stopped', () => recordingCable.hide());
  recorder.on('streamdrop', () => recordingCable.hide());
  recorder.on('error', () => recordingCable.hide());
}

mountNotesPanel({ player, getLatestMetadata: () => latestMetadata, recorder, showPanelRecordButton: !isCoarsePointer && !recordDesktopApp })
  .then((api) => { notesApi = api; })
  .catch((err) => console.warn('Notes panel mount failed:', err));

if ((recordDesktopApp || isCoarsePointer) && recorder) {
  mountRecordButton({ recorder, player, getNotesApi: () => notesApi });
}

// Mobile: if a background recording is still in flight after (re)launch, nudge
// the user that it's running and tappable to save.
if (isCoarsePointer && recorder?.hasPending) {
  const nudge = () => { if (recorder.hasPending()) toast('Recording still running — tap ● to save it.'); };
  recorder.on('resumed', nudge);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') nudge(); });
}
```

- [ ] **Step 2: Show the elapsed timer + fetching state on the top-bar button (`record-button.js`)**

Add a time label to the button markup — change the `innerHTML` line:

```js
  btn.innerHTML = '<span class="record-adjacent-btn__dot" aria-hidden="true"></span><span class="record-adjacent-btn__time" data-role="rec-time" hidden></span>';
```

Add progress + fetching handling. After the existing `recorder?.on(...)` subscriptions in `mountRecordButton`, add:

```js
  const timeEl = btn.querySelector('[data-role="rec-time"]');
  recorder?.on('progress', (e) => {
    const s = e.detail?.seconds ?? 0;
    timeEl.hidden = false;
    timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  recorder?.on('resumed', () => { refresh(); });
  recorder?.on('fetching', () => { btn.classList.add('is-fetching'); });
  const clearTransient = () => { btn.classList.remove('is-fetching'); timeEl.hidden = true; timeEl.textContent = ''; };
  recorder?.on('stopped', clearTransient);
  recorder?.on('error', clearTransient);
```

And append CSS to `src/styles/off-canvas.css`:

```css
.record-adjacent-btn__time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}
.record-adjacent-btn.is-fetching { opacity: 0.6; }
```

- [ ] **Step 3: Show a "saving…" toast while fetching (`notes-panel.js`)**

In the `if (recorder) { ... }` recorder-subscription block, add:

```js
    recorder.on('fetching', () => toast('Saving recording…'));
```

- [ ] **Step 4: Verify both contexts (Preview MCP)**

- Desktop browser (default preview): `preview_eval` `!!document.querySelector('.notes-panel__record-btn') && !document.querySelector('.record-adjacent-btn')` → `true` (unchanged desktop path).
- Mobile: the Preview can't emulate a coarse pointer, so verify via the modules directly — `preview_eval` confirms `mountMobileRecorder` drives a real recording (already done in Task 2). Confirm no console errors on load in both `/` and `/?pwa=1`.
- Build passes: `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/ui/record-button.js src/ui/notes-panel.js src/styles/off-canvas.css
git commit -m "feat(recording): route mobile to server recorder, re-enable mobile button"
```

---

### Task 4: Legal note, ROADMAP, and on-device gate

**Files:**
- Modify: `public/legal.html`
- Modify: `ROADMAP.md`

**Interfaces:** none.

- [ ] **Step 1: Legal note**

In `public/legal.html`, after the existing "RadioDock Stations relay" list item, add:

```html
        <li>
          <strong>RadioDock Stations recorder</strong> (<code>stations.radiodock.app</code>) — on mobile, recording is done on our server (your device's browser can't capture the audio directly). The stream is briefly buffered on the server and <strong>deleted immediately after it is transferred to your device</strong>; it is never stored long-term. The recording lives only on your device (IndexedDB).
        </li>
```

- [ ] **Step 2: ROADMAP**

Under the v2.6 recording section in `ROADMAP.md`, add:

```markdown
- [x] Mobile recording via server-side capture (relay can't be captured on iOS) — VPS temp-buffers + delete-on-fetch; background recording survives app restart
- [ ] On-device iPhone verification (no double audio, non-empty file, background→return→save) — ship gate
```

- [ ] **Step 3: Commit**

```bash
git add public/legal.html ROADMAP.md
git commit -m "docs: mobile-recording legal note + roadmap"
```

- [ ] **Step 4: On-device verification (user, ship gate)**

After the branch is running against the live server, the user tests on a real iPhone (Safari + installed PWA):
1. Play a station, tap ● → recording indicator + timer, **single audio only** (no double), main playback unaffected.
2. Tap ● again → "Saving…" → tape card appears with a **non-empty** file that plays.
3. Start a recording, background the app / lock the phone for ~1 min, reopen → button shows recording + elapsed time → tap ● → the background portion is saved.
4. Confirm on the server there is no leftover in `data/rec-tmp/` after fetch (delete-on-fetch).

Only after this passes do we merge + deploy.

---

## Self-Review

- **Spec coverage:** record-client (Task 1), server-backed mobile recorder with pending-handle persistence + restart-resume (Task 2), pointer-based recorder selection + re-enabled mobile button + elapsed timer + fetching state + resume nudge (Task 3), legal note + ROADMAP + on-device gate (Task 4). Same tape-card/note shape reused (no changes needed). Desktop path untouched.
- **Placeholder scan:** `<uuid>` is operator input. No TBD/TODO.
- **Type consistency:** `mountMobileRecorder().{start,stop,isRecording,hasPending,on}`; events `started/progress/fetching/resumed/stopped/error`; `stopped` detail `{blob,mime,bytes,durationMs,station}` matches what `onRecordingStopped` consumes; `pendingRecording` pref shape `{id,mime,uuid,station,startedAt}` consistent between write (start) and read (mount-resume). `station.id` = RB uuid. Server id `/^[0-9a-f]{36}$/` matches the server plan.
- **Note:** desktop `recorder` still emits `streamdrop`; mobile recorder does not (fine — no listener depends on it existing). `mountRecordButton` subscribes to `progress/resumed/fetching`, which the desktop recorder emits only `progress` — the others simply never fire on desktop (harmless).
