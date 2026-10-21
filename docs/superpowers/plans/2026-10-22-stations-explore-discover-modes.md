# Explore Feed and Discover View Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default Explore feed across all curated collections and three Discover display modes: Small, Large, and Cloud.

**Architecture:** Explore is a pure tiered feed builder wired into the existing Stations panel, with progressive reveal and UUID resolution before playback. Discover keeps one toolbar and replaces only its results container for Small, Large, and search. Cloud is a DOM and CSS transform checkpoint plus camera, ring, and search controller in one module.

**Tech Stack:** Vite 5, vanilla ES modules, Node test runner, CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-10-22-stations-explore-discover-modes-design.md`

## Global Constraints

- Work only in `C:/GitHub/rd-wt/stations-explore-discover` on branch `feat/stations-explore-discover`.
- Do not modify `C:/GitHub/radiodock.app` or its uncommitted stations-tip work.
- No backend, API, dependency, or `discover.json` changes.
- No changes to collection curation, ranking, or the published `discover.json`.
- No new framework, state library, or persistence. No localStorage writes. The Discover view mode is not persisted across sessions.
- No new audio player. Use the existing player and `<audio>` element.
- Do not redesign the Stations search, filters, A-Z rail, or Community tab.
- Reuse existing class names and tokens. Use `--bg`, `--bg-dark`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--red`, `--radius-sm`, `--radius-pill`.
- Red is only for playing, error, favorite, and the primary Discover CTA.
- No em dashes in UI copy, comments, commit messages, docs, or chat. Use hyphens.
- Default to no code comments. Add a comment only for a non-obvious WHY.
- `discover.json` stations have only `stationuuid`, `name`, and `countrycode`. Resolve through `data.getStationByUuid` before play, info, or add when `station.url` is absent.
- Discover search is local. It never calls the stations API.
- No deploy, no push. Show all changes locally first.
- Tests run with `npm test` (`node --test test/*.test.js`).
- Verify at panel widths 680px and 375px.

## Review Focus

- A station that is Tier 3 in one collection and Tier 1 in another must appear once, in Tier 1, with the Tier 1 source. Tested in Task 1.
- Two rapid Explore row clicks must not let the first async resolution play after the second. Tested in Task 3.
- Cloud bubbles must not overlap even with 35 collections, and bounds must include 240 world units of padding. Tested in Task 5.
- Cloud teardown during a camera animation, repeated view switches, and a second destroy must leave no listeners or animation frame. Tested in Task 6.
- Discover search must keep focus while only results re-render, and Cloud search must not rebuild the stage. Tested in Task 6.
- A collection with fewer than 5 stations must contribute only Tier 1. Tested in Task 1.

## Before You Start

- [ ] **Step 1: Enter the feature worktree and install dependencies**

```bash
cd C:/GitHub/rd-wt/stations-explore-discover
npm install
```

- [ ] **Step 2: Verify the baseline**

Run: `npm test`
Expected: the existing suite passes. If it fails, stop and report the failure before changing product code.

- [ ] **Step 3: Confirm the data file is present**

Run: `node -e "const d=require('./public/discover.json'); console.log(d.curated.lists.length, d.curated.lists.reduce((n,l)=>n+l.stations.length,0))"`
Expected: 35 lists and 791 station rows, or the current published counts. Do not hard-code either number in product code.

---

### Task 1: Explore feed model

**Files:**
- Create: `src/ui/stations-explore.js`
- Create: `test/stations-explore.test.js`

**Interfaces:**
- Consumes: `lists` from `normaliseDiscover(data).lists`.
- Produces:
  - `EXPLORE_PAGE_SIZE = 60`
  - `buildExploreFeed(lists, random = Math.random) -> ExploreStation[]`
  - `nextExploreLimit(limit, total, pageSize = EXPLORE_PAGE_SIZE) -> number`
  - `pickExploreStation(feed, random = Math.random) -> ExploreStation | null`
  - `ExploreStation = { id, stationuuid, name, countrycode, collectionSlug, collectionTitle, tier, position }`

- [ ] **Step 1: Write the failing model tests**

Add `test/stations-explore.test.js` with helpers and these assertions:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORE_PAGE_SIZE,
  buildExploreFeed,
  nextExploreLimit,
  pickExploreStation,
} from '../src/ui/stations-explore.js';

function station(uuid, name = uuid) {
  return { stationuuid: uuid, name, countrycode: 'DE' };
}

function list(slug, stations) {
  return { slug, title: slug, source: 'radiodock', featured: false, stations };
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
```

Add tests named exactly:

- `tier boundaries at positions 4, 5, 9, and 10`
  - Build one list with 12 stations. Use `random = () => 0.5`.
  - Assert tiers are `[1,1,1,1,1,2,2,2,2,2,3,3]`.
  - Assert positions are `[0,1,2,3,4,5,6,7,8,9,10,11]` after sorting by position.
- `deduplicates by uuid and keeps the best tier`
  - First list has `dup` at position 10. Second list has `dup` at position 2.
  - Assert one `dup`, `tier === 1`, `collectionSlug === 'second'`, `position === 2`.
- `keeps the first occurrence when duplicate tiers tie`
  - Both lists have `dup` at position 0.
  - Assert `collectionSlug === 'first'`.
- `shuffles each tier deterministically with the injected random`
  - Build 30 stations in one list. Build twice with `seeded(7)`. Assert equal UUID order.
  - Build with `seeded(8)`. Assert a different order.
- `orders tier one before tier two before tier three`
  - Assert the tier sequence never has a smaller tier after a larger tier.
- `does not mutate input lists or stations`
  - Snapshot `JSON.stringify(lists)` before and after. Assert equality.
- `handles empty and short lists`
  - Empty list returns `[]`.
  - 3 stations produce only Tier 1.
  - 7 stations produce Tier 1 and Tier 2 only.
- `returns the documented station shape`
  - Assert `Object.keys(feed[0]).sort()` equals `['collectionSlug','collectionTitle','countrycode','id','name','position','stationuuid','tier']`.
  - Assert `feed[0].id === feed[0].stationuuid`.
- `nextExploreLimit advances by 60 and clamps`
  - Assert `nextExploreLimit(0, 150) === 60`, `nextExploreLimit(60, 150) === 120`, `nextExploreLimit(120, 150) === 150`, `nextExploreLimit(150, 150) === 150`.
- `pickExploreStation is uniform over the feed boundaries`
  - `pickExploreStation([], () => 0) === null`.
  - `pickExploreStation(feed, () => 0) === feed[0]`.
  - `pickExploreStation(feed, () => 0.999999) === feed[feed.length - 1]`.
  - `pickExploreStation(feed, () => 1) === feed[feed.length - 1]`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/stations-explore.test.js`
Expected: FAIL because `../src/ui/stations-explore.js` does not exist.

- [ ] **Step 3: Implement the feed model**

In `src/ui/stations-explore.js`:

- Export `EXPLORE_PAGE_SIZE = 60`.
- `buildExploreFeed(lists, random = Math.random)`:
  - Skip missing or empty lists. Do not mutate inputs.
  - Walk lists in list order and stations in station order.
  - Skip stations without a non-empty `stationuuid`.
  - Tier is `position <= 4 ? 1 : position <= 9 ? 2 : 3`.
  - Keep the first occurrence of each UUID. Replace it only when the new occurrence has a lower tier.
  - Return every unique station once, with the winning source and position.
- Shuffle each tier independently with Fisher-Yates using `random`. Concatenate Tier 1, Tier 2, Tier 3.
- `nextExploreLimit(limit, total, pageSize = EXPLORE_PAGE_SIZE)` returns `Math.min(total, limit + pageSize)`.
- `pickExploreStation(feed, random = Math.random)` returns `null` for an empty feed, otherwise `feed[Math.min(feed.length - 1, Math.floor(random() * feed.length))]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/stations-explore.test.js`
Expected: PASS for all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/ui/stations-explore.js test/stations-explore.test.js
git commit -m "feat(explore): add tiered collection feed"
```

---

### Task 2: Explore source chip

**Files:**
- Modify: `src/ui/stations-row.js:32-82`
- Modify: `src/styles/stations.css` near the existing `.stations-row` metadata rules
- Create: `test/stations-row.test.js`

**Interfaces:**
- Consumes: a station with `id`, `name`, `countrycode`.
- Produces: `stationsRow(station, { source = '' })` renders a non-interactive `.stations-row-source` span inside the metadata line when `source` is non-empty.

- [ ] **Step 1: Write the failing row tests**

Add `test/stations-row.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { stationsRow } from '../src/ui/stations-row.js';

const station = { id: 'u1', stationuuid: 'u1', name: 'Radio One', countrycode: 'DE' };
```

Assertions:

- `renders a source chip inside the metadata line`
  - `const html = stationsRow(station, { source: 'Deep Jazz' });`
  - `assert.match(html, /class="stations-row-source"[^>]*title="Deep Jazz"/);`
  - `assert.match(html, /class="stations-row-source"[^>]*>Deep Jazz<\/span>/);`
  - `assert.match(html, /stations-row-meta[\s\S]*stations-row-source/);`
  - `assert.doesNotMatch(html, /<(button|a)[^>]*stations-row-source/);`
- `omits the source chip when source is empty`
  - `assert.doesNotMatch(stationsRow(station), /stations-row-source/);`
- `escapes the source title`
  - `assert.match(stationsRow(station, { source: '<b>Jazz</b>' }), /&lt;b&gt;Jazz&lt;\/b&gt;/);`

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/stations-row.test.js`
Expected: FAIL because `source` is not rendered.

- [ ] **Step 3: Implement the chip**

- Add `source = ''` to the `stationsRow` options.
- Extend `metaLine(station, mode, query, algorithm, source)` to append:
  - `<span class="stations-row-source" title="${escapeHtml(source)}">${escapeHtml(source)}</span>` when `source` is non-empty.
- Pass `source` from `stationsRow` into `metaLine`.
- Add CSS next to the existing row chips:

```css
.stations-row-source {
  display: inline-block;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--text-muted);
  font-size: 9px;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/stations-row.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/stations-row.js src/styles/stations.css test/stations-row.test.js
git commit -m "feat(stations): show collection source on explore rows"
```

---

### Task 3: Explore panel integration

**Files:**
- Modify: `src/ui/stations-panel.js`
- Test: manual browser checks and the existing `npm test` suite

**Interfaces:**
- Consumes: `EXPLORE_PAGE_SIZE`, `buildExploreFeed`, `nextExploreLimit`, `pickExploreStation`, `stationsRow` with `source`.
- Produces:
  - `state.exploreFeed`, `state.exploreLimit`, `state.exploreCollections`, `state.exploreError`
  - `ensureDiscover({ force = false } = {}) -> Promise<object | null>`
  - `loadExplore({ reset = false, rebuild = false } = {}) -> Promise<void>`
  - `runStationAction(anchor, station, actionName, { flash = false } = {}) -> Promise<void>`
  - Explore mode value `'explore'`

- [ ] **Step 1: Add imports, state, and the Explore tab**

- Import `EXPLORE_PAGE_SIZE`, `buildExploreFeed`, `nextExploreLimit`, `pickExploreStation` from `./stations-explore.js`.
- Add to `state`:
  - `exploreFeed: []`
  - `exploreLimit: EXPLORE_PAGE_SIZE`
  - `exploreCollections: 0`
  - `exploreError: null`
  - `stationActionToken: 0`
- Add a local `discoverPromise = null`.
- In `shell()`, add the first mode button before Popular:
  - `<button type="button" class="stations-mode-btn" data-mode="explore" aria-pressed="false">Explore</button>`
- Add `ensureDiscover`:

```js
function ensureDiscover({ force = false } = {}) {
  if (state.discover && !force) return Promise.resolve(state.discover);
  if (discoverPromise) return discoverPromise;
  discoverPromise = (async () => {
    try {
      const payload = await data.loadDiscover?.({}) ?? null;
      if (payload) state.discover = payload;
      return payload;
    } catch {
      return null;
    }
  })().finally(() => { discoverPromise = null; });
  return discoverPromise;
}
```

- Replace the direct `data.loadDiscover` calls in `renderFeaturedSection` and `openDiscover` with `ensureDiscover`.

- [ ] **Step 2: Implement `loadExplore`**

- On reset, clear `exploreFeed`, `exploreLimit`, `exploreCollections`, `rows`, `total`, `nextOffset`, `error`, and `exploreError`.
- Increment `loadToken`, abort the previous controller, set `state.loading = true`, and call `renderContent()`.
- Await `ensureDiscover()`. Return if the token, view, or mode changed.
- If no payload, set `state.exploreError = 'unavailable'`, `state.loading = false`, and render.
- Normalize lists with `normaliseDiscover(payload).lists`.
- Rebuild the feed when `rebuild` is true or `state.exploreFeed` is empty:
  - `state.exploreFeed = buildExploreFeed(lists)`
  - `state.exploreLimit = EXPLORE_PAGE_SIZE`
  - `state.exploreCollections = lists.length`
- Set `state.rows = state.exploreFeed.slice(0, state.exploreLimit)`, `state.total = state.exploreFeed.length`, `state.loading = false`, and `state.error = null`.
- Preserve `state.restoreScroll` when `reset` is false.
- Render header, rail, and content.
- Wrap the load in `try/catch`. Ignore abort errors and results when the token, view, or mode changed. On an unexpected failure, set `state.loading = false`, `state.exploreError = 'unavailable'`, and render. Do not leave the panel in a loading state.

- [ ] **Step 3: Render Explore header, rows, and states**

- `renderHeader()`:
  - Set `aria-pressed` for the Explore button like the other mode buttons.
  - Hide `#stationsFilters` when `state.mode === 'explore'`; show it otherwise.
- `sectionHead()`:
  - Explore returns a `.stations-section-head` with `<strong>Explore</strong>` and `${state.total} stations from ${state.exploreCollections} collections`.
- `loadingHead()`:
  - Explore returns `<strong>Explore</strong>` and `Building a mix from all collections`.
- `renderContent()`:
  - Add an Explore branch before the generic loading/error/empty branches.
  - If `state.exploreError === 'unavailable'`, render:
    - `<strong>Explore is unavailable right now.</strong>`
    - `The collection data could not be loaded.`
    - Actions `Retry` (`data-action="retry-explore"`) and `Browse Popular` (`data-action="browse-popular"`).
  - If the feed is empty after a successful load, render `No stations in the collections yet.` with `Browse Popular`.
  - Otherwise map rows with:
    ```js
    stationsRow(station, {
      mode: 'explore',
      source: station.collectionTitle,
      canAdd: actions.canFavorite?.(),
      alreadyAdded: actions.isFavorited?.(station.id),
      priority: index < 10,
    })
    ```
  - Use the `.stations-endless` sentinel when `state.exploreLimit < state.exploreFeed.length`. Do not render the load-more button for Explore.
- `emptyState()`: add an Explore fallback with `No stations in the collections yet.` and `Browse Popular`.

- [ ] **Step 4: Add progressive reveal**

- Extend `onContentScroll()`:
  - Keep the Popular branch unchanged.
  - When `state.mode === 'explore'`, not loading, `state.exploreLimit < state.exploreFeed.length`, and the scroll surface is within 240px of the end:
    - `state.restoreScroll = scrollSurface(content).scrollTop`
    - `state.exploreLimit = nextExploreLimit(state.exploreLimit, state.exploreFeed.length)`
    - `state.rows = state.exploreFeed.slice(0, state.exploreLimit)`
    - `renderContent()`
- The existing `renderContent` scroll restoration must keep the viewport stable.

- [ ] **Step 5: Wire mode changes, search return, and shuffle**

- In `setMode(mode)`:
  - Keep the early return for the same mode with no query.
  - Set `previousMode = mode`.
  - For `mode === 'explore'`: abort the current request, increment `loadToken`, set `loading = false`, close any open filter sheet, clear `exploreError`, clear the query, letter, offset, algorithm metadata, and input; do not clear country or genre. If a feed exists, set `rows` from the current limit, set `total = exploreFeed.length`, `nextOffset = null`, `letterCounts = null`, and `algorithm = null`, then call `renderHeader()`, `renderRail()`, and `renderContent()`. Otherwise call `loadExplore({ reset: true, rebuild: true })`.
  - For other modes, keep the existing `load({ reset: true })`.
- In `scheduleSearch()`:
  - When the query clears and the restored mode is `explore`, abort the current request, increment `loadToken`, restore `rows` from `exploreFeed` and `exploreLimit`, set `total = exploreFeed.length`, `nextOffset = null`, `letterCounts = null`, `algorithm = null`, `loading = false`, and call `renderHeader()`, `renderRail()`, and `renderContent()` without an API call. If `exploreFeed` is empty, call `loadExplore({ reset: true, rebuild: true })` instead.
  - When the query is long enough and the current mode is Explore, set `previousMode` to `explore` before entering search.
- In `clearSearch()`:
  - If the restored mode is `explore`, abort the current request, increment `loadToken`, restore the feed slice, set `total = exploreFeed.length`, `nextOffset = null`, `letterCounts = null`, and `algorithm = null`, then call `renderHeader()`, `renderRail()`, and `renderContent()` when the feed exists. If the feed is empty, call `loadExplore({ reset: true, rebuild: true })`. Otherwise load.
- In `shuffle()`:
  - In Explore, pick from the full feed with `pickExploreStation`.
  - If the feed is empty, fall back to `data.getRandomStation({ mode: 'popular' })`.
  - Resolve the picked station through `resolveStation`, then call `actions.onPlay`.
  - On failure, keep the existing toast.
- In `onContentClick()`:
  - Add `retry-explore` -> `loadExplore({ reset: true, rebuild: true })`.
  - Add `browse-popular` -> `setMode('popular')`.
  - For a clicked Explore row, call `runStationAction(row, station, actionName ?? 'play', { flash: (actionName ?? 'play') === 'play' })`.
- Add `runStationAction`:

```js
async function runStationAction(anchor, station, actionName, { flash = false } = {}) {
  const id = station.id ?? station.stationuuid;
  const token = ++state.stationActionToken;
  if (flash) flashElement(anchor);
  const full = await resolveStation(station.stationuuid ?? id);
  if (state.stationActionToken !== token) return;
  if (!full) {
    anchor.classList.remove('is-flashing');
    return;
  }
  if (actionName === 'play') {
    if (state.nowPlayingId === full.id) actions.togglePlay?.(full);
    else actions.onPlay?.(full);
  } else if (actionName === 'info') {
    toggleInlineInfo(anchor, full);
  } else if (actionName === 'add') {
    handleAdd(anchor.closest('[data-action="add"]') ?? anchor, full);
  }
}
```

- For normal Stations rows that already have a `url`, keep the existing direct path.

- [ ] **Step 6: Make Explore the default on entry**

- In `open({ query = '' })`, compute `entering = !isOpen || state.view !== 'stations'`.
- When entering:
  - Set `view = 'stations'`, `collection = null`, `mode = 'explore'`, `query = ''`, `letter = 'all'`, `offset = 0`, `error = null`, `tooShort = false`, `exploreFeed = []`, `exploreLimit = EXPLORE_PAGE_SIZE`, `rows = []`, `nextOffset = null`.
  - Open the panel and call `shell()` as today.
- After the shell:
  - If a trimmed query exists, enter search with `previousMode = 'explore'` and load search.
  - Else if entering, call `loadExplore({ reset: true, rebuild: true })`.
  - Else keep the existing behavior when rows are already present.
- On `close()`, increment `stationActionToken` so pending resolutions are ignored. Cloud teardown is added in Task 6.
- Ensure closing and reopening rebuilds the feed. Switching to Popular and back reuses the current feed and limit.

- [ ] **Step 7: Run the existing tests**

Run: `npm test`
Expected: PASS for all existing tests plus the new Task 1 and Task 2 tests.

- [ ] **Step 8: Verify Explore in the browser**

Run: `npm run dev`.
Check at 680px and 375px:

- Explore is the first tab and is active on open.
- 60 rows appear, then 120 after scrolling. The first Tier 2 row never appears before the last Tier 1 row.
- Source chips show collection titles and truncate long titles.
- Play, info, and add work and use the full station object.
- Clicking play on one row and immediately another row plays only the second result.
- Shuffle starts playback.
- Searching from Explore and clearing returns to Explore with the same feed depth.
- Country and genre filters are hidden in Explore and return unchanged in Popular.
- The unavailable state appears if `discover.json` is blocked in DevTools and Retry rebuilds.

- [ ] **Step 9: Commit**

```bash
git add src/ui/stations-panel.js
git commit -m "feat(stations): open on explore and reveal tiered stations"
```

---

### Task 4: Discover toolbar, Small search, and Large view

**Files:**
- Modify: `src/ui/discover-child.js`
- Modify: `src/ui/stations-panel.js`
- Modify: `src/styles/stations.css`
- Modify: `test/discover-child.test.js`

**Interfaces:**
- Consumes: `lists`, `isSaved`, `isFavorited`, `canAdd`, `stationsRow` with `source`, `runStationAction` from Task 3.
- Produces:
  - `renderDiscoverToolbar({ view = 'small', query = '' } = {}) -> string`
  - `renderDiscover({ lists = [], isSaved = () => false, view = 'small', query = '', expandedSlug = null, isFavorited = () => false, canAdd = true } = {}) -> string`
  - `renderDiscoverResults({ ...same options } = {}) -> string`
  - `searchDiscover(lists, query) -> { collections, stations, stationTotal }`
  - `matchesCollection(list, query) -> boolean`
  - `renderLargeCollectionCard(list, { saved = false, saving = false, expanded = false } = {}) -> string`
  - Panel state: `discoverView`, `discoverQuery`, `expandedCollection`
  - Panel functions: `setDiscoverView`, `applyDiscoverQuery`, `onDiscoverInput`, `renderDiscoverResultsOnly`, `toggleCollection`

- [ ] **Step 1: Write the failing toolbar and search tests**

Update the `test/discover-child.test.js` import list to include `renderDiscoverToolbar`. Extend the file with these fixtures:

```js
const searchLists = [
  { slug: 'jazz', title: 'Jazz', source: 'radiodock', featured: true, stations: [
    { stationuuid: 'j1', name: 'Jazz FM', countrycode: 'GB' },
  ] },
  { slug: 'news', title: 'News', source: 'radiodock', featured: true, stations: [
    { stationuuid: 'n1', name: 'World News', countrycode: 'US' },
  ] },
  { slug: 'community-jazz', title: 'Community Jazz', source: 'user', featured: false, stations: [
    { stationuuid: 'c1', name: 'Local Jazz', countrycode: 'DE' },
  ] },
];
```

Assertions:

- `renders the discover toolbar with search and three views`
  - `const html = renderDiscoverToolbar({ view: 'large', query: 'jazz' });`
  - Match `stations-discover-toolbar`, `type="search"`, `placeholder="Search collections or stations"`, `aria-label="Collection view"`.
  - Match `data-view="large"` with `aria-pressed="true"`.
  - Match `data-view="small"` and `data-view="cloud"` with `aria-pressed="false"`.
  - Count `data-view=` occurrences equals 3.
- `renderDiscover keeps the toolbar and results container`
  - `assert.match(renderDiscover({ lists: searchLists }), /stations-discover-toolbar[\s\S]*id="discoverResults"/);`
  - `assert.match(renderDiscover({ lists: searchLists }), /data-view="small"[^>]*aria-pressed="true"/);`
- `filters collections and stations by a case-insensitive substring`
  - `const html = renderDiscover({ lists: searchLists, query: 'JAZZ' });`
  - Match `data-collection="jazz"` and `data-collection="community-jazz"`.
  - Do not match `data-collection="news"`.
  - Match `stations-row-source` with `Jazz` and `Community Jazz`.
  - Match `data-id="j1"` and `data-id="c1"`.
- `shows station matches with their source collection`
  - `const html = renderDiscover({ lists: searchLists, query: 'world' });`
  - Match `data-id="n1"`, `World News`, and `stations-row-source[^>]*title="News"`.
  - Do not render a collection card for `news`.
- `shows a no-results state with a clear action`
  - `const html = renderDiscover({ lists: searchLists, query: 'zzzz' });`
  - Match `No collections or stations match "zzzz".` and `data-action="clear-discover-search"`.
- `clearing the query restores the normal sections`
  - Match `Community collections`, `stations-submit-link`, and both official cards.
- `community cards keep their kicker in search`
  - `assert.match(renderDiscover({ lists: searchLists, query: 'community' }), /stations-collection-card[^"]*is-user/);`
  - Match `Community collection`.
- `existing save states still render`
  - `assert.match(renderDiscover({ lists: searchLists, isSaved: () => true }), /is-saved/);`

- [ ] **Step 2: Write the failing Large tests**

Add to `test/discover-child.test.js`:

- `large mode renders one card per collection`
  - `const html = renderDiscover({ lists: searchLists, view: 'large' });`
  - Match `stations-collection-large`.
  - Match `stations-collection-card is-large`.
  - Match `data-action="toggle-collection"`, `data-slug="jazz"`, `aria-expanded="false"`, and `aria-label="Show all stations in Jazz"`.
- `large cards keep the save button visible`
  - Match `stations-collection-large-actions[\s\S]*stations-collection-save`.
- `large expanded card renders every station`
  - Build a list `{ slug: 'news', title: 'News', stations: Array.from({ length: 51 }, (_, i) => ({ stationuuid: 'n' + i, name: 'News ' + i, countrycode: 'US' })) }`.
  - `const html = renderDiscover({ lists: [news], view: 'large', expandedSlug: 'news' });`
  - Count `class="stations-collection-tile"` equals 51.
  - Match `stations-collection-large-stations`, `aria-expanded="true"`, and `aria-label="Hide stations in News"`.
- `only one large collection expands`
  - Render with two lists and `expandedSlug: 'jazz'`.
  - Count `aria-expanded="true"` equals 1.
  - Count `stations-collection-large-stations` equals 1.
- `community collections keep their section in large mode`
  - Match `Community collections` and a `.stations-collection-card.is-large.is-user` for `community-jazz`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test test/discover-child.test.js`
Expected: FAIL because the toolbar, search results, and Large layout do not exist.

- [ ] **Step 4: Implement the toolbar and search results**

- Add `renderDiscoverToolbar({ view, query })`:
  - `.stations-discover-toolbar`
  - `.stations-discover-search` label wrapper with a magnifier SVG, input `id="discoverSearchInput"` `type="search"` `autocomplete="off"` `spellcheck="false"` `placeholder="Search collections or stations"` `aria-label="Search collections or stations"` `value="${escapeHtml(query)}"`, and a clear button `data-action="clear-discover-search"` `aria-label="Clear search"` hidden when `query` is empty.
  - `.stations-view-toggle` with `role="group"` and `aria-label="Collection view"`.
  - Three buttons `data-view="small|large|cloud"`, `aria-pressed`, `title`, and labels `Small`, `Large`, `Cloud`. Use simple inline SVGs for grid, rows, and orbit. Desktop shows `.stations-view-label`; CSS hides it on mobile.
- `renderDiscover({...})` returns:
  ```html
  <div class="stations-discover">
    ${renderDiscoverToolbar({ view, query })}
    <div id="discoverResults" class="stations-discover-results">
      ${renderDiscoverResults({ ... })}
    </div>
  </div>
  ```
- `renderDiscoverResults`:
  - If `view === 'cloud'`, return `<div class="stations-cloud" data-cloud-host></div>`.
  - If `query` is non-empty, render search results.
  - Otherwise render the current official and community sections inside this function.
- `matchesCollection(list, query)` normalizes the query with `trim().toLowerCase()` and checks lowercased `list.title` and `list.slug` with `includes`.
- `searchDiscover(lists, query)`:
  - Normalize the query. Empty query returns `{ collections: [], stations: [], stationTotal: 0 }`.
  - `collections` are lists where `matchesCollection` is true, in list order.
  - `stations` are unique station matches by `stationuuid`, in list order then station order. Each result is `{ stationuuid, name, countrycode, collectionSlug, collectionTitle }`.
  - `stationTotal` is the total before the 12 result limit.
- Search results render:
  - `Collections` section with all matching official and community cards. Community cards keep the `Community collection` kicker and save button.
  - `Stations` section with `stationsRow` for the first 12 matches:
    ```js
    stationsRow({ ...match, id: match.stationuuid }, {
      mode: 'az',
      source: match.collectionTitle,
      canAdd,
      alreadyAdded: isFavorited(match.stationuuid),
    })
    ```
  - When `stationTotal > 12`, add `<p class="stations-discover-more">+ ${stationTotal - 12} more stations</p>`.
  - Hide the submit link while the query is active.
  - No matches render `.stations-empty` with `No collections or stations match "<query>".` and a clear button.
- Import `stationsRow` from `./stations-row.js`. Do not create a circular import.

- [ ] **Step 5: Implement the Large card**

- Extend `logoStack(stations, { limit = 5, large = false } = {})` and pass `limit` and a `large` flag to the class list. Keep existing calls working.
- `renderLargeCollectionCard(list, { saved, saving, expanded })` returns:
  - `.stations-collection-card-wrap` with `data-large-slug="${slug}"`.
  - `.stations-collection-card.is-large` (plus `.is-user` when `source === 'user'`) containing `.stations-collection-large-head`.
  - `.stations-collection-large-main` button with `data-collection="${slug}"` containing the large logo stack and `.stations-collection-large-copy` (optional community kicker, title, count).
  - `.stations-collection-large-actions` containing `collectionSaveButton(...)` and a `.stations-collection-more` button `data-action="toggle-collection"` `data-slug` `aria-expanded` with `...` text. Use the exact labels from the spec.
  - When `expanded`, append `.stations-collection-large-stations` inside the card, below the head, containing `.stations-collection-grid.is-tiles` with `collectionTile(station)` for every station in `list.stations`.
- `renderDiscoverResults` for `view === 'large'`:
  - Render official collections in `.stations-collection-large`.
  - Render `.stations-user-collections` with the `Community collections` heading and a second `.stations-collection-large` for user lists. Keep the count and submit link when the query is empty.
  - For search, use Large cards for matching collections. Community cards keep their kicker.

- [ ] **Step 6: Wire the toolbar, search, and view switching in the panel**

- Import `renderDiscoverResults` from `./discover-child.js`.
- Add `discoverView: 'small'`, `discoverQuery: ''`, and `expandedCollection: null` to state.
- `renderDiscoverView()`:
  - Set `view = 'discover'`, `collection = null`.
  - Pass `view: state.discoverView`, `query: state.discoverQuery`, `expandedSlug: state.expandedCollection`, `isFavorited: actions.isFavorited`, and `canAdd: actions.canFavorite?.()` into `renderDiscover`.
  - Call `applyNowPlaying()` and `refreshAddedFlags()`.
- Add `renderDiscoverResultsOnly()`:
  - Set `#discoverResults.innerHTML` to `renderDiscoverResults({...})`. Keep the `#discoverResults` element itself.
  - Call `applyNowPlaying()` and `refreshAddedFlags()`.
  - Do not replace the toolbar, so focus stays in the search input.
- Add `applyDiscoverQuery(query)`:
  - Return if `!isOpen` or `state.view !== 'discover'`.
  - Set `state.discoverQuery = query`, clear `state.expandedCollection`, and update the clear button visibility.
  - Call `renderDiscoverResultsOnly()`.
- Add `onDiscoverInput(evt)`:
  - Only for `#discoverSearchInput`.
  - Update the query and clear button immediately.
  - Debounce 120ms in a local `discoverTimer`, then `applyDiscoverQuery`.
- Add `setDiscoverView(view)`:
  - Return if unchanged.
  - Set `state.discoverView = view` and clear `state.expandedCollection`.
  - If `view === 'cloud'`, set `#discoverResults.innerHTML` to `<div class="stations-cloud" data-cloud-host></div>`. The Cloud module is mounted in Task 6.
  - Otherwise set `#discoverResults.innerHTML` to `renderDiscoverResults({...})`.
  - Update the toolbar `aria-pressed` values.
  - Call `applyNowPlaying()` and `refreshAddedFlags()`.
- `discoverShell()`:
  - Add an `input` listener on `#stationsContent` that delegates to `onDiscoverInput`.
  - Keep the existing click listener on `onDiscoverClick`.
- `onDiscoverClick()`:
  - Handle `data-view` first and call `setDiscoverView`.
  - Handle `clear-discover-search` by clearing the input, applying the empty query immediately, and focusing the search input.
  - Handle `.stations-row[data-id]` search results: build `{ id: row.dataset.id, stationuuid: row.dataset.id }`, resolve it, and run `actionName ?? 'play'` through `runStationAction` from Task 3, with `{ flash: (actionName ?? 'play') === 'play' }`.
  - Handle `data-action="toggle-collection"` by calling `toggleCollection(button)` before the collection handler.
  - Keep the existing save, collection, browse-all, submit, and `collection-*` handlers.
- `openDiscover()`:
  - Reset `discoverView = 'small'`, `discoverQuery = ''`, `expandedCollection = null`.
  - Clear `discoverTimer`.
  - Use `ensureDiscover`.
- `openCollection()`:
  - Preserve `discoverView` and `discoverQuery`.
  - Clear `discoverTimer` before rendering the collection shell.
- `toggleCollection(button)`:
  - Toggle `state.expandedCollection` between `button.dataset.slug` and `null`.
  - Call `renderDiscoverResultsOnly()`.
  - Scroll the matching `[data-large-slug]` card into view with `{ block: 'nearest' }`.
  - Focus the rebuilt toggle button for the same slug with `{ preventScroll: true }`.

- [ ] **Step 7: Add the CSS**

Add to `src/styles/stations.css`:

- `.stations-discover-toolbar`: sticky top 0, z-index 3, display flex, justify-content flex-end, align-items center, gap 10px, padding 6px 0 8px, background `var(--bg-dark)`, border-bottom `1px solid var(--border)`.
- `.stations-discover-search`: flex 0 1 220px, height 34px, display flex, align-items center, gap 6px, padding 0 10px, border `1px solid var(--border)`, radius `var(--radius-pill)`, background `var(--surface)`.
- `.stations-discover-search-input`: flex 1, min-width 0, border 0, background transparent, color `var(--text)`, font inherit, font-size 11px, outline none.
- `.stations-discover-search:focus-within`: border-color `var(--text-muted)`.
- `.stations-discover-clear`: 18px square, border 0, background transparent, color `var(--text-muted)`, cursor pointer, display inline-flex, center.
- `.stations-view-toggle`: display inline-flex, height 34px, padding 3px, gap 2px, border `1px solid var(--border)`, radius `var(--radius-pill)`, background `var(--bg-dark)`.
- `.stations-view-btn`: height 26px, padding 0 9px, border 0, radius `var(--radius-pill)`, background transparent, color `var(--text-muted)`, font-size 10px, display inline-flex, align-items center, gap 5px, cursor pointer.
- `.stations-view-btn[aria-pressed="true"]`: background `var(--surface)`, color `var(--text)`.
- `.stations-view-btn:focus-visible`: outline `2px solid var(--text)`, outline-offset 2px.
- `.stations-view-icon`: 13px square.
- `.stations-discover-more`: margin 4px 0 0, color `var(--text-muted)`, font-size 10px.
- `.stations-collection-large`: display flex, flex-direction column, gap 16px.
- `.stations-collection-card.is-large`: display flex, flex-direction column, padding 16px, border, radius `var(--radius-sm)`, background `var(--bg-dark)`, cursor default.
- `.stations-collection-large-head`: display flex, align-items stretch, gap 16px.
- `.stations-collection-large-main`: flex 1, display flex, align-items center, gap 16px, border 0, background transparent, color inherit, text-align left, cursor pointer.
- `.stations-logo-stack.is-large .logo-slot`: width 52px, height 52px, margin-left -14px. The first child has margin-left 0.
- `.stations-collection-large-copy strong`: font-size 18px. Count: font-size 10px.
- `.stations-collection-large-actions`: display flex, align-items center, gap 8px.
- `.stations-collection-card.is-large .stations-collection-save`, `.stations-collection-card.is-large .stations-collection-save.is-saved`, `.stations-collection-card.is-large .stations-collection-save.is-saving`: position static, opacity 1, pointer-events auto; keep the saved state styling.
- `.stations-collection-more`: 28px round button, border, background `var(--surface)`, color `var(--text-muted)`.
- `.stations-collection-large-stations`: margin-top 14px, border-top, padding-top 14px.
- On `@container stations-panel (max-width: 640px)`:
  - `.stations-discover-toolbar` wraps: search 100% on the first row, toggle aligned right on the second row.
  - `.stations-view-label` is visually hidden.
  - `.stations-collection-large-head` wraps; `.stations-collection-large-main` stacks the cover above the copy; actions stay visible.
- At 699px: the grid inside the expanded body is one column.
- Change `.stations-collection-grid` gap from `8px` to `14px`.
- Do not use red in the toolbar.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/discover-child.test.js`
Expected: PASS. The existing tests must still pass with the new wrapper. If an existing test asserts the old Discover markup order, update only that assertion to allow the toolbar before the results.

- [ ] **Step 9: Verify Small, Large, and search in the browser**

Run: `npm run dev`.
Check at 680px and 375px:

- The toolbar is right-aligned and subtle, and the search pill does not move focus out of the input while typing.
- Search filters collection cards and shows station matches with source collections.
- Clearing the query restores the normal sections.
- Small keeps the current card layout and the gap is 14px.
- Large is one card per row and the logos are visibly larger.
- The save button is visible without hover.
- `...` expands every station, including a collection with more than 50 stations.
- Opening a second collection collapses the first.
- Play, info, and heart work from expanded tiles.
- The layout stacks cleanly at 375px.

- [ ] **Step 10: Commit**

```bash
git add src/ui/discover-child.js src/ui/stations-panel.js src/styles/stations.css test/discover-child.test.js
git commit -m "feat(discover): add search and small and large views"
```

### Task 5: Cloud model and layout

**Files:**
- Create: `src/ui/discover-cloud.js`
- Create: `test/discover-cloud.test.js`

**Interfaces:**
- Consumes: `lists` from `normaliseDiscover(data).lists`.
- Produces:
  - `buildCloudModel(lists) -> { nodes, edges, bounds, nodeBySlug, stationByUuid }`
  - `ringLayout(count, options) -> [{ index, x, y, ring }]`
  - `matchCloud(model, query, options) -> { collections, stations, collectionTotal, stationTotal }`
  - `CloudNode = { slug, title, count, stations, preview, radius, x, y }`
  - `CloudEdge = { a, b }`
  - `CloudBounds = { minX, minY, maxX, maxY, width, height }`

- [ ] **Step 1: Write the failing Cloud model tests**

Add `test/discover-cloud.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudModel, ringLayout, matchCloud } from '../src/ui/discover-cloud.js';

function station(uuid, countrycode = 'US') {
  return { stationuuid: uuid, name: 'Station ' + uuid, countrycode };
}

function list(slug, count, countries = ['US']) {
  return {
    slug,
    title: slug,
    source: 'radiodock',
    stations: Array.from({ length: count }, (_, i) => station(slug + i, countries[i % countries.length])),
  };
}
```

Assertions:

- `builds one node per list`
  - `const model = buildCloudModel([list('jazz', 10), list('news', 8)]);`
  - `model.nodes.length === 2`.
  - `model.nodeBySlug.get('jazz').count === 10`.
- `preview uses five to eight stations or all when fewer`
  - A 10-station list has `preview.length === 8`.
  - A 4-station list has `preview.length === 4`.
  - A 0-station list is skipped.
- `uses the documented radius formula and clamps`
  - Count 10 gives `72 + Math.sqrt(10) * 7` within 0.001.
  - Count 1000 is clamped to 140.
  - Count 1 is clamped to 80.
- `is deterministic for the same input`
  - `JSON.stringify(model.nodes.map(({ slug, x, y, radius }) => ({ slug, x, y, radius })))` is equal across two calls.
- `does not overlap bubbles`
  - For every pair, `Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius + 20 - 0.001`.
  - Use 35 lists with counts from 5 to 60.
- `bounds include 240 world units of padding`
  - `bounds.minX <= Math.min(...nodes.map(n => n.x - n.radius)) - 240 + 0.001`.
  - Same for maxX, minY, maxY.
- `edges connect similar countries and are deduplicated`
  - Jazz and News share US and GB. Ambient and Punk share DE.
  - Assert one `{ a: 'jazz', b: 'news' }` style edge, no duplicate reversed edge.
  - Lists with no country codes have no edges.
- `ringLayout uses one, two, or three rings`
  - `ringLayout(5)` returns one ring with 5 points.
  - `ringLayout(19)` returns ring counts `[10, 9]`.
  - `ringLayout(55)` returns ring counts `[19, 18, 18]`.
  - All points are unique.
  - Points on each ring have equal angle spacing within 0.001.
- `matchCloud finds collection titles`
  - Query `jazz` returns the jazz collection.
  - Query `JAZZ` is case-insensitive.
- `matchCloud finds station names across collections`
  - A station named `Late Night Jazz` in collection `night` is returned with `collectionSlug: 'night'`.
  - Duplicate station UUIDs are returned once, from the first list.
- `matchCloud respects limits and totals`
  - With 10 matching collections, `collections.length === 6`, `collectionTotal === 10`.
  - With 20 matching stations, `stations.length === 12`, `stationTotal === 20`.
- `matchCloud returns nothing for an empty query`
  - All arrays empty and totals 0.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/discover-cloud.test.js`
Expected: FAIL because `src/ui/discover-cloud.js` does not exist.

- [ ] **Step 3: Implement the model and layout**

In `src/ui/discover-cloud.js`:

- `buildCloudModel(lists)`:
  - Skip lists without a slug, title, or stations.
  - Build nodes in list order. `stations` keeps the curated order. `count` is `stations.length`.
  - `preview` uses the first `Math.min(8, Math.max(5, count))` stations, or all when fewer than 5.
  - Preview positions use an orbit at 42% of the radius. Place each preview at angle `(index / preview.length) * Math.PI * 2 - Math.PI / 2`, with `x = Math.cos(angle) * radius * 0.42`, `y = Math.sin(angle) * radius * 0.42`.
  - Preview size is `radius * 0.32`, clamped to 16 to 34 world units.
  - Radius is `Math.min(140, Math.max(80, 72 + Math.sqrt(count) * 7))`.
  - Start positions with phyllotaxis:
    - `angle = index * Math.PI * (3 - Math.sqrt(5))`
    - `distance = 165 * Math.sqrt(index + 0.5)`
    - Add a slug-based jitter of at most 12 world units on each axis. Use a small deterministic string hash, not `Math.random`.
  - Relax collisions for 160 iterations. For each pair closer than `r1 + r2 + 20`, push both apart by half the overlap. Keep positions stable across runs.
  - Center the constellation on the origin.
  - `bounds` is the min and max of `x - radius` and `y - radius` plus 240 padding on every side, with `width` and `height`.
  - `nodeBySlug` is a `Map`. `stationByUuid` is a `Map` of UUID to `{ station, node }`.
- Edges:
  - Build a country set per node from its stations, ignoring empty country codes.
  - Jaccard similarity is `intersection / union`. Skip union 0.
  - Connect each node to its two highest-similarity nodes with similarity greater than 0.
  - Deduplicate unordered pairs. Store `a` and `b` sorted by slug.
- `ringLayout(count, { radius = 170, gap = 58, startAngle = -Math.PI / 2 } = {})`:
  - Choose `ringCount = count <= 18 ? 1 : count <= 36 ? 2 : 3`.
  - Distribute stations as evenly as possible across rings. Put the larger rings first, so 55 gives `[19, 18, 18]`.
  - Ring `r` uses radius `radius + r * gap`.
  - Each ring starts at `startAngle` plus half a step when the ring index is odd.
  - Return points in station order with `{ index, x, y, ring }`.
- `matchCloud(model, query, { collectionLimit = 6, stationLimit = 12 } = {})`:
  - Normalize the query with `trim().toLowerCase()`. Empty query returns empty arrays and 0 totals.
  - Collections match on title or slug. Stations match on name.
  - Station matches dedupe by UUID, first list order wins, and carry `{ stationuuid, name, countrycode, collectionSlug, collectionTitle }`.
  - Return the limited arrays and the totals before limits.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/discover-cloud.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/discover-cloud.js test/discover-cloud.test.js
git commit -m "feat(cloud): add deterministic collection cloud model"
```

---

### Task 6: Cloud UI and Discover integration

**Files:**
- Modify: `src/ui/discover-cloud.js`
- Modify: `src/ui/stations-panel.js`
- Modify: `src/styles/stations.css`

**Interfaces:**
- Consumes: `buildCloudModel`, `ringLayout`, `matchCloud`, `renderLogoSlot`, `stationsRow` search results, `resolveStation`, `actions.onPlay`, `actions.getNowPlayingId`.
- Produces:
  - `mountDiscoverCloud(host, { lists = [], nowPlayingId = null, onPlay = async () => false } = {})`
  - Returns `{ destroy, setNowPlaying, search, openCollection, reset, element }`
  - Panel state: `discoverView`, `discoverQuery`, `expandedCollection`, `cloud`

- [ ] **Step 1: Build the Cloud stage and overview**

In `src/ui/discover-cloud.js`, add `mountDiscoverCloud(host, options)`.

- Build:
  - `.stations-cloud-stage` inside `host`, with `role="region"` and `aria-label="Collection cloud. Drag to pan, scroll to zoom, click a collection."`.
  - `.stations-cloud-world` containing an SVG `.stations-cloud-links` and one `.stations-cloud-node` button per node.
  - Each node button has `aria-label="${title}, ${count} stations"`.
  - Each node has a `.stations-cloud-bubble` containing a `.stations-cloud-orbit` with up to 8 preview logos, and a `.stations-cloud-label` with title and `${count} stations`.
  - Position each preview logo wrapper `.logo-slot` from `node.preview` with inline `left: calc(50% + ${x}px)`, `top: calc(50% + ${y}px)`, `width` and `height` from the preview size, plus `translate: -50% -50%`.
  - The 12 highest-count nodes get `.is-label-visible` at overview scale.
  - Set `--float-delay` on each node to `-${(index % 8) * 0.9}s` so the float is staggered.
  - `.stations-cloud-hint` bottom-left with `Drag to pan. Scroll to zoom. Click a collection.` On mobile, `Pinch to zoom`.
  - Zoom controls with `data-cloud-zoom="in|out|reset"` and accessible labels.
  - A hidden `.stations-cloud-back` button `All collections`, shown only in a ring.
  - An empty `.stations-cloud-empty` with `No collections to show yet.` when lists are empty.
- Use `renderLogoSlot(station, { imgClass: 'stations-cloud-logo', initialsClass: 'stations-cloud-initials', size: 'sm', resolveById: true, priority: index < 8 })`.
- Hydrate logos locally:
  - For each `[data-logo-slot]`, attach `load` and `error` handlers and apply the loaded or fallback state.
  - If the image is already `complete`, apply the state immediately.
  - Do not call `mountLogoBehavior` in Cloud. Its MutationObserver never disconnects.
- Links:
  - SVG viewBox is `0 0 ${bounds.width} ${bounds.height}` and is positioned at `left: bounds.minX; top: bounds.minY`, width and height equal to the bounds.
  - Path coordinates are `node.x - bounds.minX` and `node.y - bounds.minY`.
  - Use a slight quadratic curve. `vector-effect: non-scaling-stroke`.
  - Set `data-a` and `data-b` on each path.
- Bubble hover and focus:
  - Mark the bubble `.is-active`, its links `.is-active`, and other bubbles and links `.is-dimmed`.
  - Clear the state on leave or blur. Do not dim while a ring is open.

- [ ] **Step 2: Implement the camera**

- State `{ scale, tx, ty }` and a `fitCamera()`:
  - If there are no nodes, show `.stations-cloud-empty` and skip camera setup.
  - `fitScale = Math.min(stageWidth / bounds.width, stageHeight / bounds.height) * 0.84`.
  - Center the bounds in the stage.
- Apply with `world.style.transform = "translate3d(" + tx + "px," + ty + "px,0) scale(" + scale + ")"`.
- Keep labels readable at every zoom by counter-scaling:
  - Set each `.stations-cloud-label` inline transform to `scale(${Math.min(3, 1 / scale)})` with `transform-origin: top center`.
  - Set `.stations-cloud-ring-label` inline transform to `scale(${Math.min(3, 1 / ringScale)})` with `transform-origin: center`.
- Drag:
  - Pointer events with a pointer map.
  - Do not start a drag from `.stations-cloud-results`, `.stations-cloud-controls`, or `.stations-cloud-back`.
  - Threshold 5px. Set `dragMoved` and suppress the next bubble click.
  - Use `setPointerCapture`. Disable text selection with CSS.
- Wheel:
  - `preventDefault`, zoom toward the cursor.
- Pinch:
  - Two pointers, zoom toward the midpoint.
- Buttons:
  - `+` and `-` zoom around the stage center.
  - `reset` fits the overview and closes the ring and results.
- Clamp `scale` between `fitScale * 0.75` and `fitScale * 5`.
- Programmatic moves use `requestAnimationFrame` and an ease-out cubic for 420ms. With `prefers-reduced-motion: reduce`, set instantly.
- On zoom or pan, hide the tooltip and update `stage.classList.toggle('is-zoomed', scale >= fitScale * 1.15)`.

- [ ] **Step 3: Implement the collection ring**

- `openCollection(slug)`:
  - Find the node. If missing, return.
  - Store the current camera as `overviewCamera`.
  - Add `is-ring-open` to the stage. Dim other nodes and links. Hide the selected bubble.
  - Compute the ring layout with `ringLayout(node.count, { radius: 170, gap: 58 })`.
  - Compute `ringScale = Math.min(stageWidth, stageHeight) / 2 / (maxRingRadius + 40)`, clamped to the camera range.
  - Thumbnail world size is `(stageWidth < 520 ? 44 : 52) / ringScale`.
  - Render `.stations-cloud-ring` at the node center with one `.stations-cloud-station` button per station, each with `data-uuid`, `aria-label` containing the station name and country code, `left`, `top`, width and height. Use a logo slot.
  - Render `.stations-cloud-ring-label` at the center with title, count, and the current station name when it belongs to this collection.
  - Fly to the node at `ringScale` and center it.
  - While the ring is open, set `tabindex="-1"` and `aria-hidden="true"` on bubbles, links, and zoom controls so Shift+Tab from the first station reaches `All collections`.
  - Focus the first `.stations-cloud-station` after building.
- Station hover and focus:
  - Show `.stations-cloud-tooltip` with the station name and the uppercase country code.
  - Hide it on leave, blur, zoom, or pan.
- Station click:
  - Flash the thumbnail.
  - Call `onPlay(uuid)`.
  - If the promise resolves false, remove the flash.
- `setNowPlaying(uuid)`:
  - Toggle `.is-playing` on the matching ring thumbnail.
  - Update the center label with the station name.
- `closeRing({ restoreFocus = true } = {})`:
  - Remove the ring, remove `is-ring-open`, restore node and link opacity, restore tabindex and `aria-hidden` on bubbles and controls, fly to the overview camera, and optionally focus the bubble.
- Back controls:
  - `All collections` button.
  - Escape in a document keydown capture listener. Close results first, then the ring. Stop propagation only when handled.
  - Empty-stage click when `!dragMoved` and the target is not a bubble, thumbnail, control, or results row.
- Opening a collection from a station search match highlights that thumbnail for 1.6 seconds.

- [ ] **Step 4: Implement Cloud search**

- `search(query)`:
  - Empty query hides the results panel and returns.
  - `matchCloud(model, query, { collectionLimit: 6, stationLimit: 12 })`.
  - Render `.stations-cloud-results` inside the stage, below the toolbar. It has `role="region"` and `aria-label="Cloud search results"`.
  - Collection rows show title and count. Station rows show logo, name, and source collection. Label the two groups `Collections` and `Stations`.
  - Clicking a collection row opens its ring and hides the panel. Stop propagation so the panel click handler does not see it.
  - Clicking a station row opens its collection, highlights the thumbnail for 1.6 seconds, and calls `onPlay(uuid)`. Stop propagation.
  - Empty results show `.stations-cloud-results-empty` with `No collections or stations found.`
  - The panel must not rebuild the stage.
- Store the highlight timer and clear it on destroy.
- Escape closes the results panel first.

- [ ] **Step 5: Implement destroy and resize**

- `destroy()`:
  - Return immediately if already destroyed.
  - Cancel the camera animation frame.
  - Clear all timers.
  - Remove the document keydown listener.
  - Remove pointer, wheel, and click listeners attached to the stage.
  - Disconnect the `ResizeObserver`.
  - Clear `host.innerHTML`.
  - Remove Cloud classes from the host.
  - Mark destroyed. Calling twice is safe.
  - After destroy, `setNowPlaying`, `search`, `openCollection`, and `reset` return early.
- `ResizeObserver`:
  - If the overview is active, refit the camera.
  - If a ring is open, recompute the ring scale, thumbnail world sizes, and label counter-scale, then recenter the ring.
- `reset()` closes the ring and results and fits the overview.

- [ ] **Step 6: Extend the Task 4 panel wiring for Cloud**

- Import `mountDiscoverCloud` from `./discover-cloud.js`.
- Add `cloud: null` to state. Do not add a second input listener; Task 4 already added the delegated input handler.
- Add `applyDiscoverClasses()` to toggle `.is-cloud` on `.stations-content` and `.stations-discover`.
- Add `mountCloud(lists)`:
  ```js
  const host = body.querySelector('[data-cloud-host]');
  if (!host) return;
  state.cloud = mountDiscoverCloud(host, {
    lists,
    nowPlayingId: state.nowPlayingId ?? actions.getNowPlayingId?.(),
    onPlay: async (uuid) => {
      const full = await resolveStation(uuid);
      if (!full) return false;
      actions.onPlay?.(full);
      return true;
    },
  });
  if (state.discoverQuery) state.cloud.search(state.discoverQuery);
  ```
- Add `destroyCloud()`:
  - Call `state.cloud?.destroy()`.
  - Set `state.cloud = null`.
  - Remove `.is-cloud` from the content and Discover container.
- Extend `setDiscoverView(view)`:
  - Call `destroyCloud()` before changing the view.
  - When entering Cloud, set `#discoverResults.innerHTML` to the cloud host, apply classes, and `mountCloud(state.discover ? normaliseDiscover(state.discover).lists : [])`.
  - When leaving Cloud, destroy, render the new results into `#discoverResults`, and remove the Cloud classes.
  - Keep the Task 4 `aria-pressed` update.
- Extend `applyDiscoverQuery(query)`:
  - In Cloud, call `state.cloud?.search(query)` and do not rebuild the stage.
  - Otherwise keep the Task 4 results render.
- Extend `renderDiscoverView`:
  - Call `destroyCloud()` first.
  - After `discoverShell`, call `applyDiscoverClasses()`.
  - If the view is Cloud, call `mountCloud(normaliseDiscover(state.discover).lists)`.
  - Keep the Task 4 `applyNowPlaying()` and `refreshAddedFlags()` calls.
- Call `destroyCloud()` in `openDiscover`, `openCollection`, `backToStations`, `browseAll`, `close`, and `open` when entering from another view. Clear `discoverTimer` in those paths.
- In `applyNowPlaying`, after updating rows and tiles, call `state.cloud?.setNowPlaying(id)`.
- Keep the existing `onKeydown` Escape order. The Cloud module handles its own ring and results first via a document capture listener.

- [ ] **Step 7: Add the Cloud CSS**

Add these classes. Use the existing tokens. No backdrop filters.

- `.stations-content.is-cloud`: `overflow: hidden`.
- `.stations-discover.is-cloud`: `display: flex`, `flex-direction: column`, `height: 100%`, `min-height: 0`, `padding-bottom: 0`.
- `.stations-discover.is-cloud .stations-discover-results`: `flex: 1`, `min-height: 0`.
- `.stations-cloud`: `position: relative`, `height: 100%`, `min-height: 420px`, `background: var(--bg-dark)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-sm)`, `overflow: hidden`.
- `.stations-cloud-stage`: `position: absolute`, `inset: 0`, `overflow: hidden`, `touch-action: none`, `user-select: none`, `cursor: grab`, `background: radial-gradient(circle at 50% 45%, var(--surface) 0%, var(--bg-dark) 55%, var(--bg) 100%)`. Add a pseudo-element with a faint dot pattern using `radial-gradient` and low opacity.
- `.stations-cloud img`: `-webkit-user-drag: none`, `user-select: none`.
- `.stations-cloud-stage.is-dragging`: `cursor: grabbing`.
- `.stations-cloud-world`: `position: absolute`, `left: 0`, `top: 0`, `width: 0`, `height: 0`, `transform-origin: 0 0`, `overflow: visible`, `will-change: transform`.
- `.stations-cloud-links`: `position: absolute`, `overflow: visible`, `pointer-events: none`.
- `.stations-cloud-link`: `fill: none`, `stroke: var(--border)`, `stroke-width: 1`, `opacity: 0.35`, `vector-effect: non-scaling-stroke`.
- `.stations-cloud-link.is-active`: `stroke: var(--text-muted)`, `opacity: 0.7`.
- `.stations-cloud-link.is-dimmed`: `opacity: 0.06`.
- `.stations-cloud-node`: `position: absolute`, `border: 0`, `padding: 0`, `background: transparent`, `color: var(--text)`, `cursor: pointer`, `border-radius: 50%`, `transition: opacity 0.25s ease`.
- `.stations-cloud-bubble`: `position: absolute`, `inset: 0`, `border: 1px solid var(--border)`, `border-radius: 50%`, `background: radial-gradient(circle at 35% 30%, var(--surface-2), var(--bg-dark) 70%)`, `box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35), inset 0 0 30px rgba(255, 255, 255, 0.03)`, `transition: border-color 0.2s ease, box-shadow 0.2s ease, translate 0.2s ease`, `overflow: hidden`, `animation: stations-cloud-float 9s ease-in-out infinite alternate`, `animation-delay: var(--float-delay, 0s)`.
- `.stations-cloud-orbit`: `position: absolute`, `inset: 0`, `border-radius: 50%`, `pointer-events: none`.
- `.stations-cloud-node:hover .stations-cloud-bubble`, `.stations-cloud-node:focus-visible .stations-cloud-bubble`: `border-color: var(--text-muted)`, `box-shadow: 0 22px 50px rgba(0, 0, 0, 0.45), inset 0 0 36px rgba(255, 255, 255, 0.05)`, `translate: 0 -3px`, `animation-play-state: paused`.
- `.stations-cloud-bubble .logo-slot`: `position: absolute`, `translate: -50% -50%`.
- `.stations-cloud-logo`: `width: 100%`, `height: 100%`, `border-radius: 50%`, `object-fit: cover`, `border: 1px solid var(--border)`, `background: var(--logo-chip-bg)`.
- `.stations-cloud-station .logo-slot`: `width: 100%`, `height: 100%`, `border-radius: 50%`.
- `.stations-cloud-bubble .logo-fallback`, `.stations-cloud-station .logo-fallback`: `width: 100%`, `height: 100%`, `border-radius: 50%`.
- `.stations-cloud-label`: `position: absolute`, `top: calc(100% + 8px)`, `left: 50%`, `translate: -50% 0`, `transform-origin: top center`, `text-align: center`, `white-space: nowrap`, `opacity: 0`, `transition: opacity 0.2s ease`, `pointer-events: none`.
- `.stations-cloud-label strong`: `display: block`, `font-size: 11px`, `font-weight: 600`.
- `.stations-cloud-label span`: `display: block`, `font-size: 9px`, `color: var(--text-muted)`.
- `.stations-cloud-node.is-label-visible .stations-cloud-label`, `.stations-cloud-node:hover .stations-cloud-label`, `.stations-cloud-node:focus-visible .stations-cloud-label`, `.stations-cloud-stage.is-zoomed .stations-cloud-label`: `opacity: 1`.
- `.stations-cloud-node.is-dimmed`: `opacity: 0.16`, `pointer-events: none`.
- `.stations-cloud-node.is-open`: `opacity: 0`.
- `.stations-cloud-ring`: `position: absolute`, `width: 0`, `height: 0`, `pointer-events: none`.
- `.stations-cloud-station`: `position: absolute`, `translate: -50% -50%`, `border: 1px solid var(--border)`, `border-radius: 50%`, `background: var(--bg-dark)`, `overflow: hidden`, `pointer-events: auto`, `cursor: pointer`.
- `.stations-cloud-station.is-playing`: `box-shadow: 0 0 0 2px var(--red)`, `border-color: var(--red)`.
- `.stations-cloud-station.is-search-match`: `box-shadow: 0 0 0 2px var(--text)`, `outline: 2px solid var(--text)`, `outline-offset: 2px`, `animation: stations-cloud-match 0.8s ease-in-out infinite alternate`.
- `.stations-cloud-node:focus-visible`, `.stations-cloud-station:focus-visible`, `.stations-cloud-controls button:focus-visible`, `.stations-cloud-back:focus-visible`, `.stations-cloud-results button:focus-visible`: `outline: 2px solid var(--text)`, `outline-offset: 3px`.
- `.stations-cloud-ring-label`: `position: absolute`, `left: 50%`, `top: 50%`, `translate: -50% -50%`, `transform-origin: center`, `text-align: center`, `width: 160px`, `pointer-events: none`.
- `.stations-cloud-ring-label strong`: `font-size: 14px`, `display: block`.
- `.stations-cloud-ring-label span`: `font-size: 10px`, `color: var(--text-muted)`, `display: block`.
- `.stations-cloud-controls`: `position: absolute`, `right: 12px`, `bottom: 12px`, `display: flex`, `flex-direction: column`, `gap: 6px`, `z-index: 4`.
- `.stations-cloud-controls button`, `.stations-cloud-back`: `width: 34px`, `height: 34px`, `border: 1px solid var(--border)`, `border-radius: 50%`, `background: var(--surface)`, `color: var(--text)`, `display: inline-flex`, `align-items: center`, `justify-content: center`, `cursor: pointer`.
- `.stations-cloud-back`: `position: absolute`, `top: 12px`, `left: 12px`, `width: auto`, `height: 30px`, `padding: 0 12px`, `border-radius: var(--radius-pill)`, `z-index: 5`, `display: none`.
- `.stations-cloud-stage.is-ring-open .stations-cloud-back`: `display: inline-flex`.
- `.stations-cloud-hint`: `position: absolute`, `left: 12px`, `bottom: 12px`, `font-size: 9px`, `color: var(--text-muted)`, `pointer-events: none`.
- `.stations-cloud-results`: `position: absolute`, `top: 10px`, `left: 50%`, `translate: -50% 0`, `width: min(460px, calc(100% - 24px))`, `max-height: 50%`, `overflow: auto`, `touch-action: pan-y`, `z-index: 6`, `border: 1px solid var(--border)`, `border-radius: var(--radius-sm)`, `background: var(--bg)`, `box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45)`.
- `.stations-cloud-results button`: `display: flex`, `width: 100%`, `align-items: center`, `gap: 8px`, `padding: 8px 10px`, `border: 0`, `border-bottom: 1px solid var(--border)`, `background: transparent`, `color: var(--text)`, `text-align: left`, `cursor: pointer`.
- `.stations-cloud-results .logo-slot`: `width: 24px`, `height: 24px`, `flex: 0 0 auto`, `border-radius: 50%`.
- `.stations-cloud-results .logo-img`: `width: 100%`, `height: 100%`, `object-fit: cover`.
- `.stations-cloud-results-empty`: `padding: 12px`, `font-size: 10px`, `color: var(--text-muted)`.
- `.stations-cloud-empty`: centered, muted, padding 24px.
- `.stations-cloud-tooltip`: `position: absolute`, `z-index: 7`, `padding: 4px 7px`, `border: 1px solid var(--border)`, `border-radius: var(--radius-sm)`, `background: var(--bg)`, `color: var(--text)`, `font-size: 9px`, `pointer-events: none`, `white-space: nowrap`.
- `@keyframes stations-cloud-float`: `from { transform: translateY(0); } to { transform: translateY(-6px); }`. Use `translate` in the keyframes instead of `transform` if the browser supports it. Do not combine with the world transform.
- `@keyframes stations-cloud-match`: `from { outline-color: transparent; } to { outline-color: var(--text); }`.
- At 699px: `.stations-cloud` min-height 0; `.stations-cloud-ring-label` width 120px; `.stations-cloud-hint` font-size 9px; controls respect `env(safe-area-inset-bottom)` and `env(safe-area-inset-right)`.
- `@media (prefers-reduced-motion: reduce)`: disable float and match animation, set all transitions to 0.

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS for all unit tests, especially Task 1, Task 4, and Task 5.

- [ ] **Step 9: Verify Cloud in the browser**

Run: `npm run dev`.
Check at 680px and 375px:

- Cloud renders one bubble per visible collection. Bubbles do not overlap.
- Drag pans, wheel zooms, pinch zooms, and the zoom buttons work.
- Clicking a bubble opens a ring with every station. A 55-station collection uses three rings.
- Clicking a thumbnail starts playback and shows the red playing ring.
- `All collections`, Escape, and an empty-stage click return to the overview.
- Search finds collections and stations. Collection rows open rings. Station rows open the collection, highlight, and play.
- Switching to Small or Large removes the Cloud listeners. Reopening Cloud does not duplicate handlers.
- Closing and reopening the panel does not leave a running Cloud.
- The Cloud stage fills the Discover content and scrolls nothing behind it.
- No console errors.

- [ ] **Step 10: Commit**

```bash
git add src/ui/discover-cloud.js src/ui/stations-panel.js src/styles/stations.css
git commit -m "feat(discover): add interactive collection cloud"
```

---

### Task 7: Final verification and polish

**Files:**
- Modify only files already touched by this plan if a check fails.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a verified local branch with no deploy.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: all tests pass, including `stations-explore`, `stations-row`, `discover-child`, and `discover-cloud`.

- [ ] **Step 2: Run the local app and walk the complete flow**

Run: `npm run dev`.
At 680px and 375px:

- Explore is the first tab and default on open.
- The first 60 rows are correct, scrolling adds 60, and the tier boundary is correct.
- Explore source chips are readable.
- Play, info, and heart work from Explore.
- Shuffle starts playback.
- Search from Explore and clearing returns to Explore.
- Discover toolbar is right-aligned and subtle.
- Search filters collections and shows station matches.
- Small, Large, and Cloud toggle correctly.
- Large `...` expands every station and only one card at a time.
- Cloud pans, zooms, opens a ring, plays a station, and returns.
- Cloud search opens and plays.
- Switching views does not leave duplicate listeners or duplicate audio.
- Close and reopen the panel, then confirm Cloud is not still running.
- The collection grid gap is 14px in computed styles.
- No console errors.

- [ ] **Step 3: Check the diff and whitespace**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Only the intended files are modified.

- [ ] **Step 4: Fix any failures in the owning task**

If a check fails, fix it in the task that owns the code, rerun that task's tests, and rerun the full suite. Do not add unrelated refactors.

- [ ] **Step 5: Commit any final fixes**

```bash
git add src/ui/stations-explore.js src/ui/stations-row.js src/ui/discover-child.js src/ui/discover-cloud.js src/ui/stations-panel.js src/styles/stations.css test/stations-explore.test.js test/stations-row.test.js test/discover-child.test.js test/discover-cloud.test.js
git commit -m "fix(discover): polish explore and cloud interactions"
```

If no fixes were needed, skip this commit.

- [ ] **Step 6: Report**

Report the branch, the test result, the browser checks completed, and any remaining limitation. Do not push or deploy.
