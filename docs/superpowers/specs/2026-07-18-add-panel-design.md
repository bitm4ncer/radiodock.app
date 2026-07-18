# Add panel — Submit Station & Custom Stream

**Date:** 2026-07-18
**Repos touched:** `radiodock.app` (PWA), `RadioDock-Stations` (VPS server + dashboard)
**Status:** design approved, awaiting implementation

## Goal

A new desktop **"Add"** surface in the RadioDock PWA — a panel in the same family as
the Sync panel and the Changelog modal — with two functions:

1. **Submit station to database** — a public form letting any user propose a station.
   The submission lands in the Stations dashboard review queue (Hetzner VPS) with the
   **full field set of the dashboard edit panel**, so an admin can approve it with one
   click (or edit-then-approve).
2. **Add custom stream locally** — add a private stream (name, stream URL, thumbnail)
   to one of the user's local lists. Never leaves the device except via the user's own
   sync/export.

Constraint: build and verify **entirely locally** first. Nothing pushed to either repo
without explicit user approval.

## Non-goals

- No public image-upload endpoint on the server (logos travel inside the JSON payload).
- No CAPTCHA (the existing submissions endpoint already deems volume low enough).
- No "Test metadata" button in the submit form — metadata verification stays an
  admin/review-time action using existing admin infrastructure.
- No new sixth pager page; the Add surface is a panel, not a route.

## Surface & entry points (PWA)

Cloned from the **Sync panel** pattern (`src/ui/sync-modal.js`, `src/styles/sync.css`):

- New `src/ui/add-panel.js` exposing `mountAddPanel({ listsApi, storage, track, onStationAdded }) → { open, close }`.
- New DOM container `<aside id="addPanel" class="add-panel" aria-hidden="true" role="dialog">` in `index.html`.
- New `src/styles/add.css` (import via `src/styles/index.css`).
- Own `.is-open` toggle (NOT `modals.js`); Escape + close-button + backdrop close.
- **Desktop:** draggable card, position persisted to pref `addPanelPos` (mirror sync drag wiring).
- **Mobile:** fullscreen slide-in (`add-panel--mobile`), `matchMedia('(max-width: 699px)')` decides at open time.
- Top of panel: a segmented switch — **"Submit station"** / **"Custom stream"** — toggling two `hidden` body sections.

Entry points (both wired in `main.js` next to the existing Sync wiring):
- `#offCanvasAdd` button in `index.html` off-canvas nav (above `.off-canvas__nav-spacer`), wired in `src/ui/off-canvas.js` via a new `onAddClick` callback.
- `#footerAddBtn` `.footer-pill` in the desktop footer, wired directly in `main.js`.

## Tab 1 — Submit station

### Fields (parity with dashboard edit drawer)

- **Name*** (required), **Stream URL*** (required, http/https)
- Info (textarea), Tags (comma list), Homepage
- **Logo:** drop-zone + file picker → resized client-side to 512px max, encoded as a
  data-URL (PNG/JPEG/WebP), carried in the payload. Preview shown; clear button.
- **Now-playing metadata:** Strategy `<select>`, Endpoint URL, Artist path, Title path,
  Show path, Cache TTL (seconds), `exclusive` checkbox. No Test button.
- **Socials & Location:** City, Contact email, and the 8 platform URLs
  (instagram, soundcloud, mixcloud, bandcamp, youtube, facebook, x, tiktok).
- Hidden honeypot input `website` (server already treats a filled `website` as spam).

### Client

New `src/data/submit.js`:
```
submitStation(payload) → POST `${STATIONS_BASE}/api/submissions`
```
Reuses `STATIONS_BASE` from `stations-api.js`. Payload shape:
```json
{
  "name": "...", "streamUrl": "...", "homepage": "...",
  "genres": "pop, top 40", "info": "...",
  "logoData": "data:image/png;base64,...",
  "city": "...", "contactEmail": "...",
  "socials": { "instagram": "https://...", "soundcloud": "https://..." },
  "metadata": { "strategy": "...", "endpoint": "...",
                "artistPath": "...", "titlePath": "...", "showPath": "...",
                "ttl": 30, "exclusive": false },
  "website": ""
}
```
- Client resizes the logo via `<canvas>` before send (target ≤ 512px, ~<100 KB).
- On `201` → success toast + reset form. On `409` → "This station is already in the
  database." On `400`/network → generic error toast. Track a `submit_station` event.

### Client image resize

Shared helper `src/data/image-resize.js` (`resizeToDataUrl(file, maxPx) → Promise<string>`)
used by both tabs. Uses `createImageBitmap` + `<canvas>`. Rejects non-image files and
files whose decoded result exceeds a sanity cap.

## Server changes (RadioDock-Stations)

**Precondition:** local repo is 72 commits behind `origin/main`. Pull/rebase onto
`origin/main` first (local ROADMAP.md edits + untracked M8 docs are preserved — stash
if needed). Migration 013 (socials) and 014 already exist upstream; the new migration is **015**.

### Migration `server/db/migrations/015-submission-full-fields.sql`
Add columns to `submissions`:
- `city TEXT`, `contact_email TEXT`
- `socials_json TEXT` — JSON object `{platform: url}`
- `metadata_json TEXT` — JSON `{strategy, endpoint, artistPath, titlePath, showPath, ttl, exclusive}`
- `logo_data TEXT` — data-URL (or a stored logo path; see below)

### API `server/api/submissions.js`
- Raise `express.json` limit 8kb → **256kb** (logo data-URL headroom).
- Accept + validate the new fields: length caps, socials platform whitelist (the 8
  from migration 013's CHECK), metadata strategy whitelist, TTL numeric bound.
- Logo handling: decode the data-URL, re-encode with `sharp` to 512×512 PNG. On decode
  failure, drop the logo but keep the rest of the submission valid. Store to the same
  logo store the dashboard upload uses (`${DATA_DIR}/logos/…`) keyed by submission id,
  OR persist the data-URL in `logo_data` and materialise on approve — pick whichever is
  simpler given the existing `setManualFavicon`/`logo-upload` code; decide during impl.
- Keep existing honeypot, rate-limit (5/h), IP-hash, dedupe behaviour untouched.

### Dashboard review card `dashboard/src/pages/review.js`
- Render the new fields (city, contact, socials list, metadata summary) and a logo
  preview on the submission card.

### Approve path `server/db/submissions.js#approve`
Distribute the submission's data to the same tables the edit drawer writes:
- `name/url/homepage/tags/info/favicon/city/contact_email` → `station_overrides`
  (origin `local`; whitelist already includes most, add `city`/`contact_email` per mig 013).
- socials → `station_socials` (`server/db/socials.js`)
- metadata config → `metadata_overrides` (`server/db/metadata` repo)
- logo → logo store / `logo_path`
Edit-approve continues to open the drawer, now pre-filled from the submission.

## Tab 2 — Custom stream (local only)

Fields: **Name*** , **Stream URL*** , Thumbnail (upload → resize ≤256px → data-URL),
List picker (default = active editable list from `getActiveEditableList()`, community
excluded).

Flow: build station object
```json
{ "id": "custom-<random>", "name": "...", "url": "...", "favicon": "data:image/…" }
```
→ `listsApi.addStationToList(listId, station)` → `scheduleSyncPush()` in `main.js`.
`sanitizeStation` already preserves `id/name/url/favicon`, so it survives persist,
sync, and export unchanged.

### Two required existing-code adjustments
1. `src/data/logo-resolver.js#getLogoUrl`: if `station.favicon` is a `data:` URL,
   return it directly instead of building the UUID-based CDN URL. Initials fallback
   (`mountLogoBehavior` on img error) still applies. `renderLogoSlot` in
   `station-logo.js` consumes `getLogoUrl`, so this one change reaches all render sites.
2. `src/ui/station-info.js`: for `custom-*` ids, skip the Radio-Browser by-uuid lookup
   and show a gentle empty/info state instead of a fetch error.

Playback is unchanged — the existing audio path (preferHttps, HLS detection) handles the URL.

## Data flow summary

```
Submit tab → submit.js → POST /api/submissions → submissions table (pending)
           → dashboard review card → admin approve → station_overrides + socials
             + metadata_overrides + logo store → merged_stations → live in search

Custom tab → image-resize → station obj → listsApi.addStationToList → IndexedDB
           → scheduleSyncPush → user's own sync/export only
```

## Error handling

- Submit: field validation client-side (required name+URL, URL protocol), server
  re-validates; 409 dedupe surfaced clearly; oversized/invalid logo dropped gracefully.
- Custom: URL required; duplicate `id` is a dedupe no-op in `addStationToList`; oversized
  image rejected before store to protect IndexedDB/sync payload.

## Testing (all local)

- Stations server: run locally (SQLite + `/admin` dashboard), apply migration 015.
- PWA: dev build with a dev-only override pointing `STATIONS_BASE` at localhost.
- Verify full roundtrip with Preview MCP + DOM/state evidence:
  Submit form → row in `submissions` → review card renders all fields + logo →
  approve → station appears in `merged_stations` / search.
- Verify custom stream: add → renders with data-URL thumbnail in the list → plays →
  survives reload → present in export JSON.
- Nothing pushed to either repo until the user approves.

## Open decisions deferred to implementation

- Logo storage on submission: inline `logo_data` vs. logo-store-on-ingest — pick the
  path that reuses the most existing server code.
- Exact dev override mechanism for `STATIONS_BASE` (env-gated constant vs. About-panel
  backend toggle already present via `setBackendOverride`).
