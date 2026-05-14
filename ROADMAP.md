# Roadmap

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

## Out of scope (v1.1+)

- Cloud sync across devices
- Sleep timer
- Native share intent
- Direct migration from extension `chrome.storage.sync`
- Audio visualizer
- Multiple simultaneous players / mini-player
