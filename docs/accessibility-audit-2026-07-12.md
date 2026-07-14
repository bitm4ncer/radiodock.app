# Accessibility Audit: RadioDock PWA

**Standard:** WCAG 2.1 AA · **Date:** 2026-07-12 · **Focus:** usability for blind / screen-reader users

Method: static review of `index.html` + `src/ui/*`, `src/styles/tokens.css`; plus a live pass in Chromium via the Claude Preview accessibility tree, computed styles, and contrast math. Findings marked **[live]** were confirmed against the running app; **[code]** are from source inspection.

> ⚠️ **Headline:** a blind user currently **cannot play a station**. Every station-list and search-result row is a non-interactive `<div>` — invisible to the keyboard and announced as plain text with no role. This is the single most important thing to fix; almost everything else is secondary to it.

---

## Summary

**Issues found:** 17 · **🔴 Critical:** 4 · **🟡 Major:** 8 · **🟢 Minor:** 5

The app has real accessibility groundwork — semantic landmarks (`<main>`, `<nav>`, `<aside>`, `<footer>`), `aria-label` on most icon buttons, a `role="status"` live toast, a `role="slider"` volume control with value attributes, `:focus-visible` rings on several components, and `lang="en"`. The gaps cluster in four areas: **(1) the core lists aren't operable at all without a mouse, (2) dynamic changes aren't announced, (3) several focus indicators are suppressed with no replacement, and (4) a handful of contrast + zoom problems.**

---

## Findings

### Perceivable

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| 1 | **Zoom disabled.** Viewport meta sets `maximum-scale=1, user-scalable=no` — pinch-zoom is blocked, and `src/main.js` additionally swallows gesture/double-tap zoom. Low-vision users can't enlarge. `index.html:5`, `main.js:82-105` | 1.4.4 / 1.4.10 | 🟡 Major | Remove `maximum-scale`/`user-scalable=no`; drop the zoom-blocking gesture handlers (they exist to stop iOS double-tap zoom on controls — solve that with `touch-action` instead of killing zoom globally). |
| 2 | **Volume dots invisible as a control.** Idle dots are `--bg-dark #0D0D0D` on `--bg #1A1A1A` = **1.12:1** [live]; filled dots `--bg-light #696969` = **3.17:1**. Non-text UI needs ≥3:1. | 1.4.11 | 🟡 Major | Raise idle-dot colour to ≥3:1 against the background; the filled state is borderline — bump it too. |
| 3 | **Low-contrast link/muted text.** `.visit-btn` uses `--bg-light` → **3.17:1** on dark [live] (fails 4.5:1 for the station homepage link). Light theme `--bg-light #888888` on `#E1E1E1` = **2.71:1** [live]. `--red #cd0025` on dark = **3.0:1** — fails as text (danger labels, muted-icon red). | 1.4.3 | 🟡 Major | Use `--text-muted` (7.23:1 [live]) for the visit link; darken/lighten `--bg-light` per theme for any text use; ensure red is only used for ≥3:1 non-text or paired with a text-safe tone. |
| 4 | **Logo images render as the row's only "button".** Each row's `logo-cycle-btn` ("Switch logo source") is the sole named control the screen reader surfaces per row [live], while the station itself is inert text. The logo `<img alt="">` is correctly decorative, but the cycle button dominates the row's semantics. | 1.3.1 | 🟢 Minor | Resolve alongside #5 — once rows are real buttons, drop the cycle button out of the primary tab/reading path (it's already `tabindex="-1"`; also `aria-hidden` it until the row is focused). |

### Operable

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| 5 | **🔴 Station rows are not operable.** `stationRow()` renders `<div class="station-item" data-id>` with a delegated click handler — **no `role`, no `tabindex`, no key handler** [live: 78 rows, each `role=none` + StaticText]. Keyboard and screen-reader users cannot play any station. Same pattern in search results (`<div class="search-item">`). `station-list.js:30-40`, `search.js:27-37` | 2.1.1, 4.1.2 | 🔴 Critical | Make each row a `<button>` (or `role="button" tabindex="0"` + Enter/Space handler) with an accessible name like "Play NTS Radio 1, GB". Keep the row's remove/drag as nested buttons. This is the top priority. |
| 6 | **🔴 Primary controls have no visible focus.** `.play-pause-btn` sets `outline: none` with **no `:focus-visible` replacement** `player-card.css:47` [code]. Keyboard users can't see where focus is on the main play control (and likely the icon buttons). | 2.4.7 | 🔴 Critical | Add a global `:focus-visible` ring (e.g. `outline: 2px solid var(--text); outline-offset: 2px`) and stop removing outlines without a replacement. Audit every `outline: none` (`modals.css`, `notes.css`, `search.css`, `player-card.css`). |
| 7 | **🔴 Modals don't trap or restore focus, and don't hide the background.** `openModal` focuses the first field but Tab can leave into the page behind; on close, focus isn't returned to the trigger; background content isn't `inert`/`aria-hidden`, so a screen reader wanders behind the dialog. `.modal` elements also lack `role="dialog"`/`aria-modal`/`aria-labelledby`. `modals.js:10-27` | 2.4.3, 1.3.1, 4.1.2 | 🔴 Critical | Add `role="dialog" aria-modal="true" aria-labelledby="<title id>"` to each `.modal`; trap Tab within the open modal; set the app container `inert` while open; restore focus to the opener on close. (The off-canvas drawer already models `role="dialog" aria-modal` — mirror it.) |
| 8 | **List reorder is drag-only.** Pointer long-press / drag handle with no keyboard path. `station-list.js` | 2.1.1 | 🟢 Minor | Non-essential (order is convenience), but add "move up / move down" via keyboard on the drag handle, or document it as out of scope. |
| 9 | **No skip link.** Keyboard users tab through the whole header/list before reaching search. | 2.4.1 | 🟢 Minor | Add a visually-hidden "Skip to search / stations" link as the first focusable element. |
| 10 | **Reduced-motion coverage is thin.** Only the now-playing marquee honours `prefers-reduced-motion` `player-card.css:259` [code]. The lists carousel auto-snap, spinners, modal/toast transitions, and theme cross-fade don't. | 2.3.3 (AAA) / 2.2.2 | 🟢 Minor | Wrap non-essential animation in `@media (prefers-reduced-motion: reduce)`. |

### Understandable

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| 11 | **Search input has no accessible name.** Only a `placeholder`; no `<label>`/`aria-label` [live: node announced as bare `textbox`]. `index.html:354` | 3.3.2, 1.3.1, 4.1.2 | 🟡 Major | Add `aria-label="Search stations"` (or a visually-hidden `<label for="searchInput">`). Placeholder is not a name. |
| 12 | **No page heading structure.** The document has no `<h1>` [live]; the main sections (`player-section`, `favorites-section`, `search-section`) have no accessible names. Modals use `h3`/`h4` only. | 1.3.1, 2.4.6 | 🟡 Major | Add an `<h1>` (can be visually-hidden: "RadioDock — internet radio player") and `aria-label` the primary sections so a screen reader can navigate by region/heading. |
| 13 | **Filter tabs don't expose selected state.** Name/Genre/Country are `<button>`s with a visual `.active` class only — no `aria-pressed`/`role="tab"`+`aria-selected` [code]. `index.html:358-362` | 4.1.2 | 🟢 Minor | Add `aria-pressed` (toggle-button model) or convert to a real `tablist`. |

### Robust

| # | Issue | WCAG | Severity | Recommendation |
|---|-------|------|----------|----------------|
| 14 | **🟡 Dynamic changes are not announced.** Search results (count / "No matches" / error), the "Searching…" loading state, and now-playing track changes update silently — no `aria-live` region [code: `search.js` writes `innerHTML`; `#nowPlaying` has no live attr]. A blind user typing a query gets no feedback that results arrived. (The toast **is** correct: `role="status" aria-live="polite"` `index.html:406`.) | 4.1.3, 1.3.1 | 🟡 Major | Make `#searchResults` (or a dedicated status node) `aria-live="polite"` and write a short summary ("12 stations found" / "No matches"). Consider a polite live region for now-playing, throttled so it isn't chatty. |
| 15 | **Favorite toggle doesn't expose state.** `#addToFavoritesBtn` has `title="Add to favorites"` but **no `aria-pressed`**, and the name doesn't change when favorited [live: `aria-pressed` = null]. `index.html:217`, `player-card.js:290-292` | 4.1.2 | 🟡 Major | Add `aria-pressed` and flip the label Add/Remove in `setFavoriteState`. |
| 16 | **Volume: focusable buttons inside a slider + duplicate "Mute".** `role="slider"` container holds 12 focusable `<button>`s [live] — a slider must be a leaf. The mute button and the 0% dot are **both** announced "Mute" (two adjacent identical controls). Redundant tab stops and confusing output. `index.html:253-268` | 1.3.1, 4.1.2 | 🟡 Major | Pick one model: either a real `role="slider"` (single focusable element, arrow-key handled, `aria-valuetext="80 percent"`, dots `aria-hidden`) — keyboard.js already maps ↑/↓ globally — **or** a labelled group of buttons (drop `role="slider"`). Don't do both. Relabel the 0% dot ("Volume 0%") so it doesn't collide with the mute button. |
| 17 | **Dropdown button missing `aria-haspopup`.** `#listDropdownBtn` toggles `aria-expanded` (good, `list-dropdown.js:54-60`) but has no `aria-haspopup="menu"`. `index.html:310` | 4.1.2 | 🟢 Minor | Add `aria-haspopup`. |

---

## Color Contrast Check *(computed live in Chromium)*

| Element | Foreground | Background | Ratio | Required | Pass? |
|---------|-----------|------------|-------|----------|-------|
| Body text | `--text #E0E0E0` | `--bg #1A1A1A` | 13.18:1 | 4.5:1 | ✅ |
| Muted / country code | `--text-muted #a7a7a7` | `#1A1A1A` | 7.23:1 | 4.5:1 | ✅ |
| Visit-station link | `--bg-light #696969` | `#1A1A1A` | 3.17:1 | 4.5:1 | ❌ |
| Muted text (light theme) | `--bg-light #888888` | `#E1E1E1` | 2.71:1 | 4.5:1 | ❌ |
| Red as text | `--red #cd0025` | `#1A1A1A` | 3.00:1 | 4.5:1 | ❌ |
| Volume dot, idle (UI) | `#0D0D0D` | `#1A1A1A` | 1.12:1 | 3:1 | ❌ |
| Volume dot, filled (UI) | `#696969` | `#1A1A1A` | 3.17:1 | 3:1 | ✅ (borderline) |

## Keyboard Navigation

| Element | In tab order | Enter/Space | Escape | Arrows |
|---------|--------------|-------------|--------|--------|
| Station list row | ❌ **not reachable** | ❌ none | — | — |
| Search result row | ❌ **not reachable** | ❌ none | — | — |
| Play/Pause | ✅ (but no visible focus) | ✅ toggles | — | — |
| Volume | ✅ slider + 12 buttons | dots set level | — | ✅ ↑/↓ global (keyboard.js) |
| Search input | ✅ | — | — | — |
| Modal | first field focused | ✅ | ✅ closes all | — |
| Global shortcuts | Space/↑/↓ / M / `/` (keyboard.js — guarded while typing / modal open) | | | |

## Screen Reader (Chromium a11y tree)

| Element | Announced as | Issue |
|---------|-------------|-------|
| Station row | "NTS Radio 1" + "GB" as **static text**, row = `none` | Not a control — can't be played |
| Row logo button | "Switch logo source", button | Row's only named control; misleading focus |
| Search input | "textbox" (no name) | No label |
| Favorite | "Add to favorites", button | No pressed state, name never flips |
| Volume | slider "Volume" value 100, then 12 buttons incl. two "Mute" | Slider-with-children antipattern + duplicate name |
| Page | RootWebArea only, no `h1` | No heading/region names to navigate by |
| Now-playing / search status | (silent) | No live region |

---

## Priority Fixes

1. **🔴 Make list & search rows real controls** (#5) — a `<button>` per row named "Play {station}, {country}". Unblocks the core task for keyboard and screen-reader users. *Nothing else matters until this lands.*
2. **🔴 Restore visible focus** (#6) — global `:focus-visible` ring; stop suppressing outlines without a replacement.
3. **🔴 Fix modal semantics + focus management** (#7) — `role="dialog"`, focus trap, background `inert`, focus restore.
4. **🟡 Announce dynamic content** (#14) — `aria-live` on search results/status (and optionally now-playing).
5. **🟡 Label the search input** (#11) and **add an `<h1>` + region names** (#12).
6. **🟡 Favorite `aria-pressed`** (#15) and **resolve the volume slider/button model** (#16).
7. **🟡 Contrast + zoom** — raise volume-dot and low-contrast link/muted colours (#2, #3); re-enable pinch-zoom (#1).
8. **🟢 Polish** — skip link (#9), reduced-motion coverage (#10), filter-tab state (#13), `aria-haspopup` (#17), keyboard reorder (#8).

---

## Notes & caveats

- This is a strong first pass but **not a substitute for testing with real assistive tech.** Confirm with NVDA + Firefox and VoiceOver + Safari (especially the modal focus-trap behaviour and the volume-control decision).
- The mobile surfaces (off-canvas drawer, search overlay) already use `role="dialog"`/`aria-modal` and managed `aria-hidden` — good patterns to copy for the desktop modals in #7.
- Fixing #5 by making rows `<button>`s will interact with the existing pointer-based drag-reorder and the logo-cycle button (both nested) — plan the row markup so the primary action button doesn't swallow the nested controls' clicks (the codebase already handles this collision for the logo button via capture-phase `stopImmediatePropagation`).
