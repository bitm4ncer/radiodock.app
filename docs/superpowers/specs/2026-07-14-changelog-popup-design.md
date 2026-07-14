# "What's New" changelog popup — design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with the user

## Goal

A read-only popup that gives users a **complete, user-level tour of RadioDock's
features**, organised as a **changelog by release** (newest first). It doubles as
a "what's new" surface: a small "new" dot on the entry points nudges returning
users to re-open it after an update. A welcome banner frames the app as an
open, evolving project — stating plainly that new features ship as live betas,
tested in production — and invites the community to file issues.

Every description is written on a **user level** — what the feature does for you
and how to use it — never how it works technically.

## Decisions (locked)

| Question | Decision |
|---|---|
| Structure | **By release/version**, newest at top (a changelog timeline) |
| Scope of features | **Shipped only** — no beta/upcoming features, no "coming soon" |
| Card visuals | **Custom stroke SVG icon + text**. No emoji. No screenshots/GIFs |
| "New" dot on entry points | **Yes** — clears once opened, remembers last-seen on-device |
| Tape recording included? | **Yes** (desktop is live in production) |
| Entry-point label | **"What's New"** |
| Dates | **None** — version + name only |
| Surface type | **Modal "popup"** (About-modal pattern), not a draggable panel |
| Content source | **Hand-curated** from ROADMAP milestone history (reflects the commit history) |

## Content model

Content is a **data array** in `changelog.js`, rendered into cards. Adding a
future feature = a small edit to the array + bumping one revision constant.

### Release timeline (top → bottom)

Draft copy below; final wording tunable during build. `icon` names map to an
inline SVG set (stroke style, no emoji, `currentColor`).

**v2.7 · Cross-device sync**
- `sync` — **Sync across your devices** — "Scan a QR code (or paste a link) to connect your phone and computer. Your lists then stay in sync automatically — no account, and only your own devices can read them."

**v2.6 · Tape recording**
- `tape` — **Record straight to a note** — "Hit record on the player and RadioDock captures what you're hearing into a note, like a tape deck. Replay it inline or download it whenever you like."

**v2.5 · Faster controls**
- `keyboard` — **Quicker controls** — "Keyboard shortcuts for play, volume, search and mute; one-click mute; and scroll over the volume strip to fine-tune it. (Desktop.)"

**v2.4 · Notes & Diary**
- `note` — **Keep a radio diary** — "Tap capture and the station plus the track playing right now are saved into a timestamped note. Sort notes into pages, search them, and export anytime."

**v2.3 · Share a list**
- `share` — **Share a list by link** — "Send anyone a private link and they add your whole list of stations in one tap. No account, and the link's contents never touch a server."

**v2.0 · Rebuilt for every screen**
- `devices` — **At home on phone and desktop** — "Layouts tuned for each device — a focused mobile view and a roomy desktop one — so it feels native wherever you open it."

**v1.0 · The essentials** (six cards)
- `globe` — **50,000+ stations** — "Browse a community-curated directory of internet radio from all over the world."
- `search` — **Search** — "Find stations by name, genre, or country."
- `heart` — **Favorites & lists** — "Save stations into your own lists, reorder them by dragging — all stored on your device."
- `music` — **Now playing** — "See the current artist and track for stations that broadcast it."
- `lock` — **Background & lock-screen** — "Keeps playing when you switch apps or lock your phone — control it from the lock screen or your Bluetooth headphones."
- `install` — **Install & offline** — "Install RadioDock as an app on any device; the shell works offline after the first load."

### Deliberately excluded (with rationale)

- **v2.2 Usage analytics** — internal/dev-facing, not a user feature. Its privacy
  stance is folded into the modal footer line instead.
- **v2.1 Audio visualizer** — feature-flagged off in production, so excluded per
  "shipped only". Re-add a card when the flag flips.
- **v2.0 layout internals** (CSS regime split, footer reveal, etc.) — collapsed
  into the single "Rebuilt for every screen" card. Install is represented under
  v1.0.

### Icon set (stroke SVG, `currentColor`, no emoji)

`sync` (circular arrows) · `tape` (cassette / two reels) · `keyboard` (key row) ·
`note` (pencil on lines) · `share` (linked nodes) · `devices` (phone + monitor) ·
`globe` · `search` (magnifier) · `heart` · `music` (note) · `lock` ·
`install` (download-to-tray). Each ~20–24px inside a rounded tile.

## Visual spec

- **Modal** on the app's dark surface (`--bg #1A1A1A`); cards sit on `--bg-dark
  #0D0D0D` with a hairline `--divider` border. Inverts correctly in light theme
  via the existing tokens (never hard-code colours).
- **Release header:** quiet label — version (muted) + name — with a thin divider.
- **Card:** rounded icon tile (left) + title + one-sentence body. Comfortable
  vertical rhythm; the popup body scrolls.
- **"New" badge:** small pill using `--red #cd0025`, shown on the cards of the
  **newest release** — the first entry in the `CHANGELOG` array.
- **Welcome banner** (top): bordered callout, heading + one paragraph + a single
  CTA button.
- **Footer line** (bottom, muted): "Open source · no accounts · no tracking
  beyond anonymous, opt-out counts."

## Welcome / community banner

> **Built in the open.** Every new feature lands here as a beta — I ship early and
> test it live, in production, rather than behind closed doors. Expect the odd
> rough edge. Found a bug or have an idea? I'd love your help shaping where this
> goes.
>
> **[ Open an issue on GitHub → ]**

CTA is a real `<a href="https://github.com/bitm4ncer/radiodock.app/issues"
target="_blank" rel="noopener">`. The "new features are live betas" framing is the
core disclaimer — keep it explicit.

## Entry points + "new" dot

- **Footer (desktop):** a `What's New` pill immediately after `Sync`
  (`footer-pill footer-pill--sm`), mirroring `footerSyncBtn`.
- **Drawer (mobile):** a `What's New` item after `Sync` in `off-canvas__nav`,
  mirroring `offCanvasSync`.
- Both open the **same modal** (`openModal('changelogModal')`; close via
  backdrop / Escape / × — all already handled by `modals.js`).

### "New" dot logic

- `changelog.js` exports `CHANGELOG_REVISION` — a **manually-bumped integer**
  (starts at the count of releases; bump by 1 whenever a release is added).
  Decoupled from the version label so semver string-compare pitfalls
  (`2.7` vs `2.10`) never arise.
- On-device pref `changelogSeenRevision` (integer) via `storage.js`
  (`getPref`/`setPref`), **read/written only in `main.js`**.
- **Unseen** when `changelogSeenRevision` is missing or `< CHANGELOG_REVISION`
  → a small red dot (`aria-hidden`) shows on **both** entry points. Brand-new
  users and everyone's first exposure to this feature see the dot (drives
  discovery).
- Opening the popup (from either entry point) writes
  `changelogSeenRevision = CHANGELOG_REVISION` and hides both dots.
- Shipping a future feature: add to `CHANGELOG`, bump `CHANGELOG_REVISION` → the
  dot returns for everyone until they re-open.

## Architecture / module contracts

Follows existing conventions: UI module exposes `mount…()`; **only `main.js`
knows about both UI and data**; IndexedDB access never happens in a UI module.

- **`src/ui/changelog.js`** (new)
  - `export const CHANGELOG` — array of `{ version, name, features: [{ icon, title, body }] }`.
  - `export const CHANGELOG_REVISION` — integer.
  - `const ICONS` — `{ [name]: '<svg …>' }`.
  - `export function mountChangelog()` — renders banner + timeline + footer line
    into `#changelogBody` (idempotent). Returns `{ open() }`, where `open()`
    calls `openModal('changelogModal')`. **No pref access here.**
- **`src/styles/changelog.css`** (new) — imported at the same site as the other
  component CSS (mirror how `sync.css` is wired in). Reuses `.modal` structure;
  adds `.changelog-*` classes.
- **`index.html`**
  - `#changelogModal.modal` → `.modal-content` → `.modal-header` (logo + "What's
    New" title + `.modal-close-btn`) → `.modal-body#changelogBody` (empty; filled
    by `mountChangelog`).
  - Footer: `<button id="footerChangelogBtn" class="footer-pill footer-pill--sm">`
    with a `<span class="nav-dot" hidden>`.
  - Drawer: `<button id="offCanvasChangelog" class="off-canvas__item">` with a
    `<span class="nav-dot" hidden>`.
- **`src/main.js`**
  - `const changelog = mountChangelog();`
  - Read `changelogSeenRevision`; compute `unseen`; toggle both `.nav-dot`.
  - Wire `footerChangelogBtn` + `offCanvasChangelog` clicks →
    `changelog.open()` + `markChangelogSeen()`.
  - `markChangelogSeen()` → `setPref('changelogSeenRevision', CHANGELOG_REVISION)`
    + hide both dots.
  - `track('changelog-open')` on open (PROD-gated, per the analytics convention).

## Accessibility

- Modal focus/Escape/backdrop already handled by `modals.js`.
- Release sections are `<section>` with an `<h4>`/`<h3>` header; icons
  `aria-hidden`; the "New" badge has readable text.
- The "new" dot is decorative (`aria-hidden`); the button's accessible name stays
  "What's New".
- CTA is a real link with `rel="noopener"` and a visible focus state.

## Analytics

- `changelog-open` — fired on open (no other params). PROD-gated via the existing
  `track()` wrapper.

## Out of scope

- **No auto-open on launch** — discovery is via the entry points + dot only.
- No dates/timestamps, no screenshots/GIFs, no beta/upcoming features.
- No changes to the About modal (it keeps its short Features list; the changelog
  is the fuller, versioned tour). A future cross-link is out of scope.
- Content is hand-curated, not generated from git.

## Verification (Preview MCP, per project rule)

1. Footer pill **and** drawer item each open the modal; all releases + cards render.
2. New-dot: fresh state shows dot on both entry points → open → dot gone → reload
   keeps it gone; simulate a `CHANGELOG_REVISION` bump → dot returns.
3. Close via ×, backdrop, Escape.
4. Light + dark theme both render correctly (tokens, not hard-coded colours).
5. GitHub-issues CTA has the correct href and `target="_blank"`.
6. Mobile viewport (375×812): drawer item works, modal scrolls and is usable.
7. `changelog-open` event buffers to `window.__analyticsDebug` in dev.
