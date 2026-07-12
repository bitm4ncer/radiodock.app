# RadioDock

Internet radio player for the web — installable as a PWA on desktop and mobile.

**Live: <https://radiodock.app>**

RadioDock is the standalone web rebuild of the [RadioDock Chrome extension](https://github.com/bitm4ncer/RadioDock). It streams 50K+ stations via the community-run [Radio Browser](https://www.radio-browser.info/) directory, ships with a curated community station list, and keeps all user data on-device.

## Features

- **Playback** — ICY/MP3 and HLS streams (`hls.js` loaded on demand), automatic error recovery with backoff, lock-screen / background playback via the Media Session API.
- **Now playing** — live track metadata through a dedicated [metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy), plus in-band ID3 for HLS streams.
- **Search** — Radio Browser search by name, genre, or country with mirror-server fallback.
- **Lists** — favorites and custom lists with drag-drop reorder, JSON import/export (extension-compatible), and shareable list URLs (gzip + base64url in the hash fragment — the payload never touches a server).
- **Notes** — local-first journal for capturing radio moments (station + track + timestamp) with pages, search, and export.
- **Visualizer** (desktop) — Canvas 2D and WebGL visualizers plus Milkdrop presets via [butterchurn](https://github.com/jberg/butterchurn), driven by a tiered audio pipeline (HLS/MSE → tab-audio capture → procedural fallback).
- **Backgrounds** — gradient editor and image gallery for customizing the app surface.
- **PWA** — offline app shell via service worker, install flows per platform, standalone-mode layouts.

## Technical overview

- **Stack:** Vite 5 + vanilla JS — no framework, no state library, plain ES modules. `hls.js` and `butterchurn` are the only runtime dependencies, both dynamically imported.
- **Persistence:** IndexedDB throughout (lists, preferences, notes). No accounts, no backend, no localStorage.
- **Audio:** a single `<audio>` element in the main DOM (required for background playback). Stream URLs are HTTPS-upgraded on secure contexts to avoid mixed-content blocks; `crossorigin` is deliberately absent since most radio streams lack CORS headers.
- **Layout:** mobile-first CSS, centered column capped at 480px, separate mobile/desktop regimes behind media queries.
- **Analytics:** self-hosted, cookieless Umami — anonymous usage events, no query strings or PII.

```
src/
├─ main.js          orchestration, state, bootstrap
├─ player/          audio element, HLS branch, recovery, metadata polling, media session
├─ data/            IndexedDB storage, lists, notes, import/export, share links, API clients
├─ ui/              player card, station list, search, modals, drawers, toasts
├─ visualizer/      engine (Canvas 2D + WebGL), audio source tiers, registry
├─ visualizers/     individual visualizer modules
└─ styles/          component-split CSS
```

## Services

- **[Radio Browser API](https://www.radio-browser.info/)** — station directory and search (community-run, CORS-enabled).
- **[RadioDock metadata proxy](https://github.com/bitm4ncer/RadioDock-metadata-proxy)** — now-playing metadata for ICY streams.

## Deployment

Push to `main` → GitHub Actions builds and deploys to GitHub Pages under the custom domain. The user-facing version label is derived automatically from the git commit count.

For local development: `npm install && npm run dev`.
