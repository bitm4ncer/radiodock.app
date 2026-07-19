# Consolidated Station-Info Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a station's curated metadata (tags, homepage, city, country, socials, contact, codec, bitrate) from one public server endpoint and render socials + city + contact in the PWA station-info panel; make country editable in the dashboard.

**Architecture:** New public `GET /api/stations/:uuid` on the Stations server joins `merged_stations` + `getOverride` (city/contact) + `makeSocialsRepo` (socials) into our own JSON shape. The PWA info panel calls it as the primary lookup and falls back to the existing Radio-Browser `getStationByUuid` for stations not in our DB. The RB-compatible `/json/stations/*` mirror is untouched.

**Tech Stack:** Node 22 + Express + better-sqlite3 (server); vanilla ES modules + Vite (PWA). Tests: `node:test` in both repos.

## Global Constraints

- **Two repos.** Server = `C:\GitHub\RadioDock-Stations` (server + dashboard). PWA = `C:\GitHub\radiodock.app`.
- **Nothing is pushed** until the user approves; work on feature branches, commit locally.
- **Deploy order when shipping: server FIRST, then PWA** (the PWA calls the new endpoint; if the PWA shipped first it would 404 → RB fallback with no socials).
- **Do NOT modify `/json/stations/*`** — they stay exact Radio Browser mirrors.
- **Social platform whitelist + order (verbatim):** `instagram, soundcloud, mixcloud, bandcamp, youtube, facebook, x, tiktok` (`server/db/socials.js#SOCIAL_PLATFORMS`).
- **CORS already allows** `radiodock.app` (global `cors` middleware) — no CORS change needed.
- **PWA hard rules (CLAUDE.md):** vanilla JS, reuse existing classnames, escape all interpolated strings, `rel="noopener"` on outbound links.
- Server `merged_stations` has: name, url, homepage, favicon, tags, countrycode, codec, bitrate (from upstream). It does **NOT** have city/contact_email — read those from `getOverride(uuid)` (the `station_overrides` row).

---

## File Structure

**Server (`RadioDock-Stations`):**
- Modify `server/api/stations.js` — add `GET /api/stations/:uuid` route + a `toStationInfoJson` helper (or inline builder).
- Create `test/station-info-endpoint.test.js` — endpoint shape + 404 + RB-mirror-unchanged.
- Modify `dashboard/src/ui/socials-section.js` — add a Country input saving via `saveOverride('countrycode', …)`.

**PWA (`radiodock.app`):**
- Modify `src/data/stations-api.js` — add `getStationInfo(uuid)`.
- Create `test/station-info-client.test.js` — 200 shape + 404 → null.
- Modify `src/ui/station-info.js` — socials row + city + contact rendering; primary=getStationInfo, RB fallback.
- Create `src/ui/social-icons.js` — `SOCIAL_ICONS` map (platform → inline SVG), reused from the dashboard.

---

# PART A — Server (RadioDock-Stations)

> Branch: `cd /c/GitHub/RadioDock-Stations && git checkout -b feat/station-info-endpoint` (after ensuring a clean tree; `npm install` if needed, `npm test` green baseline).

### Task S1: `GET /api/stations/:uuid` endpoint

**Files:**
- Modify: `server/api/stations.js`
- Test: `test/station-info-endpoint.test.js`

**Interfaces:**
- Consumes: `makeStationsRepo(db)` → `.getMergedByUuid(uuid)`, `.getOverride(uuid)`; `makeSocialsRepo(db)` from `../db/socials.js` → `.list(uuid)` returns `[{platform, url, origin}]`.
- Produces: `GET /api/stations/:uuid` → `200` JSON `{ id, name, url, homepage, countrycode, city, tags:[...], codec, bitrate, contactEmail, socials:[{platform,url}] }`, or `404 { ok:false }` for unknown uuid. `/json/stations/byuuid/:uuid` output unchanged.

- [ ] **Step 1: Write the failing test**

Create `test/station-info-endpoint.test.js`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDb } from '../server/db/connection.js';
import { migrate } from '../server/db/migrate.js';
import { makeStationsApi } from '../server/api/stations.js';
import { makeStationsRepo } from '../server/db/stations.js';
import { makeSocialsRepo } from '../server/db/socials.js';

function appWithSeed() {
  const db = createDb(':memory:');
  migrate(db);
  // Seed one upstream station + an override (city/contact/country) + socials.
  db.prepare(`INSERT INTO stations_upstream
    (stationuuid, name, url, url_resolved, homepage, favicon, tags, countrycode, codec, bitrate)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'uuid-1', 'Test FM', 'http://ex.com/s', 'http://ex.com/s', 'http://ex.com',
    '', 'jazz,soul', 'GB', 'MP3', 256);
  const repo = makeStationsRepo(db);
  repo.setOverride('uuid-1', { city: 'London', contact_email: 'hi@ex.com', countrycode: 'GB' });
  makeSocialsRepo(db).set({ stationuuid: 'uuid-1', platform: 'instagram', url: 'https://instagram.com/x' });
  const app = express();
  app.use(makeStationsApi(db));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  return { server, port: server.address().port };
}

test('GET /api/stations/:uuid returns the consolidated curated shape', async () => {
  const { server, port } = await listen(appWithSeed());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stations/uuid-1`);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.id, 'uuid-1');
    assert.equal(j.city, 'London');
    assert.equal(j.contactEmail, 'hi@ex.com');
    assert.equal(j.countrycode, 'GB');
    assert.equal(j.codec, 'MP3');
    assert.equal(j.bitrate, 256);
    assert.deepEqual(j.tags, ['jazz', 'soul']);
    assert.deepEqual(j.socials, [{ platform: 'instagram', url: 'https://instagram.com/x' }]);
  } finally { server.close(); }
});

test('GET /api/stations/:uuid 404s for an unknown uuid', async () => {
  const { server, port } = await listen(appWithSeed());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stations/nope`);
    assert.equal(res.status, 404);
  } finally { server.close(); }
});

test('the RB mirror /json/stations/byuuid still returns an array', async () => {
  const { server, port } = await listen(appWithSeed());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/stations/byuuid/uuid-1`);
    const j = await res.json();
    assert.ok(Array.isArray(j) && j[0].stationuuid === 'uuid-1');
  } finally { server.close(); }
});
```

- [ ] **Step 2: Confirm seed columns exist**

Run: `grep -n "stationuuid\|codec\|bitrate\|tags\|countrycode" server/db/migrations/001-init.sql | head`
Expected: `stations_upstream` has these columns (the INSERT in the test must match real column names). If a column name differs, fix the test's INSERT before running. `repo.setOverride` accepts `city`/`contact_email`/`countrycode` (whitelist in `server/db/stations.js`).

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/station-info-endpoint.test.js`
Expected: FAIL — `/api/stations/:uuid` route does not exist (404 for the first test's happy path, or JSON shape mismatch).

- [ ] **Step 4: Implement the endpoint**

In `server/api/stations.js`, add the socials import at the top:
```js
import { makeSocialsRepo, SOCIAL_PLATFORMS } from '../db/socials.js';
```
Inside `makeStationsApi(db)`, after `const repo = makeStationsRepo(db);`, add:
```js
  const socials = makeSocialsRepo(db);

  // Our own consolidated station-info shape (NOT the RB mirror). Curated data
  // for the PWA info panel: tags + stream meta from the merged row, city/contact
  // from the override row, socials from station_socials.
  function toStationInfoJson(uuid, merged, override) {
    const tags = String(merged.tags ?? '')
      .split(',').map((t) => t.trim()).filter(Boolean);
    const rows = socials.list(uuid); // [{platform, url, origin}] ordered by platform
    const ordered = SOCIAL_PLATFORMS
      .map((p) => rows.find((r) => r.platform === p))
      .filter(Boolean)
      .map((r) => ({ platform: r.platform, url: r.url }));
    return {
      id: uuid,
      name: merged.name ?? '',
      url: merged.url_resolved || merged.url || '',
      homepage: merged.homepage ?? '',
      countrycode: merged.countrycode ?? '',
      city: override?.city ?? '',
      tags,
      codec: merged.codec ?? '',
      bitrate: merged.bitrate ?? 0,
      contactEmail: override?.contact_email ?? '',
      socials: ordered,
    };
  }
```
Then add the route (a non-`/json` route, so it is outside the `/json` rate-limit budget — give it its own modest limit), before `return router;`:
```js
  router.get('/api/stations/:uuid', makeRateLimit({ max: 240 }), (req, res) => {
    const uuid = String(req.params.uuid).slice(0, 64);
    const merged = repo.getMergedByUuid(uuid);
    if (!merged) return res.status(404).json({ ok: false });
    const override = repo.getOverride(uuid);
    res.set('Cache-Control', 'public, max-age=300');
    res.json(toStationInfoJson(uuid, merged, override));
  });
```
(`makeRateLimit` is already imported in this file.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/station-info-endpoint.test.js`
Expected: PASS (all three tests).

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: green (no regressions in the RB endpoints or elsewhere).

- [ ] **Step 7: Commit**

```bash
git add server/api/stations.js test/station-info-endpoint.test.js
git commit -m "feat(api): public GET /api/stations/:uuid — consolidated curated station info"
```

---

### Task S2: Dashboard — Country editable in the location section

**Files:**
- Modify: `dashboard/src/ui/socials-section.js`

**Interfaces:**
- Consumes: the existing `render({ socials, city, contactEmail })`, the `saveOverride(field, value, inputEl, prev)` helper, and the `/stations/:uuid/socials` GET that returns `{ socials, city, contactEmail, platforms }`.
- Produces: a Country input (2-letter code) beside City that persists `countrycode` via `saveOverride('countrycode', value)`.

- [ ] **Step 1: Read the current City/contact wiring**

Run: `grep -n "city\|contactEmail\|saveOverride\|labelledInput\|country" dashboard/src/ui/socials-section.js`
Confirm the shape of `saveOverride(field, value, inputEl, prev)` and how `cityInput`/`emailInput` are appended. The GET response also carries `countrycode`? Run: `grep -n "countrycode\|res.json" server/admin/api.js | grep -i social` — the `GET /stations/:uuid/socials` handler returns `{ socials, city, contactEmail, platforms }` and reads `override.city`/`override.contact_email`. Add `countrycode: override.countrycode ?? ''` to that response (Step 3) so the field can prefill.

- [ ] **Step 2: Extend the socials GET to return countrycode**

In `server/admin/api.js`, in the `GET /stations/:uuid/socials` handler (returns `{ socials, city, contactEmail, platforms }`), add the country field:
```js
      country: override.countrycode ?? '',
```
(Place it next to `city:` / `contactEmail:` in the same `res.json({...})`.)

- [ ] **Step 3: Add the Country input in the dashboard section**

In `dashboard/src/ui/socials-section.js`, in `render({ socials, city, contactEmail, country })`:
- Add `country` to the destructured render arg.
- Create a country input mirroring `cityInput`, and append it via `labelledInput`:
```js
    const countryInput = document.createElement('input');
    countryInput.type = 'text';
    countryInput.maxLength = 2;
    countryInput.placeholder = 'e.g. GB';
    countryInput.value = (country ?? '').toUpperCase();
    countryInput.addEventListener('blur', () => {
      const v = countryInput.value.trim().toUpperCase().slice(0, 2);
      countryInput.value = v;
      saveOverride('countrycode', v, countryInput, (country ?? '').toUpperCase());
    });
```
Append it in the same place city/contact are appended, e.g.:
```js
    body.append(
      labelledInput('City', cityInput),
      labelledInput('Country', countryInput),
      labelledInput('Contact email', emailInput),
    );
```
(Match the actual append pattern in the file — if city/contact are appended individually, append `labelledInput('Country', countryInput)` right after the city one. Confirm `saveOverride`'s signature by reading the file; the call above matches `saveOverride(field, value, inputEl, prev)`.)

Also update the caller that invokes `render(...)` to pass `country` from the GET payload — search for where `render({ socials, city, contactEmail })` is called after the fetch and add `country: data.country`.

- [ ] **Step 4: Build the dashboard**

Run: `cd dashboard && npm install && npm run build`
Expected: builds without error.

- [ ] **Step 5: Manual round-trip verification**

Start the server locally and confirm the Country field saves + reloads:
```bash
cd /c/GitHub/RadioDock-Stations
SESSION_SECRET=dev DATA_DIR=./.devdata PORT=3000 node server/index.js &
node pipeline/create-admin.js   # note the token
```
Open `http://127.0.0.1:3000/admin`, log in, open a station's editor → Socials & location → set Country `GB`, blur, reload the drawer → confirm it persisted. Then confirm the new endpoint reflects it:
```bash
curl -s http://127.0.0.1:3000/api/stations/<that-uuid> | grep -o '"countrycode":"[^"]*"'
```
Kill the server (`kill %1`).

- [ ] **Step 6: Commit**

```bash
git add server/admin/api.js dashboard/src/ui/socials-section.js
git commit -m "feat(dashboard): edit country in the location section"
```

Server side complete. Leave both commits on `feat/station-info-endpoint` — do NOT push.

---

# PART B — PWA (radiodock.app)

> Branch: `cd /c/GitHub/radiodock.app && git checkout -b feat/station-info-socials` (clean tree; `node --test test/*.test.js` green baseline).

### Task P1: `getStationInfo(uuid)` client

**Files:**
- Modify: `src/data/stations-api.js`
- Test: `test/station-info-client.test.js`

**Interfaces:**
- Consumes: `STATIONS_BASE` (existing export).
- Produces: `getStationInfo(uuid, { signal } = {}) => Promise<object|null>` — parsed body on `200`, `null` on `404`/non-OK/parse error. Shape: `{ id, name, url, homepage, countrycode, city, tags:[...], codec, bitrate, contactEmail, socials:[{platform,url}] }`.

- [ ] **Step 1: Write the failing test**

Create `test/station-info-client.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getStationInfo } from '../src/data/stations-api.js';
import { STATIONS_BASE } from '../src/data/stations-api.js';

function withFetch(impl, run) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve(run()).finally(() => { globalThis.fetch = orig; });
}

test('getStationInfo returns the parsed body on 200', async () => {
  await withFetch(async (url) => {
    assert.equal(url, `${STATIONS_BASE}/api/stations/uuid-1`);
    return new Response(JSON.stringify({ id: 'uuid-1', city: 'London', socials: [{ platform: 'instagram', url: 'https://x' }] }), { status: 200 });
  }, async () => {
    const r = await getStationInfo('uuid-1');
    assert.equal(r.city, 'London');
    assert.equal(r.socials[0].platform, 'instagram');
  });
});

test('getStationInfo returns null on 404', async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ ok: false }), { status: 404 }),
    async () => { assert.equal(await getStationInfo('nope'), null); },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/station-info-client.test.js`
Expected: FAIL — `getStationInfo` is not exported.

- [ ] **Step 3: Implement the client**

In `src/data/stations-api.js`, add (after `getStationByUuid`):
```js
/**
 * Our consolidated curated station info (tags, city, country, socials, contact,
 * codec, bitrate). Returns null on 404 (uuid not in our DB) or any error, so the
 * caller can fall back to the Radio Browser by-uuid path.
 * @param {string} uuid
 * @param {{signal?: AbortSignal}} [transport]
 */
export async function getStationInfo(uuid, { signal } = {}) {
  const id = String(uuid ?? '').trim();
  if (!id) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${STATIONS_BASE}/api/stations/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
```
(`TIMEOUT_MS` and `USER_AGENT_HEADER` are existing module constants in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/station-info-client.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/stations-api.js test/station-info-client.test.js
git commit -m "feat(data): getStationInfo client for the consolidated endpoint"
```

---

### Task P2: Social icons module

**Files:**
- Create: `src/ui/social-icons.js`

**Interfaces:**
- Produces: `SOCIAL_ICONS` — an object mapping each platform to an inline SVG string; `SOCIAL_ORDER` — the platform order array.

- [ ] **Step 1: Create the module**

Create `src/ui/social-icons.js` (SVGs lifted from the dashboard `socials-section.js` so the two surfaces match):
```js
// Inline platform SVGs for the station-info panel's socials row. Mirrors the
// dashboard's socials-section icons so both surfaces read the same.
export const SOCIAL_ORDER = ['instagram', 'soundcloud', 'mixcloud', 'bandcamp', 'youtube', 'facebook', 'x', 'tiktok'];

export const SOCIAL_LABELS = {
  instagram: 'Instagram', soundcloud: 'SoundCloud', mixcloud: 'Mixcloud',
  bandcamp: 'Bandcamp', youtube: 'YouTube', facebook: 'Facebook', x: 'X', tiktok: 'TikTok',
};

export const SOCIAL_ICONS = {
  instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
  soundcloud: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 16v-4M7 16v-6M10 16v-8M13 16V8"/><path d="M16 16V9a4 4 0 0 1 5 4v0a3 3 0 0 1-3 3h-2"/></svg>',
  mixcloud: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 15v-3M6.5 15V9M10 15v-6M13.5 15V9M17 15v-3"/><circle cx="20" cy="12" r="1.4"/></svg>',
  bandcamp: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 8h16l-4 8H0z" transform="translate(2 0)"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none"/></svg>',
  facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 8h-2a2 2 0 0 0-2 2v11M8 13h6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l16 16M20 4L4 20"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 4v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 7a4 4 0 0 0 4 3.5"/></svg>',
};
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/social-icons.js
git commit -m "feat(ui): social platform icons for the info panel"
```

---

### Task P3: Info panel — socials row, city, contact, endpoint primary

**Files:**
- Modify: `src/ui/station-info.js`
- Modify: `src/styles/station-info.css` (socials row styles)

**Interfaces:**
- Consumes: `getStationInfo` (P1), `getStationByUuid` (existing, RB fallback), `SOCIAL_ICONS`/`SOCIAL_ORDER`/`SOCIAL_LABELS` (P2).
- Produces: the info panel shows a Socials row (icons linking out), a City row in the Stream block, and a Contact mailto link when present.

- [ ] **Step 1: Import the new sources**

In `src/ui/station-info.js`, update imports:
```js
import { getStationByUuid, getStationInfo } from '../data/stations-source.js';
import { SOCIAL_ICONS, SOCIAL_ORDER, SOCIAL_LABELS } from './social-icons.js';
```
Note `getStationInfo` must be re-exported from `stations-source.js`. Add to `src/data/stations-source.js` at the bottom (it does not need fallback wrapping — it already returns null on miss):
```js
export { getStationInfo } from './stations-api.js';
```

- [ ] **Step 2: Make the endpoint the primary lookup with RB fallback**

In `src/ui/station-info.js` `open(station)`, replace the `fullPromise` block:
```js
    const isCustom = String(station.id ?? '').startsWith('custom-');
    const fullPromise = isCustom
      ? Promise.resolve(null)
      : getStationInfo(station.id)
          .then((info) => info ?? getStationByUuid(station.id).catch(() => null))
          .catch(() => getStationByUuid(station.id).catch(() => null));
    const wikiPromise = fetchStationInfo(station.name).catch(() => null);
```
(The rest of `open` — the `fullPromise.then(...)` intermediate render and the `Promise.all` final render — stays; `full` is now either our shape or the RB shape. Both carry `tags`/`codec`/`bitrate`/`countrycode`; only our shape adds `city`/`contactEmail`/`socials`.)

- [ ] **Step 3: Render city in the Stream block**

In `render(...)`, after the Country push:
```js
    if (data.countrycode) streamRows.push(['Country', data.countrycode.toUpperCase()]);
    if (data.city) streamRows.push(['City', data.city]);
```

- [ ] **Step 4: Render the socials row**

In `render(...)`, build a socials block (after `tagsHtml`, before the return). `data.socials` is `[{platform,url}]` (present only from our endpoint):
```js
    const socials = Array.isArray(data.socials) ? data.socials : [];
    const socialsHtml = socials.length
      ? `<div class="station-info__socials">
           ${SOCIAL_ORDER
             .map((p) => socials.find((s) => s.platform === p))
             .filter(Boolean)
             .map((s) => `<a class="station-info__social" href="${escapeHtml(s.url)}" target="_blank" rel="noopener" title="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}" aria-label="${escapeHtml(SOCIAL_LABELS[s.platform] ?? s.platform)}">${SOCIAL_ICONS[s.platform] ?? ''}</a>`)
             .join('')}
         </div>`
      : '';
```
Insert `${socialsHtml}` into the returned template, right after the `</header>` (below the name/tags header):
```js
    return `
      <header class="station-info__header">
        ${heroImage}
        <div class="station-info__meta">
          <div class="station-info__name">${escapeHtml(data.name ?? '')}</div>
          ${tagsHtml}
        </div>
      </header>
      ${socialsHtml}
      ${aboutBlock}
      ${streamHtml}
      ${actions}
    `;
```

- [ ] **Step 5: Render the contact mailto in actions**

In the `actions` template, add a contact link when present:
```js
    const actions = `
      <div class="station-info__actions">
        ${data.homepage
          ? `<a class="btn-secondary station-info__action" href="${escapeHtml(data.homepage)}" target="_blank" rel="noopener">Visit homepage</a>`
          : ''}
        <button type="button" class="btn-secondary station-info__action" data-action="copy-url" data-url="${escapeHtml(data.url ?? '')}">Copy stream URL</button>
        ${data.contactEmail
          ? `<a class="btn-secondary station-info__action" href="mailto:${escapeHtml(data.contactEmail)}">Contact</a>`
          : ''}
      </div>`;
```

- [ ] **Step 6: Style the socials row**

In `src/styles/station-info.css`, append:
```css
.station-info__socials {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 18px;
}
.station-info__social {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: var(--bg-dark);
  color: var(--text-muted);
  border: 1px solid var(--border);
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}
.station-info__social:hover {
  color: var(--text);
  background: var(--bg-list-hover);
  border-color: var(--red);
}
.station-info__social svg { display: block; }
```

- [ ] **Step 7: Build + behavioural verification**

Run: `npm run build` → expect success.
Then verify with the local server (from Part A) + a dev PWA pointed at it:
```bash
VITE_STATIONS_BASE=http://127.0.0.1:3000 npx vite --port 5199 --strictPort
```
In the Preview MCP (desktop viewport): play NTS (or any community station whose uuid has socials/city seeded), open the info panel (player card info button), then via `read_page`/`javascript_tool` confirm:
- `.station-info__socials a` count > 0 and each `href` points at the social URL,
- a "City" row appears in `.station-info__stream`,
- a `mailto:` "Contact" link appears when a contact email exists,
- `read_console_messages` shows no errors.
Open a `custom-*` stream's info → no socials, no error (endpoint 404 → RB fallback → null; render omits socials).

- [ ] **Step 8: Regression + commit**

Run: `node --test test/*.test.js` → expect all green.
```bash
git add src/ui/station-info.js src/styles/station-info.css src/data/stations-source.js
git commit -m "feat(info): show socials, city and contact in the station info panel"
```

---

## PART C — Local end-to-end + deploy (only on user approval)

- [ ] **Step 1: Full local roundtrip**

With the local Stations server (Part A branch) running and the PWA dev server pointed at it (`VITE_STATIONS_BASE=http://127.0.0.1:3000`): seed a community station's socials/city/country via the dashboard, then open that station's info panel in the PWA and confirm socials + city + country + contact all render. Confirm a station WITHOUT curated socials still renders cleanly (RB fallback, no socials row).

- [ ] **Step 2: Regression suites (both repos)**

```bash
cd /c/GitHub/RadioDock-Stations && npm test          # green
cd /c/GitHub/radiodock.app && node --test test/*.test.js   # green
```

- [ ] **Step 3: Deploy — SERVER FIRST**

Only after user approval. Merge `feat/station-info-endpoint` → `main` (reconcile with `origin/main` via rebase if diverged — never force-push over others' commits), push → VPS deploy (Docker rebuilds the dashboard too). Verify live: `curl -s https://stations.radiodock.app/api/stations/<uuid>` returns the shape; `/json/stations/byuuid/<uuid>` still an array; dashboard `/admin` shows the Country field.

- [ ] **Step 4: Deploy — PWA SECOND**

Merge `feat/station-info-socials` → `main` (reconcile if diverged), push → Pages deploy. Verify live: open a community station's info on `radiodock.app`, confirm socials/city/contact render.

- [ ] **Step 5: Brief the user** — what changed, restart-vs-reinstall (renderer-only → restart), and that socials show only for stations curated in the dashboard.

---

## Self-Review (coverage against the spec)

- New public `GET /api/stations/:uuid` (tags/city/country/socials/contact/codec/bitrate) → Task S1. ✔
- RB `/json/stations/*` untouched → asserted in S1 Step 1 test 3. ✔
- Country editable in dashboard → Task S2 (GET returns country + input saves via override PUT). ✔
- PWA client `getStationInfo` + null on 404 → Task P1. ✔
- Info panel: socials row, city, contact mailto; endpoint primary + RB fallback; custom-* skips → Task P3. ✔
- Socials icons reused from dashboard → Task P2. ✔
- Deploy order server→PWA, no force-push, local-first → Part C. ✔
- Error handling (404 → null → RB fallback; empty socials/city/contact omitted) → P1 + P3. ✔

Type consistency: `getStationInfo` returns `{…, tags:[], socials:[{platform,url}], city, contactEmail, codec, bitrate, countrycode}` in S1 (server), P1 (client), and consumed identically in P3 (render reads `data.socials`/`data.city`/`data.contactEmail`/`data.tags`/`data.codec`). RB fallback shape also carries `tags`/`codec`/`bitrate`/`countrycode`; only the curated extras are endpoint-only. ✔
