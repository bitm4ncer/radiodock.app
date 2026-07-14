# Tape Recording in Notes ("Mixtape") — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Repos touched:** `radiodock.app` (PWA, primary) + `RadioDock-Stations` (VPS relay endpoint)

## Goal

Let users record the live radio stream into their notes — like taping the radio for
samples or mixtapes. A recording appears in the notes feed as a small, left-aligned
**tape player** card (voice-message-shaped, but styled as a cassette with spinning
SVG reels). Recording is triggered from a round red-dot **Rec button** in the notes
panel, and while recording a physically-behaving **cable** visually connects the
player card and the notes panel on desktop.

## The core technical problem: CORS

Two browser-native ways to capture playing audio both fail on RadioDock's streams:

1. **Web Audio capture** (`MediaElementSource` → `MediaRecorder`): a cross-origin
   media element **without** CORS outputs **silence** by security design. RadioDock
   forbids `crossorigin` on the main `<audio>` precisely because streams lack CORS
   (see `radiodock.app/CLAUDE.md`), so this yields a silent file.
2. **Direct `fetch()` of stream bytes**: a cross-origin stream without
   `Access-Control-Allow-Origin` gives an opaque `no-cors` response with no readable
   body.

Most community stations send no CORS headers. **Therefore recording is not possible
purely client-side.** It requires a cooperating proxy that re-serves the stream with
a CORS header. Once bytes flow through such a proxy, everything else (capture,
encode, store, play, download) is fully client-side.

## Architecture decision: relay on the Hetzner Stations VPS

The relay lives as a new endpoint in **`RadioDock-Stations/server/api/relay.js`**
(always-on Express server, existing deploy pipeline, existing `cors.js` +
`rate-limit.js`). **Not** the Render metadata proxy (free tier spins down, unfit for
continuous streaming) and **not** the metadata-proxy repo.

### Hard-rule exception (must be documented)

`RadioDock-Stations/CLAUDE.md` currently forbids stream proxying:

> "Streams are the deliberate exception. Audio always connects directly … proxying
> 60k live streams is unworkable (bandwidth) and would make the VPS a hard dependency
> for playback." + hard rule: "Never build a feature that makes the VPS a hard
> dependency for playback or search."

The recording relay is a **deliberate, narrow exception**, approved on 2026-07-14.
Rationale that keeps the rule's *intent* intact:

- Relay runs **only during opt-in recording**, one stream per user, capped — not "all
  playback for all users."
- Normal playback stays direct. If the VPS is down, **only recording is unavailable**;
  playback and search are untouched. The fallback invariant holds.
- Bandwidth is negligible (~57 MB/h per 128k recording vs. Hetzner's ~20 TB/mo).
- No server storage: the recorded blob lives in the client's IndexedDB; the VPS pipes
  bytes through and never persists them.

**Documentation tasks (part of implementation):**
- Add the recording-relay exception to `RadioDock-Stations/CLAUDE.md` (Single-origin
  assets section + Hard rules), stating it is opt-in, capped, non-persistent, and does
  not make playback VPS-dependent.
- Update the PWA legal page: "when you record, the stream is routed through our server
  (`stations.radiodock.app`) instead of connecting directly."

### Relay endpoint contract

`GET /api/relay?uuid=<stationUuid>`

- **UUID lookup only** — the server resolves the stream URL from its own stations DB
  by UUID. It **never accepts a client-supplied URL**, mirroring the logo-CDN's
  SSRF-safe precedent (`server/api/logos.js`). No open-proxy / SSRF surface.
  - Consequence: recording works only for stations present in the Stations DB (which
    mirrors ~all 60k Radio Browser stations, so nearly universal in practice). A
    not-yet-synced station cannot be recorded.
- **Pure passthrough:** fetch upstream, pipe bytes through unchanged. **No transcoding
  on the server** (keeps CPU minimal). Sets `Access-Control-Allow-Origin` (existing
  CORS allowlist) and forwards the upstream `Content-Type`.
- **HTTPS-upgrade** the upstream URL on secure contexts (same policy as the PWA's
  `preferHttps`).
- **Guardrails (good-tenant, shared box):**
  - Concurrency cap (e.g. 20 simultaneous relays); over-cap returns `503`.
  - Per-connection max duration = client max recording length (hard server-side stop).
  - Idle/stall timeout.
  - **Abort the upstream fetch when the client disconnects** (no leaked sockets).
  - Rate-limit via existing `rate-limit.js`.

## Client capture pipeline — `radiodock.app/src/player/recorder.js`

Chosen approach: **MediaRecorder → Opus** (smaller uniform files, HLS-capable,
re-encode runs in the user's browser = zero extra VPS load).

- A **dedicated** `<audio crossorigin="anonymous">` element (separate from the main
  player element, which stays CORS-free per CLAUDE.md), `src = relayUrl(uuid)`.
- `AudioContext` → `createMediaElementSource` → `createMediaStreamDestination` →
  `MediaRecorder(dest.stream, { mimeType })`.
  - The recording element's graph is routed **only** to the recorder destination (not
    to speakers) — no double audio. The user keeps hearing the main (direct) element.
  - Consequence: the station is fetched twice during recording (main direct + relay).
    Accepted for v1; possible later unification (route playback through the relay while
    recording) is out of scope.
- **MIME selection** via `MediaRecorder.isTypeSupported()`, first supported wins:
  `audio/webm;codecs=opus` → `audio/ogg;codecs=opus` → `audio/mp4` (Safari/AAC).
- **Live progress:** `MediaRecorder` with a `timeslice`; accumulate chunk byte sizes
  and elapsed wall-clock, emit progress events (bytes + seconds) for the Rec button HUD.
- **Auto-stop** at max length (client timer; server also enforces).
- **Budget check before start:** sum stored recording bytes + `navigator.storage
  .estimate()`; refuse/warn per thresholds below.
- **On stop:** assemble `Blob`, compute duration (recording wall-clock), write via the
  notes facade → card appears in the feed.
- **Stream drop mid-recording:** keep the partial recording (stop + save what exists),
  surface a toast. Do not silently discard.
- **iOS/background:** recording requires the initiating tap gesture (present).
  Background/lock-screen recording is unreliable; recording is a foreground activity.
  UX copy warns "keep the app open while recording."

The recorder module exposes `mountRecorder(...)` returning callbacks
(`start`, `stop`, `on(event)`) consistent with the project's UI-module convention.
`main.js` wires it to storage and UI.

## Data model — `radiodock.app/src/data/`

- New note type `type: 'recording'` alongside `'note' | 'capture'` in the `notes`
  store. The note record carries display metadata only: `durationMs`, `bytes`, `mime`,
  station snapshot, track snapshot (if any), `createdAt`.
- **Separate IndexedDB store `recordings`**: `{ id (= note id), blob, mime, bytes,
  durationMs }`. Keeping blobs out of the `notes` store keeps feed listing light —
  blobs load only on playback.
- `storage.js`: `putRecordingAudio(id, blob, meta)`, `getRecordingAudio(id)`,
  `deleteRecordingAudio(id)`; schema version bump + migration to add the store.
- `notes.js` facade: `createRecording({ pageId, station, track, blob, mime, durationMs,
  bytes })`; `deleteNote` cascades to delete the audio blob. Export/import
  (`import-export.js`, `notes-export.js`) handling of recordings is **out of scope for
  v1** (recordings are download-only; see below).

## UI — Rec button — `radiodock.app/src/ui/notes-panel.js`

- Round button, red dot, injected **left of** the existing `.notes-panel__capture-btn`
  ("Save Moment"), same height. New classname `notes-panel__record-btn`.
- States:
  - **idle** — solid red dot; enabled only when a station is playing AND under budget.
  - **recording** — pulsing red ring + live `MM:SS` + `NN MB` readout; tap to stop.
  - **disabled** — no station, or over storage budget (tooltip explains).
- Reuses existing capture-button enable/disable pattern (`refreshCaptureBtnState`).

## UI — Tape-player note card — `radiodock.app/src/ui/notes-panel.js` (card renderer)

Left-aligned feed card for `type: 'recording'`, voice-message-shaped but a mini
cassette:

- Two **SVG reels** that rotate while playing (CSS animation, paused when stopped).
  Optional flourish: reel radii shift to fake tape spooling.
- Play/pause, progress scrubber, elapsed/duration, station logo + name + timestamp.
- **Download button** → downloads the blob (`station-YYYYMMDD-HHmm.webm`). On download,
  a `confirm()` (via `modal-helpers`) asks **"Aufnahme aus Notizen löschen?"** —
  optional delete after download.
- Card menu: delete (undo toast, cascades audio delete).
- Playback: `URL.createObjectURL(blob)` on a per-card `<audio>`, **revoked on card
  teardown** (no object-URL leaks).

## UI — The cable (desktop flourish) — new `radiodock.app/src/ui/recording-cable.js`

- A fixed, full-viewport SVG overlay (`pointer-events: none`), visible **only while
  recording**.
- Two anchor points: the player container `#app` and the notes panel.
- One `<path>` drawn as a **catenary/quadratic sag** between the anchors; anchor
  positions recomputed on window drag (`pointermove`) and `resize` via
  `requestAnimationFrame`.
- Optional v1.1: damped spring wobble on drag-release ("swings naturally").
- **Desktop only** (`matchMedia('(pointer: fine)')` and both windows present). Mobile
  has no free-dragged windows → no cable.

## Limits (approved defaults)

- **Max length per recording:** 60 min (client auto-stop + server hard-stop).
- **Total storage budget:** 500 MB across all recordings. Warn at 80%, block new
  recordings at 100%. Uses summed blob bytes and `navigator.storage.estimate()`.
- **Live readout** on the Rec button during recording.
- **No auto-delete timer.** Retention is user-driven via the download-then-optionally-
  delete flow.

## Analytics — `radiodock.app/src/analytics/`

Umami events (consistent with existing ladder): `recording-started`,
`recording-stopped` (duration + size buckets), `recording-downloaded`,
`recording-deleted`, `recording-relay-fallback`, `recording-blocked-budget`.
No audio content or PII.

## Error handling

- Relay `503` (over cap) / network error → toast "Aufnahme gerade nicht möglich",
  no card created.
- `MediaRecorder` unsupported / no supported MIME → feature hidden (button not shown).
- Budget exceeded → button disabled with explanatory tooltip; attempt shows toast.
- Stream drop mid-recording → save partial + toast.
- IndexedDB write failure → toast, discard blob, no orphan note.

## Verification (Claude Preview MCP)

- Rec button appears left of Save Moment, correct states, disabled without station.
- A recording produces a `type: 'recording'` note with a non-empty Opus blob in the
  `recordings` store (inspect via `preview_eval` on IndexedDB).
- Tape card renders, reels animate on play, scrubber works, download triggers the
  delete-confirm.
- Cable overlay appears only while recording, tracks both windows on drag, absent on
  mobile viewport (`preview_resize`).
- Budget block: simulate near-quota, confirm button disables.

## Out of scope (v1)

- Server-side recording / server storage of audio.
- Export/import of recordings in the JSON backup envelope (download-only for now).
- Unifying playback + record into a single relay fetch (double-fetch accepted).
- Cable wobble physics (v1.1 candidate).
- Trimming/editing recordings; multi-clip mixtape assembly.

## Implementation order (two-repo)

1. **Stations repo:** `relay.js` endpoint (UUID lookup, passthrough, CORS, guardrails)
   + CLAUDE.md exception note. Deploy + verify with a known station UUID.
2. **PWA data layer:** `recordings` store + migration, `storage.js` + `notes.js`
   additions.
3. **PWA capture:** `recorder.js` pipeline + `main.js` wiring.
4. **PWA UI:** Rec button, tape card renderer, download/delete flow.
5. **PWA flourish:** `recording-cable.js` (desktop).
6. **PWA:** analytics events, legal-page note.
7. ROADMAP.md entries in both repos.
