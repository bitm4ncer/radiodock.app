# Nudge System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two dezente, engagement-gated nudge cards (Share, Support) that appear at most once per session and only after the user has shown they like the app.

**Architecture:** One new UI module `src/ui/nudges.js` owns a usage tracker (unique-day count + audible-minute accumulator, both persisted in the `prefs` IndexedDB store), a small registry of nudge definitions, an eligibility/selection step, and a generic card renderer with two CSS regimes (floating card bottom-left on desktop browser; slim banner above the station-list nav on mobile/Electron). `main.js` mounts it once at boot.

**Tech Stack:** Vanilla ES modules, Vite 5, IndexedDB via `src/data/storage.js`, analytics via `src/analytics/umami.js`. No framework, no test runner — verification is behavioural via the Claude Preview/Browser MCP (per CLAUDE.md).

## Global Constraints

- **No test framework exists.** Verify every task behaviourally with the Browser MCP (`preview_start` → `javascript_tool` to seed prefs / drive `window.__nudgeDebug` → `read_page` / screenshot). Never claim it works without DOM/state evidence.
- **Persistence only through `src/data/storage.js`** `getPref`/`setPref` — never raw IndexedDB, never `localStorage`.
- **Mobile-first CSS**, centered column max 480px, dark `#1a1a1a` base. Default styles target mobile; scale up with `min-width` media queries.
- **Reuse existing classnames/patterns** where they exist; mirror `install-section` for the floating-card regime.
- **Copy is fixed (verbatim):**
  - Share headline: `Enjoying RadioDock?` · body: `Share it with someone.`
  - Support headline: `You're a power user!` · body: `RadioDock is free & ad-free. Help keep the server alive and support the project.`
- **Constants (exact values):** `SHARE_LISTEN_MINUTES = 5`, `SUPPORT_DAY_COUNT = 3`, `SUPPORT_URL = 'https://ko-fi.com/radiodock'`, `APP_SHARE_URL = 'https://radiodock.app'`.
- **Frequency:** max one nudge per session (in-memory flag); a shown card sets a permanent `…Seen` pref so it never reappears; priority on tie is `share` before `support`. Nudges appear in standalone/installed mode too.
- **No third-party embed/iframe.** The card is native; only the final Share/Support click hands off (share sheet / new tab to Ko-fi).

## File Structure

- **Create** `src/ui/nudges.js` — the whole system (usage tracker, audible accumulator, registry, eligibility/selection, renderer, share/support actions, `window.__nudgeDebug`). Exposes `mountNudges({ player })`.
- **Create** `src/styles/nudges.css` — `.nudge` base + `.nudge--float` (desktop) + `.nudge--banner` (mobile/standalone) regimes, enter/dismiss transitions.
- **Modify** `src/styles/index.css` — add `@import './nudges.css';`.
- **Modify** `src/main.js` — import and call `mountNudges({ player })` at boot.

---

### Task 1: Module scaffold — usage tracker + audible-minute accumulator (no UI)

**Files:**
- Create: `src/ui/nudges.js`
- Modify: `src/main.js` (import at top near line 47; call near boot line 71)

**Interfaces:**
- Consumes: `player` (EventTarget-style bus with `.on(event, cb)`, `.isPlaying()`; events `playing`/`loading`/`paused`/`stopped`/`error` — same as `src/analytics/listen-heartbeat.js`); `storage.getPref`/`setPref` from `../data/storage.js`.
- Produces: `mountNudges({ player })` (default export-less named export). Persists prefs `usageLastDay`, `usageDayCount`, `usageListenedEver`, `nudgeShareListenMin`. Internal `getNudgeState()` returning `{ shareListenMin, dayCount, listenedEver, shareSeen, supportSeen }` (used by Task 2).

- [ ] **Step 1: Create `src/ui/nudges.js` with the tracker + accumulator**

```javascript
// Nudge system: dezente, engagement-gated cards (Share, Support). One module
// owns usage tracking, eligibility, and rendering. Nudges appear at most once
// per session and only after the user has shown they like the app.
//
// Persistence goes through the prefs store (IDB-safe; degrades silently when
// IDB is blocked). No localStorage.

import * as storage from '../data/storage.js';
import { track } from '../analytics/umami.js';

// --- Tunables (all thresholds + URLs in one place) ---
const SHARE_LISTEN_MINUTES = 5;
const SUPPORT_DAY_COUNT = 3;
const SUPPORT_URL = 'https://ko-fi.com/radiodock';
const APP_SHARE_URL = 'https://radiodock.app';

// Local calendar day as YYYY-MM-DD (not UTC — a listener at 11pm shouldn't
// have "today" roll based on the server's timezone).
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// Bump the unique-usage-day counter once per calendar day.
async function trackUsageDay() {
  const today = todayStr();
  const last = await storage.getPref('usageLastDay', null);
  if (last === today) return;
  const count = await storage.getPref('usageDayCount', 0);
  await storage.setPref('usageDayCount', count + 1);
  await storage.setPref('usageLastDay', today);
}

async function getNudgeState() {
  return {
    shareListenMin: await storage.getPref('nudgeShareListenMin', 0),
    dayCount: await storage.getPref('usageDayCount', 0),
    listenedEver: await storage.getPref('usageListenedEver', false),
    shareSeen: await storage.getPref('nudgeShareSeen', false),
    supportSeen: await storage.getPref('nudgeSupportSeen', false),
  };
}

// Audible-minute accumulator. Gated exactly like listen-heartbeat.js: count a
// minute only while playback is actually audible (buffering/paused never
// count). Mirrors that module rather than sharing state so analytics and
// nudges stay decoupled.
function attachAudibleAccumulator(player, onMinute) {
  let timer = null;
  let audible = false;

  const tick = async () => {
    if (!audible || !player.isPlaying()) return;
    const min = (await storage.getPref('nudgeShareListenMin', 0)) + 1;
    await storage.setPref('nudgeShareListenMin', min);
    if (!(await storage.getPref('usageListenedEver', false))) {
      await storage.setPref('usageListenedEver', true);
    }
    onMinute(min);
  };

  const start = () => {
    audible = true;
    if (!timer) timer = setInterval(tick, 60_000);
  };
  const stop = () => {
    audible = false;
    if (timer) clearInterval(timer);
    timer = null;
  };

  player.on('playing', start);
  player.on('loading', () => { audible = false; });
  player.on('paused', stop);
  player.on('stopped', stop);
  player.on('error', stop);
}

export function mountNudges({ player }) {
  trackUsageDay();
  attachAudibleAccumulator(player, () => {
    // Live re-check hook — wired to the selector in Task 2.
  });
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import alongside the other UI imports (after line 47, `attachListenHeartbeat`):

```javascript
import { mountNudges } from './ui/nudges.js';
```

Add the mount call right after `attachListenHeartbeat(player);` (line 71):

```javascript
mountNudges({ player });
```

- [ ] **Step 3: Verify the tracker persists (behavioural)**

Start the dev server and drive it via the Browser MCP:
- `preview_start` `{ name: "dev" }` (create `.claude/launch.json` with an entry `{ name: "dev", runtimeExecutable: "npm", runtimeArgs: ["run","dev"], port: 5173 }` if none exists).
- After load, run via `javascript_tool`:

```javascript
// Read the two day-tracking prefs straight from IndexedDB.
const db = await new Promise(r => { const q = indexedDB.open('radiodock'); q.onsuccess = () => r(q.result); });
const val = (k) => new Promise(r => { const t = db.transaction('prefs').objectStore('prefs').get(k); t.onsuccess = () => r(t.result?.value); });
JSON.stringify({ day: await val('usageLastDay'), count: await val('usageDayCount') });
```

Expected: `usageLastDay` is today's date and `usageDayCount` is `1` on first ever load. Reloading the same day keeps count at `1`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/nudges.js src/main.js .claude/launch.json
git commit -m "Nudges: usage-day tracker + audible-minute accumulator"
```

---

### Task 2: Eligibility, selection, session guard, dev overrides (no UI)

**Files:**
- Modify: `src/ui/nudges.js`

**Interfaces:**
- Consumes: `getNudgeState()` (Task 1).
- Produces: `selectNudge(state) -> 'share' | 'support' | null`; `markSeen(id)`; an in-memory `shownThisSession` guard; `evaluateNudges()` (called at boot + after each audible minute); `window.__nudgeDebug` with `state()`, `reset()`, `forceShare()`, `forceSupport()`. A `REGISTRY` object keyed by id; Task 3+ fill each entry's rendering/action. For now each entry is `{ id }` and `evaluateNudges` logs the selected id.

- [ ] **Step 1: Add selection + guard + registry to `src/ui/nudges.js`**

Add above `mountNudges`:

```javascript
// Registry of nudge definitions. Task 3+ add `content` + `mountActions` to
// each entry; here they are id-only so selection logic can be verified first.
const REGISTRY = {
  share: { id: 'share' },
  support: { id: 'support' },
};

function selectNudge(state) {
  // Priority: share (softer ask) before support. One per session upstream.
  if (state.shareListenMin >= SHARE_LISTEN_MINUTES && !state.shareSeen) return 'share';
  if (state.dayCount >= SUPPORT_DAY_COUNT && state.listenedEver && !state.supportSeen) return 'support';
  return null;
}

async function markSeen(id) {
  if (id === 'share') await storage.setPref('nudgeShareSeen', true);
  else if (id === 'support') await storage.setPref('nudgeSupportSeen', true);
}

let shownThisSession = false;

async function evaluateNudges() {
  if (shownThisSession) return;
  const state = await getNudgeState();
  const id = selectNudge(state);
  if (!id) return;
  shownThisSession = true;
  await markSeen(id); // seen once = never again, even if the user ignores it
  track('nudge-shown', { id });
  // Task 3 replaces this log with showNudgeCard(REGISTRY[id]).
  console.info('[nudge] would show:', id);
}
```

- [ ] **Step 2: Call `evaluateNudges` at boot + after each audible minute**

Replace the body of `mountNudges` with:

```javascript
export function mountNudges({ player }) {
  trackUsageDay().then(evaluateNudges);
  attachAudibleAccumulator(player, () => { evaluateNudges(); });
  installDebugHooks();
}
```

Add the debug hooks helper (dev affordance — safe to ship, namespaced):

```javascript
// Manual test affordance. `__nudgeDebug.reset()` clears all nudge prefs;
// forceShare/forceSupport seed just enough state to make that card eligible,
// then re-run selection (clearing the session guard so it can show again).
function installDebugHooks() {
  window.__nudgeDebug = {
    async state() { return getNudgeState(); },
    async reset() {
      for (const k of ['nudgeShareListenMin', 'nudgeShareSeen', 'nudgeSupportSeen',
        'usageListenedEver', 'usageDayCount', 'usageLastDay']) {
        await storage.removePref(k);
      }
      shownThisSession = false;
    },
    async forceShare() {
      await storage.setPref('nudgeShareListenMin', SHARE_LISTEN_MINUTES);
      await storage.setPref('nudgeShareSeen', false);
      shownThisSession = false;
      await evaluateNudges();
    },
    async forceSupport() {
      await storage.setPref('usageDayCount', SUPPORT_DAY_COUNT);
      await storage.setPref('usageListenedEver', true);
      await storage.setPref('nudgeSupportSeen', false);
      shownThisSession = false;
      await evaluateNudges();
    },
  };
}
```

Note: `storage.removePref` already exists (`src/data/storage.js:214`).

- [ ] **Step 3: Verify selection logic (behavioural)**

Reload the preview, then via `javascript_tool`:

```javascript
await window.__nudgeDebug.reset();
await window.__nudgeDebug.forceShare();   // expect console: [nudge] would show: share
const a = await window.__nudgeDebug.state();
await window.__nudgeDebug.forceSupport();  // guard already tripped this session → no second log
await window.__nudgeDebug.reset();
await window.__nudgeDebug.forceSupport();  // expect console: [nudge] would show: support
JSON.stringify({ afterForceShare: a });
```

Confirm via `read_console_messages`: exactly one `would show: share` after the first force, none on the second force (session guard), then one `would show: support` after reset+forceSupport. Confirm `afterForceShare.shareSeen === true`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/nudges.js
git commit -m "Nudges: eligibility, one-per-session selection, dev hooks"
```

---

### Task 3: Card renderer + CSS (both regimes) + Share card

**Files:**
- Modify: `src/ui/nudges.js`
- Create: `src/styles/nudges.css`
- Modify: `src/styles/index.css` (add import after line 15)

**Interfaces:**
- Consumes: `REGISTRY`, `evaluateNudges` log site (Task 2), `track` (Task 1).
- Produces: `showNudgeCard(def)` renderer; `def.content = { icon, headline, body }` and `def.mountActions(actionsEl)` on registry entries; CSS classes `.nudge`, `.nudge--float`, `.nudge--banner`, `.nudge__close`, `.nudge__icon`, `.nudge__headline`, `.nudge__body`, `.nudge__actions`, `.nudge__btn`, `.is-entering`, `.is-dismissed`.

- [ ] **Step 1: Add icons, the renderer, and the Share definition to `nudges.js`**

Add near the top constants:

```javascript
const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0-12-4 4m4-4 4 4M5 14v4a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
const HEART_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 3C19.5376 3 22 5.5 22 9C22 16 14.5 20 12 21.5C9.5 20 2 16 2 9C2 5.5 4.5 3 7.5 3C9.35997 3 11 4 12 5C13 4 14.64 3 16.5 3Z" fill="currentColor"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

// Whatsapp / X / mail glyphs for the share fallback (Task 4 wires the clicks).
const WHATSAPP_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.02c-.25.7-1.44 1.33-1.98 1.38-.53.05-1.02.24-3.45-.72-2.9-1.14-4.73-4.1-4.88-4.29-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.26-.29.56-.36.75-.36l.54.01c.17 0 .4-.06.63.48.25.6.83 2.06.9 2.2.07.15.12.32.02.51-.1.19-.15.32-.29.49-.14.17-.3.39-.43.52-.14.14-.29.3-.12.58.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.15.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.63-.15.24.1 1.55.73 1.81.87.26.14.44.21.5.32.07.11.07.63-.18 1.33Z" fill="currentColor"/></svg>`;
const X_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2Zm-1.2 18h1.9L7.3 3.9H5.3L17.7 20Z" fill="currentColor"/></svg>`;
const MAIL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 3.2V18h16V8.2l-8 5-8-5Zm14.4-1.2H5.6L12 11l6.4-4Z" fill="currentColor"/></svg>`;
```

Add the renderer:

```javascript
// A nudge shows in one of two regimes. Banner regime (mobile + Electron
// standalone) inserts a slim bar above the station-list nav; float regime
// (desktop browser) drops a card bottom-left, opposite the install badge.
function isBannerRegime() {
  return document.documentElement.classList.contains('is-standalone')
    || window.matchMedia('(max-width: 699px)').matches;
}

function showNudgeCard(def) {
  document.getElementById('nudgeCard')?.remove();
  const banner = isBannerRegime();

  const el = document.createElement('section');
  el.className = `nudge ${banner ? 'nudge--banner' : 'nudge--float'} is-entering`;
  el.id = 'nudgeCard';
  el.setAttribute('role', 'complementary');
  el.innerHTML = `
    <button type="button" class="nudge__close" aria-label="Dismiss">${CLOSE_ICON}</button>
    <span class="nudge__icon" aria-hidden="true">${def.content.icon}</span>
    <div class="nudge__text">
      <span class="nudge__headline">${def.content.headline}</span>
      <span class="nudge__body">${def.content.body}</span>
    </div>
    <div class="nudge__actions"></div>
  `;

  if (banner) {
    const anchor = document.querySelector('.mobile-lists');
    anchor?.parentNode.insertBefore(el, anchor);
  } else {
    document.body.append(el);
  }

  def.mountActions(el.querySelector('.nudge__actions'));

  const dismiss = () => {
    el.classList.add('is-dismissed');
    track('nudge-dismissed', { id: def.id });
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('.nudge__close').addEventListener('click', dismiss);

  // Commit the entering state, then flip it off next frame so the CSS
  // transition runs. setTimeout (not RAF) so it still fires in a hidden tab.
  void el.offsetHeight;
  setTimeout(() => el.classList.remove('is-entering'), 20);

  return { dismiss };
}
```

Replace the `console.info('[nudge] would show:', id);` line in `evaluateNudges` with:

```javascript
  showNudgeCard(REGISTRY[id]);
```

Fill the Share registry entry (replace `share: { id: 'share' }`):

```javascript
  share: {
    id: 'share',
    content: { icon: SHARE_ICON, headline: 'Enjoying RadioDock?', body: 'Share it with someone.' },
    mountActions(el) {
      // Task 4 wires the share behaviour; placeholder button for now.
      el.innerHTML = `<button type="button" class="nudge__btn nudge__btn--primary" data-share>Share</button>`;
    },
  },
```

- [ ] **Step 2: Create `src/styles/nudges.css`**

```css
/* Nudge cards — two regimes share a base. Colors mirror install-section:
   a card fill just above --bg-dark, flips with the theme. */
.nudge {
  --nudge-bg: #141414;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  box-sizing: border-box;
  color: var(--text);
  background: var(--nudge-bg);
  transition: opacity 260ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
:root.theme-light .nudge { --nudge-bg: #DBDBDB; }

.nudge__close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: 0;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background 120ms ease, color 120ms ease;
}
.nudge__close:hover { background: var(--overlay-med); color: var(--text); }

.nudge__icon { flex: 0 0 auto; width: 20px; height: 20px; color: var(--text-muted); margin-top: 1px; }
.nudge__icon svg { width: 100%; height: 100%; display: block; }
.nudge__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.nudge__headline { font-weight: 600; font-size: 0.9rem; }
.nudge__body { font-size: 0.8rem; color: var(--text-muted); line-height: 1.35; }

.nudge__actions { display: flex; align-items: center; gap: 6px; }
.nudge__btn {
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--overlay-med);
  background: none;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  transition: background 120ms ease;
}
.nudge__btn:hover { background: var(--overlay-med); }
.nudge__btn--icon { padding: 6px; width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; }
.nudge__btn--icon svg { width: 16px; height: 16px; }

/* ---- Float regime: desktop browser, bottom-left ---- */
.nudge--float {
  position: fixed;
  left: 20px;
  bottom: 20px;
  z-index: 90;
  width: 300px;
  max-width: calc(100vw - 40px);
  flex-wrap: wrap;
  padding: 14px 16px;
  padding-right: 30px;
  border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
:root.theme-light .nudge--float { border-color: rgba(0, 0, 0, 0.08); }
.nudge--float .nudge__actions { flex-basis: 100%; margin-top: 10px; }
.nudge--float.is-entering { opacity: 0; transform: translateY(8px) scale(0.98); }
.nudge--float.is-dismissed { opacity: 0; transform: translateY(8px) scale(0.98); pointer-events: none; }

/* ---- Banner regime: mobile + Electron, slim bar above the list nav ---- */
.nudge--banner {
  position: relative;
  align-items: center;
  margin: 0 0 10px;
  padding: 10px 34px 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
  max-height: 120px;
  transition: max-height 300ms cubic-bezier(0.22, 1, 0.36, 1),
              opacity 260ms ease,
              margin 300ms cubic-bezier(0.22, 1, 0.36, 1),
              padding 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
:root.theme-light .nudge--banner { border-color: rgba(0, 0, 0, 0.08); }
.nudge--banner .nudge__body { display: none; } /* slim bar: headline + action only */
.nudge--banner .nudge__actions { margin-left: auto; }
.nudge--banner.is-entering,
.nudge--banner.is-dismissed {
  max-height: 0;
  opacity: 0;
  margin-bottom: 0;
  padding-top: 0;
  padding-bottom: 0;
  border-width: 0;
}
```

- [ ] **Step 3: Register the stylesheet**

In `src/styles/index.css`, add after line 15 (`@import './install-section.css';`):

```css
@import './nudges.css';
```

- [ ] **Step 4: Verify the Share card renders in both regimes (behavioural)**

Reload the preview (desktop viewport), then `javascript_tool`:

```javascript
await window.__nudgeDebug.reset();
await window.__nudgeDebug.forceShare();
document.getElementById('nudgeCard')?.className;
```

Expected: returns a string containing `nudge nudge--float` and NOT `is-entering` (after the 20ms flip). Use `read_page` to confirm the headline "Enjoying RadioDock?" is present and the card sits bottom-left. Click the `.nudge__close` (via `computer`) and confirm the element leaves the DOM after ~300ms.

Then switch to mobile: `resize_window` `{ preset: "mobile" }`, reload, repeat `forceShare()`, and confirm `document.getElementById('nudgeCard').className` contains `nudge--banner` and the element is inserted immediately before `.mobile-lists` (check `document.querySelector('.mobile-lists').previousElementSibling.id === 'nudgeCard'`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/nudges.js src/styles/nudges.css src/styles/index.css
git commit -m "Nudges: card renderer + CSS regimes + share card shell"
```

---

### Task 4: Share action — native share sheet + fallback + analytics

**Files:**
- Modify: `src/ui/nudges.js`

**Interfaces:**
- Consumes: the Share registry entry's `mountActions(el)` (Task 3), `APP_SHARE_URL`, icons, `track`.
- Produces: full share behaviour. `track('nudge-share', { method })` where method ∈ `native|copy|whatsapp|x|mail`.

- [ ] **Step 1: Replace the Share entry's `mountActions` in `nudges.js`**

```javascript
    mountActions(el) {
      if (typeof navigator.share === 'function') {
        el.innerHTML = `<button type="button" class="nudge__btn nudge__btn--primary" data-share>Share</button>`;
        el.querySelector('[data-share]').addEventListener('click', async () => {
          try {
            await navigator.share({ title: 'RadioDock', url: APP_SHARE_URL });
            track('nudge-share', { method: 'native' });
          } catch (_) { /* user cancelled the sheet — no-op */ }
        });
        return;
      }
      // Fallback (desktop Firefox etc.): copy + direct targets.
      const msg = encodeURIComponent(`RadioDock — free internet radio on every device: ${APP_SHARE_URL}`);
      el.innerHTML = `
        <button type="button" class="nudge__btn" data-copy>Copy link</button>
        <a class="nudge__btn nudge__btn--icon" data-m="whatsapp" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener" aria-label="Share on WhatsApp">${WHATSAPP_ICON}</a>
        <a class="nudge__btn nudge__btn--icon" data-m="x" href="https://twitter.com/intent/tweet?text=${msg}" target="_blank" rel="noopener" aria-label="Share on X">${X_ICON}</a>
        <a class="nudge__btn nudge__btn--icon" data-m="mail" href="mailto:?subject=${encodeURIComponent('RadioDock')}&body=${msg}" aria-label="Share by email">${MAIL_ICON}</a>
      `;
      const copyBtn = el.querySelector('[data-copy]');
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(APP_SHARE_URL); } catch (_) {}
        copyBtn.textContent = 'Link copied!';
        track('nudge-share', { method: 'copy' });
      });
      el.querySelectorAll('a[data-m]').forEach((a) => {
        a.addEventListener('click', () => track('nudge-share', { method: a.dataset.m }));
      });
    },
```

- [ ] **Step 2: Verify both share paths (behavioural)**

Native path (desktop Chrome/preview supports `navigator.share`): reload, `forceShare()`, confirm the single "Share" button exists (`read_page`). Analytics buffer to `window.__analyticsDebug` in dev — click Share (`computer`) and, if the browser's share sheet blocks, instead assert the click handler is wired by checking `typeof navigator.share`.

Fallback path: force it via `javascript_tool` before forcing the card:

```javascript
await window.__nudgeDebug.reset();
Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
await window.__nudgeDebug.forceShare();
const btns = [...document.querySelectorAll('#nudgeCard .nudge__actions .nudge__btn')].map(b => b.getAttribute('aria-label') || b.textContent);
btns; // expect ["Copy link","Share on WhatsApp","Share on X","Share by email"]
```

Click "Copy link" (`computer`) and confirm its text changes to "Link copied!" and `window.__analyticsDebug` contains a `nudge-share` event with `method: 'copy'`.

- [ ] **Step 3: Commit**

```bash
git add src/ui/nudges.js
git commit -m "Nudges: share action (native sheet + copy/social fallback)"
```

---

### Task 5: Support card + Ko-fi action + analytics + end-to-end verification

**Files:**
- Modify: `src/ui/nudges.js`

**Interfaces:**
- Consumes: renderer + registry (Task 3), `SUPPORT_URL`, `HEART_ICON`, `track`.
- Produces: full Support card. `track('nudge-support-click')`.

- [ ] **Step 1: Fill the Support registry entry (replace `support: { id: 'support' }`)**

```javascript
  support: {
    id: 'support',
    content: {
      icon: HEART_ICON,
      headline: "You're a power user!",
      body: 'RadioDock is free & ad-free. Help keep the server alive and support the project.',
    },
    mountActions(el) {
      el.innerHTML = `<a class="nudge__btn nudge__btn--primary" href="${SUPPORT_URL}" target="_blank" rel="noopener" data-support>Support</a>`;
      el.querySelector('[data-support]').addEventListener('click', () => track('nudge-support-click'));
    },
  },
```

- [ ] **Step 2: Verify the Support card (behavioural)**

Desktop viewport: reload, then `javascript_tool`:

```javascript
await window.__nudgeDebug.reset();
await window.__nudgeDebug.forceSupport();
const card = document.getElementById('nudgeCard');
const link = card.querySelector('[data-support]');
JSON.stringify({ headline: card.querySelector('.nudge__headline').textContent, href: link.href, target: link.target });
```

Expected: headline `You're a power user!`, href `https://ko-fi.com/radiodock`, target `_blank`. Confirm the heart icon renders (`read_page`). Click Support and confirm `window.__analyticsDebug` gains a `nudge-support-click` event (the new tab may be blocked by the preview — the analytics event is the proof).

- [ ] **Step 3: End-to-end — priority + one-per-session + persistence**

Via `javascript_tool`:

```javascript
await window.__nudgeDebug.reset();
// Make BOTH eligible at once; share must win.
await window.__nudgeDebug.forceSupport();          // seeds support eligibility (shows support, trips guard)
```

Then reload and run the true tie test:

```javascript
await window.__nudgeDebug.reset();
const db = await new Promise(r => { const q = indexedDB.open('radiodock'); q.onsuccess = () => r(q.result); });
const put = (k, v) => new Promise(r => { const t = db.transaction('prefs','readwrite').objectStore('prefs').put({ key: k, value: v }); t.onsuccess = () => r(); });
await put('nudgeShareListenMin', 5);
await put('usageDayCount', 3);
await put('usageListenedEver', true);
location.reload();
```

After reload: exactly ONE card shows and it is the **Share** card (priority). Confirm `document.getElementById('nudgeCard').querySelector('.nudge__headline').textContent === 'Enjoying RadioDock?'`. Reload again: NO card (share now `Seen`, support still needs its own qualifying session but guard/`Seen` semantics mean support shows only next session — confirm no card appears on this immediate reload because `nudgeShareSeen` is set and support was never marked seen; on a *fresh* reload support SHOULD now appear). Verify: after one more reload, the **Support** card appears.

- [ ] **Step 4: Verify standalone/banner regime end-to-end**

Force standalone: `javascript_tool` → `document.documentElement.classList.add('is-standalone')`, then `await window.__nudgeDebug.reset(); await window.__nudgeDebug.forceSupport();`. Confirm the card mounts as `.nudge--banner` immediately above `.mobile-lists` and animates its height open. Dismiss and confirm it collapses (max-height → 0) then removes.

- [ ] **Step 5: Commit**

```bash
git add src/ui/nudges.js
git commit -m "Nudges: support card + Ko-fi action; end-to-end verified"
```

---

## Self-Review

**Spec coverage:**
- System/registry → Task 2/3. ✅
- Usage-day + audible-minute triggers → Task 1. ✅
- Eligibility (share 5min; support 3 days + listened) → Task 2. ✅
- Frequency (1/session, seen-once, priority) → Task 2, verified Task 5. ✅
- Placement (float bottom-left; banner above `.mobile-lists`) + transitions → Task 3. ✅
- Copy verbatim → Tasks 3/5. ✅
- Share native + fallback → Task 4. ✅
- Support Ko-fi, no iframe → Task 5. ✅
- Analytics events → Tasks 2/3/4/5. ✅
- Tunables block → Task 1. ✅

**Placeholder scan:** The Task 3 Share `mountActions` is a deliberate shell explicitly replaced in Task 4 (noted inline); no dangling TODOs elsewhere. ✅

**Type consistency:** `getNudgeState()` shape, `selectNudge`/`markSeen`/`evaluateNudges`/`showNudgeCard` names, registry entry shape `{ id, content:{icon,headline,body}, mountActions }`, and pref keys are consistent across Tasks 1–5. `storage.removePref` confirmed to exist. ✅
