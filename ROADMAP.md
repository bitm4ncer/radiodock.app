# Roadmap

Each milestone is a working slice that can be deployed and tested before moving on.

## M0 — Repo, scaffold, live URL

- [x] Create GitHub repo `radiodock.app`
- [x] Vite vanilla scaffold (`package.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/styles/*.css`)
- [x] `public/CNAME` (`radiodock.app`)
- [x] `public/manifest.webmanifest` (placeholder; full icons in M6)
- [x] `.github/workflows/deploy.yml` (Actions → Pages)
- [ ] Configure DNS A/AAAA records (manual at registrar — see README)
- [ ] Enable GitHub Pages → "GitHub Actions" source
- [ ] Verify `https://radiodock.app` returns the placeholder over HTTPS

## M1 — Core playback

- [ ] Copy `public/community-radios.json` from extension
- [ ] `src/player/audio.js` — `<audio>` element, HLS branch, ICY/MP3 branch, volume, play/pause
- [ ] `src/player/recovery.js` — handle `stalled` / `error` / `ended` with `audio.load()` retry
- [ ] Confirm playback on desktop Chrome (both HLS and ICY streams)

## M2 — UI port

- [ ] Split `popup.css` into `src/styles/*.css`
- [ ] `src/ui/player-card.js` — now-playing card, play/pause, volume dots
- [ ] `src/ui/station-list.js` — list rows with drag-drop reorder
- [ ] `src/ui/list-dropdown.js` — community / custom-lists switcher
- [ ] `src/ui/modals.js` — new-list, info, confirm, prompt
- [ ] Mobile-first layout; desktop centers at max 480px
- [ ] Verify on real iPhone Safari and Android Chrome

## M3 — Storage, favorites, custom lists, import/export

- [ ] `src/data/storage.js` — IndexedDB wrapper (`lists`, `favorites`, `prefs`)
- [ ] Wire favorites heart icon
- [ ] Create / rename / delete custom lists
- [ ] Drag-drop reorder persists
- [ ] Export → download JSON (`radiodock-export-YYYY-MM-DD.json`)
- [ ] Import → file picker → validation → replace stores → reload UI

## M4 — Search

- [ ] `src/data/radio-browser.js` — Radio Browser API client
- [ ] `src/ui/search.js` — input with debounce, filter tabs, results, loading + error + empty states
- [ ] Add-to-list flow from search result rows

## M5 — Metadata

- [ ] `src/data/metadata.js` — port of `metadataProxy.js`, 15s cache, AbortController
- [ ] Pause polling when tab hidden
- [ ] **PR in `RadioDock-metadata-proxy` repo**: add `https://radiodock.app` + `http://localhost:5173` to CORS allowlist
- [ ] Wire to player card "Now Playing"
- [ ] HLS local-ID3 path via `Hls.Events.FRAG_PARSING_METADATA`

## M6 — PWA polish

- [ ] Generate icons from `RadioDock/logo/` (192, 512, maskable-512, apple-touch-180)
- [ ] `src/sw.js` — install/activate/fetch, app-shell cache, versioning
- [ ] Register SW in `main.js` (production only)
- [ ] `src/player/media-session.js` — `MediaMetadata` + action handlers
- [ ] `src/ui/install-info.js` — onboarding modal (Safari/iOS-Chrome/Android/Desktop branches)
- [ ] `src/ui/store-badge.js` — desktop-only Chrome Web Store link
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
