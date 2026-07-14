# RadioDock — Claude guidance

PWA rebuild of the RadioDock Chrome extension. Lives at <https://radiodock.app> (GitHub Pages, custom domain). Source repo is `bitm4ncer/radiodock.app`. The original extension lives at `C:\GitHub\RadioDock` and is the source of truth for visual styling, copy, and station data.

## Project status

Follow [ROADMAP.md](./ROADMAP.md). It is the user's primary status surface — **tick checkboxes after every milestone commit**. v1.0 (M0–M7) and v2.0–v2.5 are shipped; the v2.1 visualizer is fully built but feature-flagged off in production (`VISUALIZER_ENABLED = false` in `src/main.js`).

## Stack

- Vite 5 + vanilla JS (no framework).
- No bundler magic — plain ES modules, dynamic `import()` for `hls.js` only.
- IndexedDB for persistence (no localStorage except where unavoidable).
- GitHub Actions deploys `dist/` to Pages on push to `main`.

Local dev:

```bash
npm install
npm run dev       # http://localhost:5173 (PORT env wins for Claude Preview)
npm run build
```

## Module layout

```
src/
├─ main.js                # orchestration, state, callbacks, bootstrap
├─ platform.js            # platform / standalone detection, beforeinstallprompt capture
├─ analytics/
│  ├─ umami.js            # track() wrapper; dev builds buffer to window.__analyticsDebug
│  └─ listen-heartbeat.js # listen-ping heartbeat, 1/min of audible playback
├─ player/
│  ├─ audio.js            # <audio> wrapper, HLS branch, EventTarget bus
│  ├─ recovery.js         # error/stalled/ended retry with backoff
│  ├─ metadata-poller.js  # poll proxy for now-playing, pauses on tab-hidden
│  └─ media-session.js    # lock-screen / notification-shade controls
├─ data/
│  ├─ storage.js          # IndexedDB wrapper (lists, prefs, notes, notePages stores)
│  ├─ lists.js            # high-level list ops, lazy default Favorites
│  ├─ notes.js            # notes + pages CRUD facade (lazy Journal page)
│  ├─ notes-export.js     # notes JSON export envelope
│  ├─ import-export.js    # JSON export/import (extension-compatible)
│  ├─ share.js            # gzip+base64url share-link codec (#s= hash)
│  ├─ radio-browser.js    # Radio Browser API client + mirror fallback
│  ├─ metadata.js         # radiodock-metadata-proxy client
│  ├─ wikipedia.js        # Wikipedia summary lookup for station info
│  ├─ logo-resolver.js    # station-logo fallback chain (override → original → DDG)
│  └─ gradient-presets.js # built-in background gradients
├─ ui/
│  ├─ player-card.js      # now-playing card, play/pause, volume dots, marquee
│  ├─ player-card-drag.js # drag + minimize-to-pill (desktop)
│  ├─ station-list.js     # drag-drop reorder, remove-from-list
│  ├─ station-logo.js     # logo slot rendering + fallback behaviour
│  ├─ station-info.js     # station bottom-sheet (Radio Browser by-uuid + Wikipedia)
│  ├─ list-dropdown.js    # rename/share/export/delete per row
│  ├─ list-tabs.js        # mobile horizontal tab strip (long-press menu)
│  ├─ lists-carousel.js   # mobile scroll-snap carousel of lists
│  ├─ search.js           # input + debounce + filter tabs + result states
│  ├─ search-overlay.js   # mobile fullscreen search overlay
│  ├─ notes-panel.js      # notes dock/panel: pages, search, day grouping, card menu
│  ├─ notes-capture-button.js # mini capture button on the player card
│  ├─ keyboard.js         # desktop shortcuts: Space, arrows, /, M
│  ├─ modals.js           # open/close manager (.show class)
│  ├─ modal-helpers.js    # promise-based prompt/confirm/choice
│  ├─ toast.js            # toasts, optional action button (undo pattern)
│  ├─ theme.js            # light/dark toggle + OS-pref subscription
│  ├─ background.js       # fullscreen background images + cycle controls (desktop)
│  ├─ background-gallery.js  # background picker
│  ├─ background-create.js   # gradient editor
│  ├─ install-info.js     # install onboarding modal (platform branches)
│  ├─ install-section.js  # floating install badge (desktop)
│  ├─ off-canvas.js       # mobile drawer
│  ├─ footer-reveal.js    # desktop footer auto-reveal
│  └─ idb-blocked-banner.js # help banner when IndexedDB is blocked
├─ visualizer/            # engine, registry, drawer, audio pipeline (desktop; flagged off)
├─ visualizers/           # visualizer modules (spectrum bars, oscilloscope, …)
└─ styles/                # split by component, classnames mirror popup.css
```

## Hard rules

- **Mobile-first CSS.** Default styles target ≥ mobile, scale up via `min-width` media queries. Page is a centered column, max 480px. Dark gray `#1a1a1a` background.
- **Use the popup's existing CSS classnames verbatim.** The styles split was a mechanical port — `station-item`, `station-item-logo`, `list-item.active`, `btn-remove`, `btn-drag`, `modal.show`, etc. Don't invent BEM variants. Match the names so the CSS just works.
- **Audio element must live in the main DOM** (no Web Audio, no offscreen). Plays-in-background relies on it.
- **`crossorigin` attribute is forbidden on `<audio>`.** Most radio streams lack CORS headers and the attribute would block them.
- **HTTPS-upgrade `http://` stream URLs** on secure contexts (`window.isSecureContext`). Already handled in `audio.js#preferHttps`. Many community stations are HTTP-only and would otherwise hit mixed-content blocks.
- **HLS detection is canonical** (`Hls.isSupported()` first, native `canPlayType('application/vnd.apple.mpegurl')` second). `hls.js` is loaded via dynamic `import('hls.js')` only when an HLS URL is selected.
- **No backwards-compat hacks.** This is a fresh PWA, not a port of the extension's chrome.* plumbing.

## Versioning

User-facing version label is **auto-derived** from the git commit count
on `main`. Formula in `vite.config.js#appVersion`:

```
v${VERSION_MAJOR_MINOR}.${(git rev-list --count HEAD) - VERSION_BASELINE_COMMIT_COUNT}
```

- `VERSION_MAJOR_MINOR` — hardcoded prefix (e.g. `1.0`). Bump manually for a new minor cycle (and reset the baseline to the current commit count when you do).
- `VERSION_BASELINE_COMMIT_COUNT` — commit count just before the first commit of the current minor cycle.
- Patch number rises by **+1 on every commit to `main`** automatically. No manual bumping, no `npm version` calls, no pre-commit hooks.

The value is exposed as the `__APP_VERSION__` build-time constant via Vite's `define` and rendered into every element with class `app-version` by `main.js`. Two display sites today: the About modal header (`<h3 class="app-version">`) and the off-canvas drawer's bottom-right corner (`.off-canvas__version`).

`.github/workflows/deploy.yml` checkout uses `fetch-depth: 0` — without it the runner has a shallow clone and `git rev-list --count HEAD` would always be 1.

## Desktop releases

The Electron installers ship from **one clean GitHub release** — tag `latest`, title "RadioDock", **no changelog**. `.github/workflows/desktop-build.yml` builds win/mac/linux in parallel, then a single `release` job publishes/updates that one release with the three installers.

- **Never** put changelog or commit-message notes on a release. Users must not be able to see what changed build-to-build — keep the generic notes line only.
- **No per-build versioned releases** (no `desktop-vN`). One `latest` release, updated in place (`gh release upload --clobber`), always `--latest`.
- Keep the asset filenames `RadioDock-win.exe` / `RadioDock-mac.dmg` / `RadioDock-linux.AppImage` and the make-latest flag: the site's install buttons hit `/releases/latest/download/RadioDock-*` ([install-section.js](src/ui/install-section.js)).

## Conventions

- Default to writing no code comments. Only write a comment when the WHY is non-obvious — a hidden constraint, a workaround, a subtle invariant. No "// updates the station" narration.
- Don't reference the current task/PR/issue in comments (those belong in commit messages).
- IndexedDB writes go through `data/lists.js` or `data/storage.js`; never reach into IndexedDB from a UI module.
- UI modules expose `mount...()` returning an object of callbacks (`onClick`, `onAdd`, …). `main.js` is the only place that knows about both UI and data.
- Add behavioural verification with the Claude Preview MCP after every observable change. Don't claim something works without DOM/state evidence.

## Reused services

- **Metadata proxy:** primary `https://stations.radiodock.app/v1/metadata` (Hetzner VPS, always-on), automatic fallback `https://radiodock-metadata-proxy-1.onrender.com/v1/metadata` (Render free tier, kept warm by cron). Same codebase, owned by the user (separate repo `bitm4ncer/RadioDock-metadata-proxy`). Returns `{ ok, source, artist, title, display, cacheTtl }`. Failover lives in `src/data/metadata.js` — transport/HTTP errors only, with a 60s primary cooldown.
- **Radio Browser API:** `https://*.api.radio-browser.info/json/stations/search` — community-run, free, CORS-enabled. Rotate mirrors on failure.

## Things that bite

- **Mixed-content on production.** Many community stations are `http://`. The `preferHttps()` helper handles it. Don't remove it.
- **iOS Safari audio rules.** Audio cannot start without a user gesture. After first user-tap, subsequent `playStation()` calls inherit the gesture and work. Background playback works as long as audio is playing at the moment the page is hidden/locked.
- **`onerror` handler on `<img class="station-item-logo">`** uses inline `this.replaceWith(...)` because the popup's CSS sized the `<img>` tag directly with class `station-item-logo`. Initials are a sibling div, not a child.
- **The CSS uses `.modal.show` for the open state**, not `.is-open` or `.modal--open`. `src/ui/modals.js` toggles `.show`.
- **Community list is read-only.** ID is the sentinel `__community__`. `listsApi.addStationToList(...)` and the heart icon target Favorites instead when the active list is community.

## Where to look for things

- Visual reference for any UI change: `C:\GitHub\RadioDock\popup.html` + `popup.css`.
- Behavioural reference for interactions: `C:\GitHub\RadioDock\popup.js` (search the class methods).
- Community station list shape: `public/community-radios.json` — `{ version, exportDate, listName, stations: [{id, name, url, countrycode, favicon, homepage}] }`.

## Don't

- Don't add JS frameworks (React/Svelte/etc). Stay vanilla.
- Don't introduce a state management library. The state object in `main.js` is enough.
- Don't add `localStorage` writes; IndexedDB is the store.
- Don't bundle `hls.js` eagerly. Keep the dynamic import — it adds ~520 kB.
- Don't write planning/decision docs unless asked. Keep notes in conversation; ship code.
