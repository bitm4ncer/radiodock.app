# Roadmap

## v2.5 — Desktop QoL 🚧

Small, independent quality-of-life features. Implementation plan:
`docs/superpowers/plans/2026-07-12-desktop-qol.md`.

- [x] **Q0** Docs reconciliation — CLAUDE.md module map + project status brought in line with shipped code; v2.4 ticked off (was fully implemented but unticked).
- [x] **Q1** Network-aware recovery — `recovery.js` parks retries while `navigator.onLine === false` (no wasted attempt budget) and replays the current station immediately on the window `online` event.
- [x] **Q2** Mute toggle — `player.toggleMute()` (remembers last audible volume), speaker button below the volume dots, `volumechange` listener in `main.js` becomes the single dots-sync point.
- [x] **Q3** Volume mouse-wheel — wheel over the volume strip adjusts ±10% per notch.
- [ ] **Q4** Keyboard shortcuts (`src/ui/keyboard.js`) — Space = play/pause, ↑/↓ = volume, `/` = focus search (opens overlay in mobile/standalone regime), `M` = mute. Ignored while typing or while a modal is open.

---

## v2.4 — Notes / Diary ✅

Local-first notes feature for capturing radio moments. **No recording, no rewind buffer** — those stay out of scope (see v3+ list at bottom).

- [x] **N0** `src/data/storage.js` — `DB_VERSION` bumped to 3, added `notes` + `notePages` object stores (with `byPage` + `byCreatedAt` indexes on `notes`).
- [x] **N1** `src/data/notes.js` — facade for pages + notes CRUD; lazily creates the default `journal` page on first read; rejects deletion of the Journal page.
- [x] **N2** `src/ui/notes-panel.js` — flag-tab dock at the right edge, draggable card (~360×560), open/close, position persisted to IDB (`notesPanelPos` / `notesPanelOpen`).
- [x] **N3** Note list rendering with day-grouping (Today / Yesterday / locale date) + sticky day headers + sticky "+ New note" footer.
- [x] **N4** Capture path: `metadata`-event cache in `main.js`; mini capture button on the player-card next to ❤️; large "Capture now" button inside the panel; silent capture + undo-toast (extended `toast.js` to accept an action button).
- [x] **N5** Per-card ⋯ menu: Edit · Copy as text · Play this station (capture only) · Move to page… · Delete (with undo-toast).
- [x] **N6** Pages tab-strip in the header (horizontal scroll); page ⋯ menu (Rename, Delete-with-confirm, Export all notes); Journal-page protected from delete.
- [x] **N7** Search toggle in header: live substring filter across `station.name`, `track.artist/title/nowPlaying`, and `body`.
- [x] **N8** Mobile path: hamburger drawer gets a "Notes" entry; same panel renders as a fullscreen slide-in overlay; no flag, no drag.
- [x] **N9** `src/data/notes-export.js` — JSON export (envelope `{ version, exportDate, pages, notes }`) downloaded via the Page ⋯ menu.
- [x] **N10** Analytics events (`note-capture`, `note-create`, `note-delete`, `note-page-create`, `note-export`); light-theme styling; polish + this checklist tickoff.

Out of scope for v2.4, possible v3.0:

- **Audio recording of stream segments.** `<audio>` carries no `crossorigin` (forbidden by mixed-content rules for most stations), so `captureStream()` is blocked for ICY/MP3. Only HLS via hls.js is technically untainted (~10% of stations). Recording would also push the product thematically toward "Radio DAW" and introduces copyright optics.
- **Rolling rewind buffer (last-minute cache).** Same CORS-tainted-audio problem; additionally, only HLS streams support seek-back natively.
- **Multi-window mode** (pop-out of a single page into a second draggable panel). Doubles the window-management complexity for an edge use case.
- Markdown / rich-text editor (plain text + auto-linkify is enough for atomic captures).
- Cross-device sync of notes (RadioDock is bewusst BYO-storage — would require a backend).
- Tags, pins, filter-by-station.

---

## v2.3 — List sharing ✅

- [x] **S0** `src/data/share.js` — gzip + base64url encoding of the existing extension-compatible JSON export shape; round-trips cleanly through `parseExport` on the import side, so the existing import pipeline handles the new transport.
- [x] **S1** Share button on each user-owned list row in the dropdown (next to Rename / Export / Delete). Modal shows the generated `https://radiodock.app/#s=…` URL with a Copy button. Hash never reaches a server — neither GitHub Pages logs nor Umami see the payload.
- [x] **S2** Inbound `#s=` handler runs at bootstrap and on `hashchange`. If the shared list's name doesn't collide with any existing user list → simple `Import?` confirm. If it collides → 3-way choice dialog: **Replace** existing list's stations / **Keep both** (auto-renamed) / **Cancel**.
- [x] **S3** `choiceDialog` helper added to `modal-helpers.js` for the 3-way choice. `listsApi.replaceListStations` added for the wholesale-replace path. Hash is cleared via `history.replaceState` after the flow ends, so reload doesn't re-prompt.
- [x] **S4** Analytics: `list-share` on dialog open, `list-import-shared` with `resolution: replace|new` on accept.

Out of scope for v2.3, possible v3.0: QR-code in share modal, real cross-device sync (WebRTC + public signaling), extension-side share-link import.

---

## v2.2 — Usage analytics ✅

Custom Umami events on top of the existing cookieless pageview tracker
(both go to the same `radiodock.app` website ID — no separate staging
project). All custom events are gated to `import.meta.env.PROD` so the
dev server doesn't pollute the dashboard. Free-tier budget is 10k
events/month; the event set below averages ~3 per session.

- [x] **A0** `src/analytics/umami.js` — thin `track(name, data)` wrapper around `window.umami.track`; silently no-ops when the umami global is missing (script blocked / still loading / dev build). All call sites import from here, never touch `window.umami` directly.
- [x] **A1** Player events: `station-play` (`{ name, country, source: community|user-list|search }`) emitted at each `player.playStation` call site; `stream-error` (`{ name, errorName }`) from `player.on('error')`.
- [x] **A2** Library ops: `station-add` (from search add-button), `list-create`, `list-import` (`{ count }`), `list-export`, `list-delete` — fired after the IndexedDB op succeeds so failed ops don't get counted.
- [x] **A3** Search: `search` (`{ filter, resultCount }`) fired once per debounced API call. The query string itself is intentionally **not** sent (PII concern).
- [x] **A4** Install funnel: `install-click` (`{ platform }`) from each install-section button + the mobile drawer's Install row; `pwa-installed` from the window `appinstalled` event.
- [x] **A5** Verified on production — events visible in the Umami dashboard, no errors in console, dev-server requests do not show up in the data.
- [x] **A6** Listening duration: `listen-ping` heartbeat (`{ station, country, background }`) once per minute of audible playback via `src/analytics/listen-heartbeat.js` — ping count per station in Umami's Properties view equals listening minutes; `background: yes|no` splits foreground vs. locked-screen/background listening. Dev builds buffer all events to `window.__analyticsDebug` instead of sending.

---

## v2.1 — Audio visualizer (desktop) 🚧

Built end-to-end but **feature-flagged off in production** (`VISUALIZER_ENABLED = false` in `src/main.js`) while it matures. Flip the flag to test locally.

- [x] **M8.0** Tiered audio-data pipeline (`src/visualizer/audio-source.js`): HLS-via-hls.js (untainted MSE blob) → `getDisplayMedia` tab-audio capture (opt-in) → procedural fallback. Audio-mode is surfaced honestly in the drawer status line. CORS-probe Tier 2 deferred to a later iteration.
- [x] **M8.1** Rendering foundation (`src/visualizer/engine.js`): two stacked fullscreen canvases (Canvas 2D + WebGL via [regl](https://github.com/regl-project/regl)) since a single canvas can't expose both contexts. Single rAF loop, pauses on tab-hidden / master-off. DPR capped at 1.5 for shader visualizers with auto-fallback to 1.0 on sustained frame drops.
- [x] **M8.2** Visualizer registry (`src/visualizer/registry.js`) — drop one file in `src/visualizers/` + add one line to the registry. Each module declares its own `controls[]`, auto-rendered in the drawer.
- [x] **M8.3** v1 set: Spectrum Bars, Oscilloscope, Radial Pulse (Canvas 2D); Reaction-Diffusion (Gray-Scott ping-pong FBO) + Flow Field (Perlin + audio turbulence) as regl shaders.
- [x] **M8.4** [butterchurn](https://github.com/jberg/butterchurn) Milkdrop support — lazy-loaded on first activation, listed under its own category with explicit credit link and a "Milkdrop powered by butterchurn" footer in the drawer.
- [x] **M8.5** Right-side slide-in drawer (`src/ui/visualizer-drawer.js`): master on/off toggle, picker grouped by category, auto-rendered controls per visualizer, audio-mode status line, "Connect audio" upgrade button (only when needed), credits footer.
- [x] **M8.6** Visualizer trigger button mounted at the top-right of the main `.container#app`.
- [x] **M8.7** Player card draggable via grab handle (drag scopes to the card only — section stays put) + minimize button → mini-pill. Position + minimized state persisted in IndexedDB.
- [x] **M8.8** Desktop only — feature is gated on `pointer: coarse` and silently absent on mobile.
- [x] **M8.9** Body `viz-active` class toggles transparent body background when visualizer is on, so the canvas behind shows through without breaking the dark background when the feature is off.

---

## v2.0 — Platform-native layouts ✅

- [x] **V0** Umami Cloud analytics in `<head>` (defer, cookieless) + BMC button restyled as muted pill matching GitHub/Issues (no more yellow)
- [x] **V1** CSS regime split: new `app-mobile.css` + `app-desktop.css` files behind media queries; component CSS unchanged
- [x] **V2** Desktop container tint (`padding: 59px 34px; background: #0000002b; border-radius: 25px`) + real `<footer class="site-footer-desktop">` below the page (#0d0d0d, smaller pills, one-line) revealed by scroll
- [x] **V3** New `install-section.js` collapsible block with three buttons — current platform highlighted with red border + "· you" suffix; persists collapse state in IndexedDB; Chrome Ext → direct link; Desktop / Mobile → `install-info` modal seeded to the right branch; hidden when in standalone mode
- [x] **V4** Mobile top bar (hamburger / logo / search icon) + left off-canvas drawer with Install / GitHub / Issues / BMC / Legal items; backdrop / Escape / swipe-left close
- [x] **V5** Mobile bottom-fixed player section with horizontal volume strip above it (5 dots spread across full width, 14×14 tap targets); station-list bottom-padding reserves room so last row stays reachable
- [x] **V6** Mobile fullscreen search overlay slides in from the right when 🔍 is tapped; re-parents the existing `.search-section` so callbacks work unchanged; closes via × / Escape / resize-to-desktop
- [x] **V7** Verified both viewports (1280×800 desktop, 375×812 mobile); tagged v2.0.0

---

## v1.0 — Initial PWA build

Each milestone is a working slice that can be deployed and tested before moving on.

## M0 — Repo, scaffold, live URL ✅

- [x] Create GitHub repo `radiodock.app`
- [x] Vite vanilla scaffold (`package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/styles/*.css`)
- [x] `public/CNAME` (`radiodock.app`)
- [x] `public/manifest.webmanifest` (placeholder; full icons in M6)
- [x] `.github/workflows/deploy.yml` (Actions → Pages)
- [x] DNS A/AAAA records configured at Hetzner
- [x] GitHub Pages "GitHub Actions" source enabled
- [x] `https://radiodock.app` serves over HTTPS (cert auto-provisioned)

## M1 — Core playback ✅

- [x] Copy `public/community-radios.json` from extension
- [x] `src/player/audio.js` — `<audio>` element, HLS branch, ICY/MP3 branch, volume, play/pause
- [x] `src/player/recovery.js` — handle `stalled` / `error` / `ended` with `audio.load()` retry
- [x] HTTPS upgrade for `http://` streams on secure contexts (mixed-content fix)
- [x] Verified on desktop Chrome (ICY + HLS path proven)

## M2 — UI port ✅

- [x] Split `popup.css` into `src/styles/*.css`
- [x] `src/ui/player-card.js` — now-playing card, play/pause, volume dots
- [x] `src/ui/station-list.js` — list rows
- [x] `src/ui/list-dropdown.js` — community / custom-lists switcher
- [x] `src/ui/modals.js` — open/close manager
- [x] Mobile-first layout; desktop centers at max 480px
- [x] Desktop Chrome Web Store badge (`min-width: 700px`)
- [x] Verified on desktop (1280×720) and mobile (375×812) viewports

## M3 — Storage, favorites, custom lists, import/export ✅

- [x] `src/data/storage.js` — IndexedDB wrapper (`lists`, `prefs`)
- [x] `src/data/lists.js` — high-level list ops, auto-creates default Favorites
- [x] Heart icon on player card adds/removes from Favorites, persists
- [x] Create / rename / delete custom lists via prompt + confirm modals
- [x] Drag-drop reorder persists to IndexedDB
- [x] Export → download JSON (extension-compatible `version: "2.0"` shape)
- [x] Import → file picker → validation → creates new list with auto-unique name
- [x] `src/ui/modal-helpers.js` — promise-based prompt/confirm wrappers

## M4 — Search ✅

- [x] `src/data/radio-browser.js` — Radio Browser API client with mirror-server fallback
- [x] `src/ui/search.js` — input + debounce + filter tabs + loading/error/empty/results states
- [x] Click result → play
- [x] Add-to-list button on result row (adds to active editable list or Favorites)
- [x] Name / Genre / Country filters all functional

## M5 — Metadata ✅

- [x] `src/data/metadata.js` — port of `metadataProxy.js`, 15s TTL, AbortController, no `Cache-Control` header (would trigger CORS preflight)
- [x] `src/player/metadata-poller.js` — drives polling, pauses on tab-hidden, surfaces "Loading metadata…" if first response > 3s
- [x] Wire to player card "Now Playing" line (prefers `artist + title`, falls back to proxy `display`)
- [x] HLS local-ID3 path: hook `Hls.Events.FRAG_PARSING_METADATA` (already wired in M1)
- [x] CORS allowlist updated in `RadioDock-metadata-proxy` repo (`https://radiodock.app`, `https://www.radiodock.app`, `*.radiodock.app`, any `localhost:*`)
- [x] Keep-warm GitHub Actions cron in proxy repo (every 10 min → `/health`)
- [x] Bootstrap fire-and-forget `/health` ping from PWA so first user click never hits a cold start

## M6 — PWA polish ✅

- [x] `scripts/generate-icons.mjs` rasterizes `icon.svg` → 192/512/maskable-512/apple-touch-180/favicon-16/favicon-32. Run with `npm run icons`.
- [x] `public/sw.js` — install/activate/fetch, app-shell cache, stale-while-revalidate for shell, network-only for API + streams, offline navigation fallback.
- [x] Vite `injectBuildIdPlugin` rewrites `__BUILD_ID__` in `dist/sw.js` to `${Date.now()}-${gitShortSha}` so the cache name changes per deploy.
- [x] Register SW in `main.js` (production only, gated by `import.meta.env.PROD`).
- [x] `src/player/media-session.js` — `MediaMetadata` (title/artist/artwork) updates on `stationchange` + `metadata` events, `play`/`pause`/`stop` action handlers, optional `previoustrack`/`nexttrack` callbacks.
- [x] `src/ui/install-info.js` — onboarding modal with platform branches: iOS Safari (Share → Add to Home Screen), iOS non-Safari ("Open in Safari" deep link), Android (`beforeinstallprompt`), Desktop (`beforeinstallprompt` with graceful Firefox/Safari fallback). Auto-shows once on first visit; re-openable from the about modal.
- [ ] Lighthouse PWA score ≥ 90 (measured during M7 device matrix)

## M7 — Verification + ship ✅

- [x] Cross-link the [Chrome extension repo](https://github.com/bitm4ncer/RadioDock) to this PWA from its README
- [x] Tag v1.0.0
- [ ] Device matrix (user-driven): desktop Chrome, iPhone Safari, iPhone Chrome, Android Chrome — see verification section in [the design plan](../../../Users/konta/.claude/plans/i-made-this-moonlit-karp.md)
- [ ] Lock-screen audio test on real devices (user-driven)
- [ ] Lighthouse PWA audit ≥ 90 (user-driven)

## Out of scope (v2.2+)

- Cloud sync across devices
- Sleep timer
- Native share intent
- Direct migration from extension `chrome.storage.sync`
- Cinema mode (visualizer fullscreen + auto-hide card on idle)
- Visualizer thumbnails / preset browser
- CORS-probe Tier 2 for the audio pipeline
- Multiple simultaneous players / mini-player
