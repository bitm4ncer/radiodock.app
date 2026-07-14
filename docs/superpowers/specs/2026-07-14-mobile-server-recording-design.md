# Mobile Server-Side Recording ("Server-Tape") — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Repos touched:** `RadioDock-Stations` (VPS record endpoints) + `radiodock.app` (PWA mobile client)

## Goal

Re-enable radio recording on **mobile** (currently hidden because it's broken there), by moving capture to the server. Desktop keeps its existing client-side path unchanged. A mobile recording ends up in the notes feed as the same tape-player card as on desktop.

## Why the client-side path can't work on mobile

The desktop capture path is:

`<audio crossorigin>` → `MediaElementSource` → `MediaStreamDestination` → `MediaRecorder`

On iOS/WebKit, **`createMediaElementSource()` is broken** ([WebKit bug 211394](https://bugs.webkit.org/show_bug.cgi?id=211394)): the Web Audio graph receives only zeros (→ **empty recording**), while WebKit still routes the element to the speaker (→ **double audio with delay**). All iOS browsers are WebKit (including installed PWAs), so this affects every iOS variant. The other client-side options (`element.captureStream()`, `getUserMedia`) are unsupported or mic-only. Raw streaming `fetch()` of the relay is the only client-side candidate, but iOS's history of buffering fetch bodies makes it unreliable for an infinite stream.

**Key insight that makes server-side work on iOS:** the iOS client can't read an *infinite* stream, but it can reliably `fetch()` a **finite, completed file** (normal download with `Content-Length`). So the server buffers the recording; the client fetches the finished file at the end.

## Architecture (mobile only)

- **Desktop** (`pointer: fine`): unchanged — client-side `MediaRecorder→Opus` via the relay (`src/player/recorder.js`).
- **Mobile** (`pointer: coarse`): the VPS records with its own upstream connection (independent of the client), buffers to a temp file, and hands the finished file to the client, which stores it in IndexedDB and renders the tape card. The main player keeps playing the station directly — **no second client-side audio element, so no double audio.**

Because the server records on its own connection, **background recording works**: the user can start a recording, leave/close the app, and fetch the finished file on return.

## Server — `RadioDock-Stations/server/api/record.js`

Three endpoints. UUID-lookup only (stream URL resolved from the DB, never client-supplied → SSRF-safe, same as the relay/logo CDN). Rate-limited. **No transcoding** (raw byte passthrough → minimal CPU).

- `POST /api/record/start` `{ uuid }` → validate UUID; resolve stream URL; start fetching upstream → write to `data/rec-tmp/<id>.<ext>` (ext from upstream content-type). Returns `{ id, mime }` where **`id` is an unguessable random capability token** (there is no user auth — the token is what authorizes stop/fetch).
- `POST /api/record/stop` `{ id }` → abort the upstream fetch, finalize the file. Returns `{ id, bytes, mime, durationMs }`.
- `GET /api/record/fetch?id=<id>` → stream the finished file to the client (finite, with `Content-Length`), then **delete the temp file after a successful transfer**.

The upstream URL is fetched **as-is** (no https-upgrade — the server has no mixed-content constraint and http-only stations must keep working), mirroring the relay.

### No-residue cleanup (the hard requirement)

Recordings must never accumulate on the server:

1. **Delete-on-fetch** — the normal path leaves nothing behind.
2. **Hard max-duration** — server auto-stops + finalizes at the cap; the finished file is kept for a short **grace window** (so a maxed-out background recording can still be fetched), then swept.
3. **Orphan sweeper** — a periodic timer (every ~5 min) plus a boot-time sweep deletes any `rec-tmp/` file older than `maxDuration + grace`, or with no active in-memory recording. File-mtime-based so it survives a server restart (which loses the in-memory recording map).
4. **Concurrency cap** — `POST /record/start` returns `503` when the number of active recordings hits the cap.
5. **Disk-quota guard** — `start` returns `503` when `rec-tmp/` exceeds a size cap.

Active recordings are tracked in an in-memory `Map<id, { filePath, startedAt, upstreamController, maxTimer }>`.

### Resource envelope

- **Disk peak** = concurrency cap × max-duration × bitrate. E.g. 10 × 30 min × 128 kbps ≈ **280 MB** against ~26 GB free.
- **CPU** ≈ negligible (passthrough writes, no transcode).
- **Network** = one upstream fetch per active recording, bounded by the concurrency cap.

## Client (PWA, mobile only)

### Data / handle persistence

Starting a recording writes a **pending-recording handle** to IndexedDB as a single `prefs` key `pendingRecording` = `{ id, mime, uuid, station snapshot, startedAt }` (via the existing `getPref`/`setPref`; one in-flight mobile recording at a time). Cleared on successful save or expiry. This survives app restarts so a background recording can be finished on return.

### Flow

1. **Rec button on mobile** is re-enabled (it was hidden). Placement unchanged (top bar next to search, per the existing app-mode logic).
2. **Start** → `POST /record/start` → persist the handle → button enters recording state (pulse + client-side elapsed timer). The main player keeps playing normally.
3. **Foreground stop** (tap) → `POST /record/stop` → transient "fetching…" state → `GET /record/fetch` → blob → `notes.createRecording(...)` → tape card + notes panel opens. Clear the pending handle.
4. **Background / app closed** → server keeps recording. **On return** (app boot or visibilitychange→visible), if a pending handle exists, show a banner: *"Recording in progress — finish & save?"* → same stop + fetch + save flow. (If the server already auto-stopped at max-duration, `stop` is idempotent and `fetch` still returns the finished file within the grace window; if it was already swept, show "recording expired" and clear the handle.)
5. Track metadata (the now-playing show at start) is snapshotted client-side at start and stored on the note, same as desktop.

### Recording note

Identical to desktop: `type: 'recording'`, blob in the `recordings` IDB store, tape-player card with spinning reels, download-then-delete. The blob's `mime` is the native codec (e.g. `audio/mpeg`), which plays in `<audio>` and downloads as `.mp3`/`.aac`.

## Limits (approved defaults, tunable)

- **Max duration (mobile):** 30 min (server auto-stop; bounds orphan cost). Desktop stays 60 min.
- **Server concurrency cap:** 10 simultaneous recordings.
- **`rec-tmp/` disk quota:** 1 GB.
- **Client storage budget:** 500 MB (unchanged).
- **Grace window** after max-duration/stop before sweep: ~10 min.

## Error handling

- `start` `503` (cap/quota) or network error → toast "Recording not available right now", clear any half-written handle.
- Upstream fails immediately server-side → `start` still returns an id but `stop` reports `bytes: 0` → client shows "Recording was empty", no card.
- `fetch` fails mid-download (mobile network drop) → keep the handle; user can retry fetch; orphan sweeper eventually reclaims if abandoned.
- Pending handle whose `fetch` returns 404 (already swept) → "recording expired", clear handle.

## Docs / legal (must update)

Unlike the relay (which **never** persists), mobile recording **briefly buffers** bytes on the server. Update:
- `RadioDock-Stations/CLAUDE.md` — extend the recording exception: mobile recording temp-buffers to `rec-tmp/` and deletes immediately after transfer (delete-on-fetch + orphan sweeper; capped; never long-term).
- PWA legal page — "when you record on mobile, the stream is briefly buffered on our server and deleted immediately after it is transferred to your device."

## Verification

- **Server (`node --test`):** start creates a temp file from a fake upstream; stop finalizes; fetch returns the bytes and deletes the file; over-cap → 503; over-quota → 503; orphan sweeper deletes an aged temp file; unknown/short id → 404.
- **PWA (Claude Preview + on-device):** mobile mode shows the record button; start→stop→fetch produces a tape card with real bytes; **on-device iPhone test** confirms no double audio, non-empty file, and the background→return→finish flow. (The iOS finite-file `fetch` is the crux the on-device test must confirm.)

## Out of scope (v1)

- Live byte-size readout during recording (server holds the bytes; client shows elapsed time only).
- Pause/resume.
- HLS stations on mobile (native iOS HLS is not a byte stream).
- More than one concurrent recording per client.
- Switching desktop to the server path (desktop stays client-side).

## Implementation order (two-repo)

1. **Stations repo:** `record.js` (start/stop/fetch + cleanup) + tests + CLAUDE.md exception. Deploy + verify live with curl.
2. **PWA data:** pending-recording handle persistence in `storage.js`; a `data/record-client.js` that wraps start/stop/fetch against the Stations base URL.
3. **PWA capture split:** route mobile → server path, desktop → existing `recorder.js`. Re-enable the mobile record button.
4. **PWA UX:** recording state + elapsed timer; "fetching…" state; on-return banner + finish flow; save → tape card.
5. **PWA:** analytics events, legal note, ROADMAP.
6. **On-device iPhone verification** (user) — the go/no-go gate for shipping mobile.
