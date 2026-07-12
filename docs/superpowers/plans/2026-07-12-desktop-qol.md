# Desktop QoL (v2.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four quality-of-life improvements: docs reconciliation (CLAUDE.md + ROADMAP.md vs. shipped code), network-aware stream recovery, a mute toggle with volume mouse-wheel, and desktop keyboard shortcuts.

**Architecture:** Three small, independent runtime features that extend existing modules (`recovery.js`, `audio.js`, `player-card.js`) plus one new UI module (`src/ui/keyboard.js`) wired up in `main.js`. Volume UI state gets a single sync point (the existing `volumechange` listener in `main.js`) so every volume writer (drag, wheel, keys, mute) updates the dots for free. The docs task lands first so the new v2.5 roadmap section exists before feature commits tick its checkboxes.

**Tech Stack:** Vanilla JS ES modules, Vite 5, IndexedDB via `data/storage.js`. No new dependencies.

## Global Constraints

- No JS frameworks, no state libraries, no `localStorage` writes (CLAUDE.md).
- Audio element lives in the main DOM; **never** add `crossorigin` to it; **never** introduce Web Audio.
- Default to zero code comments; comment only non-obvious WHY (hidden constraint / workaround / invariant).
- UI modules expose `mount...()` returning callbacks; `main.js` is the only place that knows both UI and data.
- **No unit-test infra exists in this repo** (no test script in `package.json`). The mandated test cycle is behavioural verification with the Claude Preview MCP after every observable change (CLAUDE.md: "Don't claim something works without DOM/state evidence"). Every task below has explicit preview verification steps with expected values — treat a failed expectation exactly like a failing test.
- Dev server: `npm run dev` → `http://localhost:5173` (`PORT` env wins for Claude Preview). A debug handle exists at `window.__radiodock` (`player`, `playerCard`, `state`, …).
- Deploy workflow: after each task is verified, commit and **push to `main` immediately** (auto-deploys via GitHub Actions), and tick the task's checkbox in `ROADMAP.md` **in the same commit**.
- Version label auto-derives from commit count — never bump versions manually.
- Commit messages follow the repo style `Area: what changed` (see `git log`), ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Docs reconciliation (Q0) — CLAUDE.md module map + ROADMAP truth + new v2.5 section

**Files:**
- Modify: `CLAUDE.md` (sections "Project status" and "Module layout")
- Modify: `ROADMAP.md` (v2.4 section, v2.1 header note, new v2.5 section at top)

**Interfaces:**
- Consumes: nothing.
- Produces: `ROADMAP.md` checkboxes **Q0–Q4** that Tasks 2–5 tick in their commits.

**Verified facts (already checked against code — do not re-litigate, but spot-check if anything looks off):**

| Claim | Evidence |
|---|---|
| Notes v2.4 fully shipped | `src/data/notes.js`, `src/ui/notes-panel.js`, `src/ui/notes-capture-button.js`, `src/data/notes-export.js` all exist |
| N0 landed as `DB_VERSION = 3` (roadmap says "bump to 4") | `src/data/storage.js:26-31` — comment "v3 — adds notePages + notes stores", `const DB_VERSION = 3` |
| N3 day grouping | `notes-panel.js:923-925` ("Yesterday" bucket) |
| N5 card menu incl. Move to page | `notes-panel.js:733-739` ("Copy as text", "Play this station", "Move to page…") |
| N7 search | `notes-panel.js:45-46, 164-165` (searchQuery/searchVisible state + search input) |
| N10 analytics | `track('note-capture'/'note-create'/'note-page-create'/'note-export'/'note-delete')` all present in `notes-panel.js` |
| Visualizer built but off | `src/main.js:342` — `const VISUALIZER_ENABLED = false;` |
| CLAUDE.md "Project status" stale | says "M0–M4 are done; M5+ pending" — actually v1.0 through v2.4 shipped |

- [ ] **Step 1: Update CLAUDE.md "Project status"**

Replace the line

```markdown
Follow [ROADMAP.md](./ROADMAP.md). It is the user's primary status surface — **tick checkboxes after every milestone commit**. M0–M4 are done; M5+ pending.
```

with

```markdown
Follow [ROADMAP.md](./ROADMAP.md). It is the user's primary status surface — **tick checkboxes after every milestone commit**. v1.0 (M0–M7) and v2.0–v2.4 are shipped; the v2.1 visualizer is fully built but feature-flagged off in production (`VISUALIZER_ENABLED = false` in `src/main.js`).
```

- [ ] **Step 2: Replace the CLAUDE.md "Module layout" tree**

Replace the entire fenced tree in the "Module layout" section with:

````markdown
```
src/
├─ main.js                # orchestration, state, callbacks, bootstrap
├─ platform.js            # platform / standalone detection, beforeinstallprompt capture
├─ analytics/
│  ├─ umami.js            # track() wrapper; dev builds buffer to window.__analyticsDebug
│  └─ listen-heartbeat.js # listen-ping heartbeat, 1/min of audible playback
├─ player/
│  ├─ audio.js            # <audio> wrapper, HLS branch, EventTarget bus
│  ├─ recovery.js         # error/stalled/ended retry with backoff
│  ├─ metadata-poller.js  # poll proxy for now-playing, pauses on tab-hidden
│  └─ media-session.js    # lock-screen / notification-shade controls
├─ data/
│  ├─ storage.js          # IndexedDB wrapper (lists, prefs, notes, notePages stores)
│  ├─ lists.js            # high-level list ops, lazy default Favorites
│  ├─ notes.js            # notes + pages CRUD facade (lazy Journal page)
│  ├─ notes-export.js     # notes JSON export envelope
│  ├─ import-export.js    # JSON export/import (extension-compatible)
│  ├─ share.js            # gzip+base64url share-link codec (#s= hash)
│  ├─ radio-browser.js    # Radio Browser API client + mirror fallback
│  ├─ metadata.js         # radiodock-metadata-proxy client
│  ├─ wikipedia.js        # Wikipedia summary lookup for station info
│  ├─ logo-resolver.js    # station-logo fallback chain (override → original → DDG)
│  └─ gradient-presets.js # built-in background gradients
├─ ui/
│  ├─ player-card.js      # now-playing card, play/pause, volume dots, marquee
│  ├─ player-card-drag.js # drag + minimize-to-pill (desktop)
│  ├─ station-list.js     # drag-drop reorder, remove-from-list
│  ├─ station-logo.js     # logo slot rendering + fallback behaviour
│  ├─ station-info.js     # station bottom-sheet (Radio Browser by-uuid + Wikipedia)
│  ├─ list-dropdown.js    # rename/share/export/delete per row
│  ├─ list-tabs.js        # mobile horizontal tab strip (long-press menu)
│  ├─ lists-carousel.js   # mobile scroll-snap carousel of lists
│  ├─ search.js           # input + debounce + filter tabs + result states
│  ├─ search-overlay.js   # mobile fullscreen search overlay
│  ├─ notes-panel.js      # notes dock/panel: pages, search, day grouping, card menu
│  ├─ notes-capture-button.js # mini capture button on the player card
│  ├─ modals.js           # open/close manager (.show class)
│  ├─ modal-helpers.js    # promise-based prompt/confirm/choice
│  ├─ toast.js            # toasts, optional action button (undo pattern)
│  ├─ theme.js            # light/dark toggle + OS-pref subscription
│  ├─ background.js       # fullscreen background images + cycle controls (desktop)
│  ├─ background-gallery.js  # background picker
│  ├─ background-create.js   # gradient editor
│  ├─ install-info.js     # install onboarding modal (platform branches)
│  ├─ install-section.js  # floating install badge (desktop)
│  ├─ off-canvas.js       # mobile drawer
│  ├─ footer-reveal.js    # desktop footer auto-reveal
│  └─ idb-blocked-banner.js # help banner when IndexedDB is blocked
├─ visualizer/            # engine, registry, drawer, audio pipeline (desktop; flagged off)
├─ visualizers/           # visualizer modules (spectrum bars, oscilloscope, …)
└─ styles/                # split by component, classnames mirror popup.css
```
````

- [ ] **Step 3: ROADMAP.md — mark v2.4 shipped**

In `ROADMAP.md`:
1. Change the heading `## v2.4 — Notes / Diary 🚧` → `## v2.4 — Notes / Diary ✅`.
2. Flip all eleven checkboxes `- [ ] **N0**` … `- [ ] **N10**` to `- [x]`.
3. Replace the N0 line's text so it records reality:

```markdown
- [x] **N0** `src/data/storage.js` — `DB_VERSION` bumped to 3, added `notes` + `notePages` object stores (with `byPage` + `byCreatedAt` indexes on `notes`). *(Plan said v4; landed as v3 — v2 was never shipped.)*
```

*(Keep the parenthetical only if `git log --oneline -- src/data/storage.js` confirms no v2→v3 gap; otherwise write plain "bumped to 3".)*

- [ ] **Step 4: ROADMAP.md — annotate v2.1 visualizer status**

Directly under the `## v2.1 — Audio visualizer (desktop) 🚧` heading, add:

```markdown
Built end-to-end but **feature-flagged off in production** (`VISUALIZER_ENABLED = false` in `src/main.js`) while it matures. Flip the flag to test locally.
```

- [ ] **Step 5: ROADMAP.md — add the v2.5 section at the very top (above v2.4)**

```markdown
## v2.5 — Desktop QoL 🚧

Small, independent quality-of-life features. Implementation plan:
`docs/superpowers/plans/2026-07-12-desktop-qol.md`.

- [ ] **Q0** Docs reconciliation — CLAUDE.md module map + project status brought in line with shipped code; v2.4 ticked off (was fully implemented but unticked).
- [ ] **Q1** Network-aware recovery — `recovery.js` parks retries while `navigator.onLine === false` (no wasted attempt budget) and replays the current station immediately on the window `online` event.
- [ ] **Q2** Mute toggle — `player.toggleMute()` (remembers last audible volume), speaker button below the volume dots, `volumechange` listener in `main.js` becomes the single dots-sync point.
- [ ] **Q3** Volume mouse-wheel — wheel over the volume strip adjusts ±10% per notch.
- [ ] **Q4** Keyboard shortcuts (`src/ui/keyboard.js`) — Space = play/pause, ↑/↓ = volume, `/` = focus search (opens overlay in mobile/standalone regime), `M` = mute. Ignored while typing or while a modal is open.

---
```

- [ ] **Step 6: Verify rendered markdown**

Run: `git diff --stat` — expect only `CLAUDE.md` and `ROADMAP.md` changed. Read both files once top-to-bottom checking heading levels and that no `- [ ]`/`- [x]` line got mangled.

- [ ] **Step 7: Commit + push (tick Q0 in the same commit)**

Flip `- [ ] **Q0**` → `- [x] **Q0**` in `ROADMAP.md`, then:

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "Docs: reconcile CLAUDE.md + roadmap with shipped code; add v2.5 QoL section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Watch the Actions run (`gh run watch` or `gh run list -L 1`) until green.

---

### Task 2: Network-aware recovery (Q1)

**Files:**
- Modify: `src/player/recovery.js`

**Interfaces:**
- Consumes: `player.getCurrentStation()`, `player.playStation(station)`, `player.events` (all existing).
- Produces: no new exports — behaviour change only. The existing `recovered` event still fires via `reset()` when playback resumes.

**Behaviour spec:**
1. When a retry would fire while `navigator.onLine === false`, don't schedule it and don't consume an attempt — park in a `waitingForNetwork` state.
2. On window `offline`, cancel pending stall/retry timers and park (retries without network only burn the 3-attempt budget).
3. On window `online`, if parked OR a retry was pending OR recovery had given up: clear timers, un-give-up, and replay the current station immediately. Ensure `attempts ≥ 1` so the eventual `playing` → `reset()` emits `recovered`.
4. A user who simply paused is untouched (no timers pending, not parked → `online` is a no-op).

- [ ] **Step 1: Implement in `src/player/recovery.js`**

Add one state variable next to the existing ones (after line 16 `let recoveryTimer = null;`):

```js
  let waitingForNetwork = false;
```

In `resetSilently` and `reset`, clear it (add `waitingForNetwork = false;` alongside `gaveUp = false;` in both).

At the top of `tryRecover`, after the `if (!station) return;` guard, insert:

```js
    if (!navigator.onLine) {
      // No point burning the attempt budget without a network — park and
      // let the window 'online' handler replay immediately.
      waitingForNetwork = true;
      clearRecoveryTimer();
      return;
    }
```

At the bottom of `attachRecovery` (after the `waiting` listener), add:

```js
  window.addEventListener('offline', () => {
    if (recoveryTimer || stallTimer) {
      waitingForNetwork = true;
      clearRecoveryTimer();
      clearStallTimer();
    }
  });

  window.addEventListener('online', () => {
    const station = player.getCurrentStation();
    if (!station) return;
    if (!waitingForNetwork && !recoveryTimer && !gaveUp) return;
    waitingForNetwork = false;
    gaveUp = false;
    if (attempts === 0) attempts = 1;
    clearRecoveryTimer();
    clearStallTimer();
    player.playStation(station);
  });
```

- [ ] **Step 2: Preview verification**

Start the dev server via Claude Preview (`preview_start`), then:

1. `preview_click` on the first `.station-item` row → `preview_eval`: `window.__radiodock.player.isPlaying()` → expect `true` (allow a few seconds of buffering; `getCurrentStation()` must be non-null either way).
2. Simulate the offline→online round-trip:

```js
(async () => {
  const p = window.__radiodock.player;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  p._element().dispatchEvent(new Event('error'));           // recovery parks (offline)
  await new Promise((r) => setTimeout(r, 100));
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  const replayed = new Promise((res) => p.on('stationchange', () => res('replayed')));
  window.dispatchEvent(new Event('online'));
  return await Promise.race([replayed, new Promise((r) => setTimeout(() => r('TIMEOUT'), 3000))]);
})()
```

Expected: `"replayed"`. (`stationchange` re-fires because `playStation` was called with the same station.)

3. No-op check — user paused, network blips:

```js
(async () => {
  const p = window.__radiodock.player;
  p.pause();
  let fired = false;
  p.on('stationchange', () => { fired = true; });
  window.dispatchEvent(new Event('offline'));
  window.dispatchEvent(new Event('online'));
  await new Promise((r) => setTimeout(r, 500));
  return { fired, playing: p.isPlaying() };
})()
```

Expected: `{ fired: false, playing: false }` — the pause is respected.

4. Reload the preview page afterwards (clears the `navigator.onLine` override).
5. `preview_console_logs` with level `error` → expect no new errors.

- [ ] **Step 3: Commit + push (tick Q1)**

Flip `- [ ] **Q1**` → `- [x]` in `ROADMAP.md`, then:

```bash
git add src/player/recovery.js ROADMAP.md
git commit -m "Recovery: park retries while offline, replay instantly when the network returns

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Watch the Actions run until green.

---

### Task 3: Mute toggle (Q2)

**Files:**
- Modify: `src/player/audio.js` (add `toggleMute`, remember last audible volume)
- Modify: `index.html:253-265` (speaker button inside `#volumeControls`)
- Modify: `src/ui/player-card.js` (wire the button, sync `.is-muted`)
- Modify: `src/main.js:524-526` (make the `volumechange` listener the single dots-sync point)
- Modify: `src/styles/player-card.css` (button styling, after the `.volume-controls.is-dragging` rules ≈ line 347)

**Interfaces:**
- Consumes: `player.setVolume(level)`, `player.getVolume()`, element `volumechange` → `player.on('volumechange', evt)` with `evt.detail.volume` (all existing).
- Produces: `player.toggleMute(): void` — Task 5's keyboard module calls this. Known limitation (accept it): muting persists volume `0`; after a reload the "last audible volume" resets to the 0.8 default, so unmute-after-reload restores 0.8, not the pre-mute level.

- [ ] **Step 1: `src/player/audio.js` — toggleMute**

Add a module-level variable next to `let playToken = 0;`:

```js
let lastAudibleVolume = 0.8;
```

Extend `setVolume` to remember audible levels:

```js
function setVolume(level) {
  const v = Math.max(0, Math.min(1, Number(level) || 0));
  if (v > 0) lastAudibleVolume = v;
  getElement().volume = v;
}
```

Add below `getVolume`:

```js
function toggleMute() {
  const el = getElement();
  el.volume = el.volume > 0 ? 0 : lastAudibleVolume;
}
```

*(Direct `el.volume = 0` bypasses `setVolume` deliberately so muting doesn't clobber `lastAudibleVolume`.)*

Export it — add `toggleMute,` to the `export const player = { … }` object (after `setVolume`).

- [ ] **Step 2: `index.html` — speaker button**

Inside `<div class="volume-controls" id="volumeControls" …>` insert as the **first child** (the container is `flex-direction: column-reverse`, so first child renders at the bottom, below the smallest dot):

```html
            <button type="button" class="volume-mute-btn" id="volumeMuteBtn" aria-label="Mute" title="Mute (M)">
              <svg class="icon-speaker" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/><path d="M16 8.5a4 4 0 0 1 0 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
              <svg class="icon-muted" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>
            </button>
```

- [ ] **Step 3: `src/styles/player-card.css` — button styles**

Insert after the `.volume-controls.is-dragging .volume-dot.is-filled` rule (≈ line 347):

```css
.volume-mute-btn {
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--bg-dark);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.volume-mute-btn:hover {
  color: var(--bg-light);
}

.volume-mute-btn .icon-muted {
  display: none;
}

.volume-mute-btn.is-muted {
  color: var(--red);
}

.volume-mute-btn.is-muted .icon-muted {
  display: block;
}

.volume-mute-btn.is-muted .icon-speaker {
  display: none;
}
```

- [ ] **Step 4: `src/ui/player-card.js` — wiring**

In `mountPlayerCard`, grab the button next to the other element lookups:

```js
  const muteBtn = document.getElementById('volumeMuteBtn');
```

Next to the other interaction wiring (after the `favBtn` click listener):

```js
  muteBtn?.addEventListener('click', () => {
    haptic();
    player.toggleMute();
  });
```

Next to the other `player.on(...)` subscriptions:

```js
  player.on('volumechange', (evt) => {
    muteBtn?.classList.toggle('is-muted', evt.detail.volume === 0);
  });
```

- [ ] **Step 5: `src/main.js` — single dots-sync point**

Replace the existing listener (lines 524–526):

```js
player.on('volumechange', async (evt) => {
  await storage.setPref('volume', evt.detail.volume);
});
```

with:

```js
player.on('volumechange', async (evt) => {
  playerCard.setVolumePct(Math.round(evt.detail.volume * 100));
  await storage.setPref('volume', evt.detail.volume);
});
```

*(This makes mute, wheel (Task 4), and keyboard (Task 5) update the dot UI without each caller calling `setVolumePct` itself.)*

- [ ] **Step 6: Preview verification**

1. Reload preview. `preview_eval`: `window.__radiodock.player.getVolume()` → note the value (default `0.8`).
2. `preview_click` on `#volumeMuteBtn` → `preview_eval`:
   `({ v: window.__radiodock.player.getVolume(), muted: document.getElementById('volumeMuteBtn').classList.contains('is-muted'), filled: document.querySelectorAll('.volume-dot.is-filled').length })`
   Expected: `{ v: 0, muted: true, filled: 1 }` (only the 0-dot is ≤ bucket 0).
3. `preview_click` on `#volumeMuteBtn` again → same eval → expected `{ v: 0.8, muted: false, filled: 9 }` (dots 0–80).
4. `preview_inspect` on `.volume-mute-btn` with styles `['color','width','height']` → 16×16, color changes between the two states.
5. Mobile regression: `preview_resize` preset `mobile` → the whole volume strip (incl. the new button) stays hidden (`preview_inspect` on `.volume-controls` → `display: none`). Resize back to desktop.
6. `preview_console_logs` level `error` → none.

- [ ] **Step 7: Commit + push (tick Q2)**

Flip `- [ ] **Q2**` → `- [x]` in `ROADMAP.md`, then:

```bash
git add src/player/audio.js index.html src/ui/player-card.js src/main.js src/styles/player-card.css ROADMAP.md
git commit -m "Player: mute toggle — speaker button below the volume dots, remembers last level

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Watch the Actions run until green.

---

### Task 4: Volume mouse-wheel (Q3)

**Files:**
- Modify: `src/ui/player-card.js` (inside the existing desktop-only volume IIFE, `matchMedia('(min-width: 700px)')` block ≈ line 186)

**Interfaces:**
- Consumes: `player.getVolume()`, `player.setVolume(level)`; dot-UI sync comes for free via Task 3's `volumechange` listener in `main.js`.
- Produces: nothing new.

- [ ] **Step 1: Add the wheel listener**

Inside the volume IIFE, after the existing pointer listeners (`volumeWrap.addEventListener('pointerleave', onUp);`), add:

```js
    volumeWrap.addEventListener(
      'wheel',
      (evt) => {
        evt.preventDefault();
        const step = evt.deltaY < 0 ? 0.1 : -0.1;
        const next = Math.max(0, Math.min(1, player.getVolume() + step));
        player.setVolume(Math.round(next * 10) / 10);
      },
      { passive: false },
    );
```

*(`passive: false` + `preventDefault` so the page doesn't scroll while adjusting; rounding to one decimal keeps the value aligned with the 10%-dot buckets.)*

- [ ] **Step 2: Preview verification**

1. Reload preview (desktop viewport). `preview_eval`:

```js
(() => {
  const p = window.__radiodock.player;
  p.setVolume(0.5);
  const wrap = document.getElementById('volumeControls');
  wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  const up = p.getVolume();
  wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
  return { up, down: p.getVolume(), filled: document.querySelectorAll('.volume-dot.is-filled').length };
})()
```

Expected: `{ up: 0.6, down: 0.4, filled: 5 }` (dots 0–40 filled).

2. Clamp check: `preview_eval` — set volume `1`, wheel up once → still `1`; set `0`, wheel down once → still `0`.
3. `preview_console_logs` level `error` → none.

- [ ] **Step 3: Commit + push (tick Q3)**

Flip `- [ ] **Q3**` → `- [x]` in `ROADMAP.md`, then:

```bash
git add src/ui/player-card.js ROADMAP.md
git commit -m "Player: mouse-wheel over the volume strip adjusts volume in 10% steps

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Watch the Actions run until green.

---

### Task 5: Keyboard shortcuts (Q4)

**Files:**
- Create: `src/ui/keyboard.js`
- Modify: `src/ui/player-card.js` (extract `togglePlayPause`, expose in the returned API)
- Modify: `src/main.js` (import + mount after `const search = mountSearch({...})` ≈ line 184)

**Interfaces:**
- Consumes: `player.getVolume()`, `player.setVolume()`, `player.toggleMute()` (Task 3), `playerCard.togglePlayPause()` (created here), `search.focus()` (existing).
- Produces: `mountKeyboardShortcuts({ player, playerCard, onFocusSearch })` — fire-and-forget, returns nothing.

**Behaviour spec:**
- `Space` → toggle play/pause. Skipped when focus is on a button/link (native activation must win — otherwise one keypress would toggle twice).
- `ArrowUp` / `ArrowDown` → volume ±10% (prevents page scroll).
- `/` → focus search; in the mobile/standalone CSS regime (search input hidden, `#searchTriggerBtn` visible) open the search overlay first.
- `m` / `M` → `player.toggleMute()`.
- All shortcuts ignored while typing (`input`, `textarea`, `select`, `[contenteditable]`), while a modal is open (`.modal.show`), when a modifier (Ctrl/Meta/Alt) is held, or when the event was already `defaultPrevented` (e.g. by the notes panel's own keydown handling).

- [ ] **Step 1: Create `src/ui/keyboard.js`**

```js
// Desktop keyboard shortcuts. Space = play/pause, arrows = volume,
// "/" = search, M = mute. Deliberately inert while the user is typing,
// while any modal is open, or when another handler already claimed the
// event (notes panel, modal-helpers).

const VOLUME_STEP = 0.1;

function isTypingTarget(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable]');
}

export function mountKeyboardShortcuts({ player, playerCard, onFocusSearch }) {
  document.addEventListener('keydown', (evt) => {
    if (evt.defaultPrevented) return;
    if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
    if (isTypingTarget(evt.target)) return;
    if (document.querySelector('.modal.show')) return;

    switch (evt.key) {
      case ' ': {
        if (evt.repeat) return;
        // Focused buttons/links activate on Space natively — don't double-fire.
        if (evt.target?.closest?.('button, a, [role="button"]')) return;
        evt.preventDefault();
        playerCard.togglePlayPause();
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        evt.preventDefault();
        const dir = evt.key === 'ArrowUp' ? 1 : -1;
        const next = Math.max(0, Math.min(1, player.getVolume() + dir * VOLUME_STEP));
        player.setVolume(Math.round(next * 10) / 10);
        break;
      }
      case '/': {
        evt.preventDefault();
        onFocusSearch?.();
        break;
      }
      case 'm':
      case 'M': {
        if (evt.repeat) return;
        player.toggleMute();
        break;
      }
    }
  });
}
```

- [ ] **Step 2: `src/ui/player-card.js` — extract togglePlayPause**

Replace the `playPauseBtn` click listener (≈ lines 160–178):

```js
  function togglePlayPause() {
    if (!currentStation) return;
    if (player.isPlaying()) {
      player.pause();
      return;
    }
    // If the audio module's current station doesn't match the UI's current
    // station, we don't have a stream loaded yet — e.g. just after page
    // reload, where main.js restored the station from prefs into the player
    // card UI but never actually called playStation. Start it fresh.
    const audioStation = player.getCurrentStation();
    if (!audioStation || audioStation.id !== currentStation.id) {
      player.playStation(currentStation);
      return;
    }
    // Audio is loaded and paused — just unpause.
    player.resume();
  }

  playPauseBtn.addEventListener('click', () => {
    haptic();
    togglePlayPause();
  });
```

Add `togglePlayPause,` to the returned API object (before `onFavoriteClick`).

- [ ] **Step 3: `src/main.js` — mount**

Add to the imports block:

```js
import { mountKeyboardShortcuts } from './ui/keyboard.js';
```

After the `const search = mountSearch({...});` statement, add:

```js
mountKeyboardShortcuts({
  player,
  playerCard,
  onFocusSearch: () => {
    // Mobile/standalone regime hides the inline search input; the visible
    // trigger button opens the fullscreen overlay instead.
    const trigger = document.getElementById('searchTriggerBtn');
    if (trigger && trigger.offsetParent !== null) {
      trigger.click();
      setTimeout(() => search.focus(), 50);
    } else {
      search.focus();
    }
  },
});
```

- [ ] **Step 4: Preview verification**

1. Reload preview (desktop viewport). `preview_click` on the first `.station-item` → wait for `preview_eval`: `window.__radiodock.player.isPlaying()` → `true`.
2. Space toggles:

```js
(async () => {
  const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  document.activeElement?.blur();
  key(' ');
  await new Promise((r) => setTimeout(r, 300));
  const paused = !window.__radiodock.player.isPlaying();
  key(' ');
  await new Promise((r) => setTimeout(r, 1500));
  return { paused, resumed: window.__radiodock.player.isPlaying() };
})()
```

Expected: `{ paused: true, resumed: true }`.

3. Arrows + M:

```js
(() => {
  const p = window.__radiodock.player;
  const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  p.setVolume(0.5);
  key('ArrowUp');
  const up = p.getVolume();
  key('ArrowDown'); key('ArrowDown');
  const down = p.getVolume();
  key('m');
  const muted = p.getVolume();
  key('m');
  return { up, down, muted, restored: p.getVolume() };
})()
```

Expected: `{ up: 0.6, down: 0.4, muted: 0, restored: 0.4 }`.

4. `/` focuses search: dispatch `key('/')` (same helper) → `preview_eval`: `document.activeElement?.id` → `"searchInput"`.
5. Typing guard: `preview_eval` —

```js
(() => {
  const p = window.__radiodock.player;
  p.setVolume(0.5);
  const input = document.getElementById('searchInput');
  input.focus();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
  input.blur();
  return p.getVolume();
})()
```

Expected: `0.5` (unchanged).

6. Modal guard: open the About modal (`preview_click` on `#dockLogoBtn`), dispatch `key(' ')` → playback state must not change; close via Escape.
7. `preview_console_logs` level `error` → none.

- [ ] **Step 5: Commit + push (tick Q4; mark v2.5 ✅)**

Flip `- [ ] **Q4**` → `- [x]` and change the section heading `## v2.5 — Desktop QoL 🚧` → `## v2.5 — Desktop QoL ✅` in `ROADMAP.md`, then:

```bash
git add src/ui/keyboard.js src/ui/player-card.js src/main.js ROADMAP.md
git commit -m "Keyboard: Space play/pause, arrows volume, / search, M mute

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

Watch the Actions run until green, then spot-check https://radiodock.app once deployed.

---

## Task ordering & independence

Task 1 (docs) must land first — it creates the Q0–Q4 checkboxes the other commits tick. Task 3 (mute) must precede Task 5 (keyboard needs `toggleMute`) and Task 4 benefits from Task 3's centralized dots-sync. Task 2 (recovery) is fully independent and can run any time after Task 1.

Recommended order: **1 → 2 → 3 → 4 → 5** (matches Q numbering).
