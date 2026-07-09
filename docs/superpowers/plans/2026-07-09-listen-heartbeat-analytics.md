# Listen-Heartbeat Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure per-station listening duration (including background/locked-screen playback) by emitting one anonymous `listen-ping` Umami event per minute of actual playback.

**Architecture:** A new `attach`-style module (`src/analytics/listen-heartbeat.js`) subscribes to the shared player's event bus. While audio is audibly playing it fires a 60-second `setInterval`; each tick re-reads the current station and sends `track('listen-ping', { station, country, background })`. Ping counts in Umami's Events → Properties view directly equal listening minutes per station. A small dev-mode observability hook in `umami.js` makes all analytics calls inspectable in the browser console so the behaviour can be verified with Claude Preview.

**Tech Stack:** Vanilla ES modules, Vite 5, self-hosted Umami (script auto-loaded in `index.html`, custom events via `window.umami.track`).

## Global Constraints

- No JS frameworks, no state library, no localStorage writes (CLAUDE.md).
- This repo has **no unit-test runner** — CLAUDE.md prescribes behavioural verification via the Claude Preview MCP after every observable change. Tasks therefore end with Preview verification steps instead of unit tests. Do not add a test framework.
- Default to writing no code comments; only comment non-obvious WHY (CLAUDE.md).
- `track()` in `src/analytics/umami.js` is PROD-gated (`import.meta.env.PROD`) and Umami honours `localStorage['umami.disabled']` — the heartbeat must go through this same `track()` so both gates keep applying. Do not call `window.umami` directly.
- Event name is exactly `listen-ping`. Payload keys exactly: `station` (string), `country` (string, may be empty), `background` (`'yes'` | `'no'`).
- Heartbeat interval is exactly 60 000 ms in production code. No config surface beyond the function parameter default.
- Player event names (from `src/player/audio.js`): `playing`, `paused`, `loading`, `canplay`, `stopped`, `stationchange`, `error`. The bus is `player.on(type, handler)`.

---

### Task 1: Dev-mode observability for analytics events

**Files:**
- Modify: `src/analytics/umami.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: in dev builds (`import.meta.env.DEV`), every `track(name, data)` call appends `{ name, data }` to `window.__analyticsDebug` (array, capped at 200 entries). Production behaviour unchanged. Task 2's verification relies on this array.

- [ ] **Step 1: Implement the dev branch in `track()`**

Replace the body of `src/analytics/umami.js` with:

```js
// Custom Umami events on top of the auto-pageview tracker loaded in
// index.html. Gated to production builds so `npm run dev` doesn't pollute
// the live dashboard. All calls are best-effort: a missing or
// late-loading umami global no-ops rather than throwing.

const ENABLED = import.meta.env.PROD;

export function track(name, data) {
  if (!ENABLED) {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const log = (window.__analyticsDebug ??= []);
      log.push({ name, data });
      if (log.length > 200) log.shift();
    }
    return;
  }
  const u = typeof window !== 'undefined' ? window.umami : null;
  if (!u || typeof u.track !== 'function') return;
  try {
    if (data !== undefined) u.track(name, data);
    else u.track(name);
  } catch {
    // Analytics failures must never break the app.
  }
}
```

- [ ] **Step 2: Verify with Claude Preview**

1. `preview_start` (config `dev` from `.claude/launch.json`; create it per the tool docs with `npm run dev` on port 5173 if missing).
2. `preview_eval`: `window.location.reload()` if the server was already running.
3. `preview_eval`: click-free check first — `Array.isArray(window.__analyticsDebug) ? window.__analyticsDebug.length : 'unset'` (may be `'unset'`, that's fine before any event).
4. `preview_click` on the first station row (`.station-item`).
5. `preview_eval`: `window.__analyticsDebug?.map(e => e.name)`.

Expected: array contains `'station-play'`.

- [ ] **Step 3: Commit**

```powershell
git add src/analytics/umami.js
git commit -m "Analytics: buffer events to window.__analyticsDebug in dev builds"
```

---

### Task 2: Listen-heartbeat module + wiring

**Files:**
- Create: `src/analytics/listen-heartbeat.js`
- Modify: `src/main.js` (import block lines 1–33; boot block around line 51–53)

**Interfaces:**
- Consumes: `player.on(type, handler)`, `player.isPlaying()`, `player.getCurrentStation()` from `src/player/audio.js`; `track(name, data)` from `src/analytics/umami.js` (with Task 1's dev buffer).
- Produces: `attachListenHeartbeat(player, { intervalMs = 60_000 } = {})` — void, side-effect only. Sends `track('listen-ping', { station, country, background })` once per interval while playback is audible.

- [ ] **Step 1: Create `src/analytics/listen-heartbeat.js`**

```js
// One listen-ping per minute of audible playback. Ping count per station
// in Umami equals listening minutes. `audible` gates out stall/rebuffer
// phases ('loading') that would otherwise count as listening because the
// element isn't paused while it rebuffers.

import { track } from './umami.js';

export function attachListenHeartbeat(player, { intervalMs = 60_000 } = {}) {
  let timer = null;
  let audible = false;

  const tick = () => {
    if (!audible || !player.isPlaying()) return;
    const station = player.getCurrentStation();
    if (!station) return;
    track('listen-ping', {
      station: station.name ?? '',
      country: station.countrycode ?? '',
      background: document.visibilityState === 'hidden' ? 'yes' : 'no',
    });
  };

  const start = () => {
    audible = true;
    if (!timer) timer = setInterval(tick, intervalMs);
  };

  const stop = () => {
    audible = false;
    if (timer) clearInterval(timer);
    timer = null;
  };

  player.on('playing', start);
  player.on('loading', () => {
    audible = false;
  });
  player.on('paused', stop);
  player.on('stopped', stop);
  player.on('error', stop);
}
```

Notes for the implementer:
- `stationchange` is deliberately not handled: the timer keeps running across a station switch and each tick re-reads `getCurrentStation()`, so pings automatically carry the new name.
- `loading` only mutes the tick (`audible = false`) without killing the timer — a rebuffer that recovers within the same minute resumes counting via the next `playing` event.

- [ ] **Step 2: Wire it up in `src/main.js`**

Add to the import block (after line 32, `import { track } ...`):

```js
import { attachListenHeartbeat } from './analytics/listen-heartbeat.js';
```

Add after `attachMediaSession(player);` (line 53):

```js
attachListenHeartbeat(player);
```

- [ ] **Step 3: Verify start/tick with Claude Preview (real 60 s tick)**

1. Reload the preview page (`preview_eval`: `window.location.reload()`).
2. `preview_click` a station row (`.station-item`) and confirm playback started: `preview_eval` → `document.querySelector('audio') && !document.querySelector('audio').paused` should be `true`. If autoplay is blocked, click the play button in the player card first.
3. Wait 65 seconds: PowerShell `Start-Sleep -Seconds 65` (a real-time wait is the point — we are verifying the production 60 s interval, so do not shorten it).
4. `preview_eval`: `window.__analyticsDebug?.filter(e => e.name === 'listen-ping')`.

Expected: exactly 1 ping, payload `{ station: '<name>', country: '<cc>', background: 'no' }` with a non-empty station name.

- [ ] **Step 4: Verify background flag**

1. `preview_eval`: `Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); 'ok'`.
2. PowerShell `Start-Sleep -Seconds 65`.
3. `preview_eval`: `window.__analyticsDebug?.filter(e => e.name === 'listen-ping').map(e => e.data.background)`.

Expected: `['no', 'yes']`.

4. Restore: `preview_eval`: `delete document.visibilityState; document.visibilityState` → `'visible'`.

- [ ] **Step 5: Verify pause stops pings**

1. `preview_eval`: `document.querySelector('audio').pause(); 'paused'`.
2. PowerShell `Start-Sleep -Seconds 70`.
3. `preview_eval`: `window.__analyticsDebug?.filter(e => e.name === 'listen-ping').length`.

Expected: still `2` (no new ping while paused).

- [ ] **Step 6: Commit**

```powershell
git add src/analytics/listen-heartbeat.js src/main.js
git commit -m "Analytics: listen-ping heartbeat for per-station listening minutes"
```

---

### Task 3: legal.html transparency wording

**Files:**
- Modify: `public/legal.html:247`

**Interfaces:**
- Consumes: nothing.
- Produces: updated disclosure text covering listening-duration pings.

- [ ] **Step 1: Extend the "What is recorded" paragraph**

Replace the paragraph at `public/legal.html:246-248`:

```html
      <p>
        <strong>What is recorded:</strong> pageviews, and a small set of named interaction events (which station was played, which install button was clicked, search filter used, list created/imported/exported/deleted, stream errors). The events do not contain any text you have typed (no search queries, no list names, no station notes).
      </p>
```

with:

```html
      <p>
        <strong>What is recorded:</strong> pageviews, and a small set of named interaction events (which station was played and — via an anonymous once-per-minute "listening" event — for roughly how long, including whether the app was in the foreground or background at that moment; which install button was clicked; search filter used; list created/imported/exported/deleted; stream errors). The events do not contain any text you have typed (no search queries, no list names, no station notes), and the listening events carry no identifier linking them to you or your device.
      </p>
```

- [ ] **Step 2: Verify with Claude Preview**

`preview_eval`: `await (await fetch('/legal.html')).text().then(t => t.includes('once-per-minute'))` → `true`.

- [ ] **Step 3: Commit**

```powershell
git add public/legal.html
git commit -m "Legal: disclose listening-duration heartbeat in analytics section"
```

---

## Post-implementation checks (not a task, run once after Task 3)

- `npm run build` passes.
- After the next deploy, watch the Umami Activity feed for `listen-ping` events arriving from production, then check Events → `listen-ping` → Properties → `station`.
