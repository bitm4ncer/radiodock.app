# Roadmap

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

## M6 — PWA polish

- [ ] Generate icons from `RadioDock/logo/` (192, 512, maskable-512, apple-touch-180)
- [ ] `src/sw.js` — install/activate/fetch, app-shell cache, versioning
- [ ] Register SW in `main.js` (production only)
- [ ] `src/player/media-session.js` — `MediaMetadata` + action handlers
- [ ] `src/ui/install-info.js` — onboarding modal (Safari / iOS-Chrome / Android / Desktop branches)
- [ ] Lighthouse PWA score ≥ 90

## M7 — Verification + ship

- [ ] Device matrix: desktop Chrome, iPhone Safari, iPhone Chrome, Android Chrome
- [ ] Lock-screen audio test on real devices
- [ ] `git tag v1.0.0 && git push --tags`
- [ ] Update extension README to cross-link

## Out of scope (v1.1+)

- Cloud sync across devices
- Sleep timer
- Native share intent
- Direct migration from extension `chrome.storage.sync`
- Audio visualizer
- Multiple simultaneous players / mini-player
