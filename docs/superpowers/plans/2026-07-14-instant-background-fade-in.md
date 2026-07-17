# Instant Default Background + Fade-Slide-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop wallpaper appear immediately (no probe delay) and give the player card + install badge a fade-slide-in on load.

**Architecture:** A render-blocking CSS rule paints the default wallpaper on `body` (desktop regime only) so it shows without waiting for `background.js`'s sequential HEAD probe; the JS layers then crossfade to the resolved image. The player card and the (already-built) install-section entry animation are enabled/tuned for first load. All animations respect `prefers-reduced-motion`.

**Tech Stack:** Vanilla JS, Vite 5, CSS. No test framework — verify via Claude Preview.

## Global Constraints

- Desktop-browser regime only for the wallpaper (`@media (pointer: fine)` + `html:not(.is-standalone)`); mobile / installed PWA keep the dark `#1a1a1a` background.
- Default wallpaper is `/backgrounds/background_04.webp` (present on prod; `builtin:04` is the existing first-time default).
- Reuse existing classes (`.app-background`, `.player-card.loaded`, `.install-section.is-entering`); no new deps.
- Coordinate with the concurrent session's `index.html` / install churn — work on a fresh worktree from latest `origin/main`; re-check the exact selectors against the worktree code before editing.
- No auto-deploy — hand off for the user's local test.

---

### Task 1: Instant default wallpaper (desktop) + crossfade takeover

**Files:**
- Modify: `src/styles/background.css` (add a body default rule)
- Modify: `src/ui/background.js` (mount: first apply crossfades instead of instant)

- [ ] **Step 1: Add the render-blocking default on `body`, desktop regime only**

In `src/styles/background.css`, near the `.app-background` block, add:

```css
/* Default wallpaper painted immediately (before background.js probes builtins),
   so the desktop page never shows a blank/dark window on first paint. Gated to
   the same regime background.js mounts in (pointer:fine, not standalone). The
   JS .app-background layers sit above this and take over once resolved. */
@media (pointer: fine) {
  html:not(.is-standalone) body {
    background-image: url('/backgrounds/background_04.webp');
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
    background-attachment: fixed;
  }
}
```

- [ ] **Step 2: Make the first `applyCurrent` crossfade (so returning users don't hard-swap from the default)**

In `src/ui/background.js`, in `mountBackground()`, change the mount-time apply from instant to a fade:

```js
  await applyCurrent();
```

(was `await applyCurrent({ instant: true });`) — the incoming JS layer now fades in over the CSS default: first-time users fade 04-over-04 (invisible), returning users crossfade from the default to their saved pick. Everything else in `mountBackground` is unchanged; the probe still runs but no longer gates the first visible frame.

- [ ] **Step 3: Verify (Claude Preview, desktop)**

- Fresh desktop load: `preview_eval` `getComputedStyle(document.body).backgroundImage` includes `background_04.webp` (present before/without the probe). Throttle network in devtools-style isn't available, but confirm the rule matches and the console shows no long blank-bg window.
- After mount, `preview_eval` a `.app-background.is-visible` layer exists with a background image.
- `?pwa=1` (standalone) and mobile viewport: `getComputedStyle(document.body).backgroundImage` is `none` (wallpaper gated off).

- [ ] **Step 4: Commit**

```bash
git add src/styles/background.css src/ui/background.js
git commit -m "perf(background): paint default wallpaper instantly, crossfade takeover"
```

---

### Task 2: Player card fade-slide-in

**Files:**
- Modify: `src/styles/player-card.css:17-24`

- [ ] **Step 1: Turn the plain opacity reveal into a fade + slide**

Replace the existing player-card reveal (currently `opacity: 0; transition: opacity 0.1s ease;` → `.player-card.loaded { opacity: 1; }`) with:

```css
.player-card {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 420ms cubic-bezier(0.22, 1, 0.36, 1),
              transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.player-card.loaded {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .player-card { transition: none; transform: none; }
}
```

(Keep any other existing `.player-card` / `.player-card.loaded` declarations; only the reveal opacity/transition lines change.)

- [ ] **Step 2: Verify (Preview)**

- On load, `preview_eval` `getComputedStyle(document.querySelector('.player-card')).transition` includes `transform`; after `.loaded` is added, `transform` computes to `none` (matrix identity) and opacity `1`.
- `prefers-reduced-motion: reduce` (Preview `resize_window` colorScheme won't set this; verify the media block exists in the built CSS) — transition none.

- [ ] **Step 3: Commit**

```bash
git add src/styles/player-card.css
git commit -m "feat(ui): player card fades + slides in on load"
```

---

### Task 3: Install badge fade-slide-in on first load

**Files:**
- Modify: `src/main.js` (initial `mountInstallSection` call, ~line 295)
- Modify: `src/styles/install-section.css` (reduced-motion guard)

- [ ] **Step 1: Enable the existing entry animation on the auto-mount**

The install section already animates in when `animateIn: true` (footer re-summon uses it; `.is-entering` → transition removes it). Add `animateIn: true` to the initial auto-mount call in `main.js` (the `mountInstallSection({ ... })` around line 295 that mounts on `document.body`):

```js
mountInstallSection({
  // ...existing options unchanged...
  animateIn: true,
});
```

(Re-check the exact call in the worktree before editing — the concurrent session may have adjusted its options; only add the `animateIn: true` property.)

- [ ] **Step 2: Respect reduced motion**

In `src/styles/install-section.css`, after the `.install-section` transition block, add:

```css
@media (prefers-reduced-motion: reduce) {
  .install-section { transition: none; }
  .install-section.is-entering { opacity: 1; transform: none; }
}
```

- [ ] **Step 3: Verify (Preview, desktop)**

- Fresh load: the install badge (`#installSection` / `.install-section`, fixed top-right) is briefly `.is-entering` then transitions in — `preview_eval` right after load shows it present; a moment later `.is-entering` is gone and computed `opacity` is `1`, `transform` `none`.
- No console errors.

- [ ] **Step 4: Commit**

```bash
git add src/main.js src/styles/install-section.css
git commit -m "feat(ui): install badge fades + slides in on first load"
```

---

## Self-Review

- **Spec coverage:** instant default wallpaper w/ desktop gate + crossfade takeover (Task 1); player-card fade-slide (Task 2); install element fade-slide on load (Task 3); `prefers-reduced-motion` guards (Tasks 2-3); mobile/standalone unchanged (Task 1 gate). All spec goals covered.
- **Placeholder scan:** "re-check the exact call/selectors in the worktree" is a real coordination step (concurrent churn), not a code placeholder. No TBD/TODO in code.
- **Type/selector consistency:** `.player-card.loaded`, `.install-section.is-entering` + `animateIn`, `.app-background`, `/backgrounds/background_04.webp` all verified against the current source.
