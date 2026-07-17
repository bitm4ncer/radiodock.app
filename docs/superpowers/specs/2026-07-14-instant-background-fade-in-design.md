# Instant Default Background + Fade-Slide-In — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Repo:** `radiodock.app` (PWA)

## Problem

On the desktop-browser layout the wallpaper appears only after a visible delay: `mountBackground()` runs `discoverBuiltins()`, which does **10 sequential HEAD requests** (`/backgrounds/background_00…09.webp`, stopping after two consecutive 404s) and only paints the image *after* that probe + a preload. On a slow connection the viewport sits blank/dark for seconds, so the page reads as empty on first paint.

Production has `background_01…07.webp` (200); `00`, `08`, `09` are 404. The first-time default is `builtin:04` (`background_04.webp`, present).

## Goals

1. **Default wallpaper is on screen at first paint** — the page looks full immediately, with no wait for the probe. (Desktop-browser regime only; mobile / installed PWA keep the dark `#1a1a1a` background as today.)
2. **The player card and the install element (the larger one at top-right) load a beat later but fade + slide in** rather than popping in.

Non-goal: changing the background feature's behavior (cycling, gallery, shuffle, uploads, per-user restore) beyond removing the probe from the first-paint critical path.

## Part A — Instant default background

- Paint the default wallpaper (`/backgrounds/background_04.webp`) via a **render-blocking CSS rule** so it shows before any JS runs — no probe, no JS layer needed for the first frame. Applied only in the desktop-browser regime (the same gate `background.js` uses to mount: `pointer: fine`, not `is-standalone`, `display-mode: browser`), so mobile/standalone are untouched.
  - Implementation: a rule in the background stylesheet setting the default image on the body (or a dedicated always-present base layer), `background-size: cover; background-position: center`, matched to the `.app-background` look.
- `mountBackground()` is unchanged in what it does, but the probe **no longer gates the first visible frame** — the CSS default is already showing. On mount, after the saved state resolves:
  - First-time user → resolved image is `builtin:04`, identical to the CSS default → no visible change.
  - Returning user → the JS layer **crossfades** from the CSS default to their saved pick (use the existing two-layer crossfade, i.e. the first `applyCurrent` fades in rather than `instant: true`), so there is no hard swap or flash.
- The probe still runs (in the background) to build the gallery / enable cycling — it just isn't on the first-paint path anymore.

## Part B — Fade-slide-in for player card + install element

- **Player card** (`#playerCard`, already gets a `.loaded` class in `main.js`): start at `opacity: 0` + a small downward `translateY`; `.loaded` transitions to `opacity: 1; transform: none` with a short ease (fade + slide-up).
- **Install element** (the larger install popup at top-right — pin the exact selector against the current `install-section.js` / its container at implementation time): same fade + slide-in when it appears. If it has no mount/appear hook yet, add a `.is-in` (or reuse an existing) class toggled on show and drive the transition from it.
- Keep it subtle (short duration, small travel) and respect `prefers-reduced-motion` (no transform/opacity animation when reduced motion is requested — appear instantly).

## Constraints

- Mobile-first CSS rules; desktop treatment via the existing regime gate. Don't show the wallpaper on mobile/standalone.
- Reuse existing classnames/layers; no new dependencies.
- Coordinate with the concurrent session's in-flight changes to `index.html` / install UI — implement on a fresh worktree from the latest `origin/main` and pin the install selector to whatever ships there.

## Verification (Claude Preview)

- Fresh desktop-browser load: the wallpaper is present in the very first rendered frame (before the probe completes) — verify the base rule paints `background_04.webp` with no gated wait; console shows no blank-background window.
- Player card + install element animate in (opacity/transform transition present; check computed styles land at the visible end state).
- `prefers-reduced-motion: reduce`: elements appear without the animation.
- Mobile / `?pwa=1` (standalone): no wallpaper, dark background unchanged.

## Out of scope

- Preloading / bundling the default image differently (e.g. inlining) — a plain `<link rel="preload">` or the CSS rule is enough.
- Changing which image is the default, or the probe mechanism itself.
