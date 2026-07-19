# Consolidated station-info endpoint + socials in the info panel

**Date:** 2026-07-19
**Repos:** `radiodock.app` (PWA), `RadioDock-Stations` (server + dashboard)
**Status:** design approved (verbally), spec for review

## Goal

Show a station's curated metadata — genres/tags, website, city, country, socials,
contact email — in the PWA's station-info panel, sourced from **one** public
endpoint on our own server instead of the Radio-Browser-shaped by-uuid mirror
plus ad-hoc lookups. Make `countrycode` editable in the dashboard so country is
curatable like the other fields. Keep the info panel a popup (no relocation).

## Non-goals

- Not moving the info panel into the player (dropped — it's reused by the new
  Discover page, so the popup stays).
- Not touching the RB-compatible `/json/stations/*` endpoints — they stay exact
  Radio Browser mirrors.
- Not embedding socials into `community-radios.json` (avoids touching the
  byte-clean publish pipeline; the endpoint serves any DB station, not only
  published community members).
- Wikipedia stays a separate external lookup (can't be consolidated).

## Current state (verified)

- PWA info panel (`src/ui/station-info.js`) renders from three sources: the
  passed station object, a `getStationByUuid` call (RB-mirror
  `stations.radiodock.app/json/stations/byuuid/:uuid`, via `stations-source.js`
  with a Radio Browser fallback), and Wikipedia. It shows: hero/logo, name, tags,
  About (wiki), Stream (format/codec/bitrate/country), and actions (Visit
  homepage / Copy stream URL).
- `community-radios.json` per-station shape is only
  `{countrycode, favicon, homepage, id, name, url}` — **no socials/city**.
- Server: `GET /json/stations/byuuid/:uuid` (`server/api/stations.js:40`) returns
  `[repo.toStationJson(getMergedByUuid(uuid))]` (RB array shape). Socials live in
  `station_socials` (`server/db/socials.js`, `SOCIAL_PLATFORMS` = instagram,
  soundcloud, mixcloud, bandcamp, youtube, facebook, x, tiktok). `city` and
  `contact_email` live on `station_overrides`; `countrycode` is already in the
  override whitelist (`server/db/stations.js` setOverride/clearOverrideFields).
- Dashboard: `dashboard/src/ui/socials-section.js` already edits city +
  contactEmail + the 8 socials, saving via `saveOverride(field, value)` (override
  PUT) and per-platform socials PUT. **Country has no UI field yet.**

## Design

### 1. Server — new public endpoint `GET /api/stations/:uuid`

Returns our curated station shape (NOT the RB mirror):

```json
{
  "id": "961e6cac-…",
  "name": "NTS Radio 1",
  "url": "http://stream-relay-geo.ntslive.net/stream",
  "homepage": "http://www.nts.live/",
  "countrycode": "GB",
  "city": "London",
  "tags": ["community radio", "dj sets", "eclectic", "freeform"],
  "codec": "MP3",
  "bitrate": 256,
  "contactEmail": "hello@nts.live",
  "socials": [
    { "platform": "instagram", "url": "https://instagram.com/…" },
    { "platform": "soundcloud", "url": "https://…" }
  ]
}
```

- Source: `getMergedByUuid(uuid)` (merged_stations row, overrides applied) +
  `makeSocialsRepo(db).list(uuid)` + `city`/`contact_email` from the merged row
  or the override (`getOverride(uuid)`). `tags` split from the merged tags string
  into an array. `codec`/`bitrate` from the merged row.
- 404 (empty body `{}` with 404, or `{ ok:false }`) when the uuid is unknown, so
  the client can fall back to Radio Browser.
- Read-only, no auth. CORS already allows `radiodock.app` (global `cors`
  middleware). Add a modest `makeRateLimit` (reuse the shared limiter) since this
  route is outside the `/json` budget.
- Lives in `server/api/stations.js` (a non-`/json` route on the same router) or a
  tiny sibling module — decide in the plan; must reuse the socials repo, so
  passing `db` is enough. The `/json/*` mirror endpoints are untouched.

### 2. Dashboard — Country editable

Add a **Country** input to the "Socials & location" section
(`dashboard/src/ui/socials-section.js`), next to City. Two-letter code
(e.g. `GB`), saves on blur via the existing `saveOverride('countrycode', value)`
→ override PUT (whitelist already permits `countrycode`). The endpoint above and
the community regenerate/publish already read `countrycode` from the merged row,
so an edit flows through without further changes.

### 3. PWA — info panel

- New client `getStationInfo(uuid)` in `src/data/stations-api.js` (or a small
  `station-info-client` module): `GET ${STATIONS_BASE}/api/stations/:uuid`,
  returns the parsed object or `null` on 404/error.
- `src/data/stations-source.js`: the info panel's primary lookup becomes
  `getStationInfo(uuid)`; on `null` (station not in our DB — e.g. a raw Radio
  Browser search result the user saved), fall back to the existing
  `getStationByUuid` → Radio Browser path (tags/codec only, no socials/city).
  Custom `custom-*` ids skip both (already handled).
- `src/ui/station-info.js` render additions:
  - **Socials row:** a row of clickable platform icons (reuse the SVGs from the
    dashboard `socials-section.js`) linking out (`target="_blank" rel="noopener"`),
    shown only when `socials` is non-empty. Ordered by `SOCIAL_PLATFORMS`.
  - **City:** shown in the Stream/meta block next to Country (`City · Country`),
    when present.
  - **Contact:** a discreet `mailto:` link ("Contact") when `contactEmail` is
    present.
  - Genres/tags, Website (Visit homepage), Country stay as they are.
- Analytics: keep the existing `station-info-open` event; optionally add a
  `social` count. Track social-link clicks is out of scope (YAGNI).

## Data flow

```
Info panel open (community/known uuid)
  → getStationInfo(uuid)  → GET /api/stations/:uuid  → {tags,city,country,socials,contact,codec,bitrate}
      (404 → getStationByUuid → Radio Browser fallback: tags/codec only)
  ‖ Wikipedia lookup (unchanged, external)
  → render: hero, name, tags, About(wiki), Stream(format/codec/bitrate/city·country),
            Socials row, actions (Visit homepage / Copy URL / Contact mailto)

Dashboard edit: Country input → saveOverride('countrycode') → override PUT
  → merged_stations reflects it → endpoint + community regenerate/publish read it
```

## Error handling

- Endpoint 404 / network error → client returns `null` → RB fallback; panel still
  renders from the passed station + wiki. No socials/city shown (graceful).
- Empty socials / missing city / missing contact → those rows omitted.
- Malformed social URL from the DB → still rendered as given (curated data,
  trusted); `rel="noopener"` on all outbound links.

## Testing

- Server: unit test the endpoint (in-memory DB, seed a station + socials + city +
  contact + countrycode override) → assert the JSON shape; assert 404 for unknown
  uuid; assert `/json/stations/byuuid` output is unchanged (RB mirror intact).
- Dashboard: manual — Country field saves and round-trips (build check + click).
- PWA: `getStationInfo` client unit test (fetch stub: 200 shape, 404 → null).
  Behavioural (Preview MCP): open info for a community station (e.g. NTS) → socials
  icons render + link out, city + country show, contact mailto present; open info
  for a custom stream → no socials, no error.
- Local end-to-end against a local server before deploy; nothing pushed without
  approval.

## Open decisions resolved

- Consolidate our data into ONE new dedicated endpoint (not extend the RB mirror). ✔
- Endpoint is primary; Radio Browser stays fallback for non-DB stations. ✔
- Contact email shown as a discreet `mailto:` link. ✔
- Country editable in the dashboard (added to the location section). ✔
