# Explore Feed and Discover View Modes

- Date: 2026-10-22
- Status: Approved for implementation planning
- Repository: `radiodock.app`
- Worktree: `C:/GitHub/rd-wt/stations-explore-discover`
- Branch: `feat/stations-explore-discover`
- Base: local `main` at `4bc0151`, plus `public/discover.json` synced from `origin/main` in `8930df9`

## 1. Context

The Stations window currently opens on Popular. Its curated collections live on the Discover page, where every collection is shown as a compact card. There is no fast way to sample the best stations across all collections, and the Discover page has only one density.

This change adds:

1. An Explore feed that mixes all curated collections while preserving a rough quality order.
2. A compact Discover toolbar with search and three view modes.
3. A Large collection layout with inline station expansion.
4. A Cloud view that turns the collections into an interactive constellation of station thumbnails.

The work stays inside the PWA. There is no backend, API, or dependency change.

## 2. Goals

- Make Explore the first and default Stations tab.
- Surface the strongest stations across all collections first, then progressively deeper cuts.
- Add local search across collection titles and station names on Discover.
- Add Small, Large, and Cloud display modes with a clear, quiet control.
- Make Cloud feel spatial and alive without sacrificing crisp logos, playback, or accessibility.
- Keep Discover usable at panel widths from 375px to 680px.
- Keep all work local. No deploy.

## 3. Non-goals

- No changes to collection curation, ranking, or the published `discover.json`.
- No new backend endpoint, database query, or runtime dependency.
- No persistence of the Discover view mode across sessions.
- No new audio player. Cloud and Explore use the existing player actions.
- No redesign of the Stations search, filters, A-Z rail, or Community tab.
- No changes to the main checkout at `C:/GitHub/radiodock.app`.

## 4. Data

`public/discover.json` is the only source for curated collections.

Current synced shape:

```json
{
  "version": 1,
  "generatedAt": "2026-10-21T21:13:18.735Z",
  "curated": {
    "lists": [
      {
        "slug": "jazz",
        "title": "Jazz",
        "source": "radiodock",
        "featured": true,
        "stations": [
          {
            "stationuuid": "uuid",
            "name": "Station name",
            "countrycode": "DE"
          }
        ]
      }
    ]
  },
  "trending": [],
  "explorer": []
}
```

Facts for the current data:

- 35 curated lists.
- 791 station rows.
- 785 unique station UUIDs.
- Station rows contain only `stationuuid`, `name`, and `countrycode`.
- List order is the curated order. Station order inside each list is the curated order.
- `normaliseDiscover` already drops lists without a slug, title, or stations, and deduplicates list slugs.

Any feature that needs stream URLs, tags, or other full station fields must resolve the station through `getStationByUuid` first.

## 5. Explore

### 5.1 Entry and default behavior

- Explore is the first button in the Stations mode control, to the left of Popular.
- The mode control becomes: Explore, Popular, A-Z, Community.
- Every closed-to-open transition without a query selects Explore and builds a fresh feed.
- Every closed-to-open transition with a query enters search mode with `previousMode = "explore"`, so clearing the search returns to Explore.
- Opening the panel from Discover, a collection, or another station mode returns to the Stations shell with Explore selected.
- The feed is reshuffled on every open, not on every click of the Explore tab.
- Switching to Popular and back during the same open reuses the current Explore feed and its reveal depth.
- Explore hides the country and genre filters. The search input remains visible.
- The A-Z rail stays hidden in Explore.

### 5.2 Feed construction

Create `src/ui/stations-explore.js` with a pure feed builder.

```js
export const EXPLORE_PAGE_SIZE = 60;

export function buildExploreFeed(lists, random = Math.random) {
  // returns an array of feed stations
}
```

Each returned item has this shape:

```js
{
  id: stationuuid,
  stationuuid,
  name,
  countrycode,
  collectionSlug,
  collectionTitle,
  tier: 1 | 2 | 3,
  position: number
}
```

`position` is the zero-based position inside the source collection.

Tier rules:

- Position 0 to 4: Tier 1.
- Position 5 to 9: Tier 2.
- Position 10 and above: Tier 3.

Deduplication rules:

- Deduplicate by `stationuuid` across all lists.
- If a station appears more than once, keep the occurrence with the lowest tier number.
- If two occurrences share the lowest tier, keep the one encountered first in list order.
- The winning occurrence supplies `collectionSlug`, `collectionTitle`, and `position`.
- The returned feed contains every unique station exactly once.

Ordering rules:

- Shuffle Tier 1 independently.
- Shuffle Tier 2 independently.
- Shuffle Tier 3 independently.
- Concatenate Tier 1, then Tier 2, then Tier 3.
- Shuffle must be Fisher-Yates and use the injected `random` function.
- The function must not mutate the input lists or stations.

Empty and short lists:

- A list with fewer than 5 stations contributes only to Tier 1.
- A list with 5 to 9 stations contributes to Tier 1 and Tier 2.
- A list with 10 or more stations contributes to all tiers.
- Missing or empty lists produce an empty feed.

### 5.3 Progressive reveal

- The panel stores the full feed in `state.exploreFeed`.
- The initial `state.exploreLimit` is 60.
- `state.rows` is `state.exploreFeed.slice(0, state.exploreLimit)`.
- Scrolling within 240px of the end appends the next 60 stations by increasing `state.exploreLimit` and re-rendering the list with the current scroll position preserved.
- When the limit reaches the feed length, the endless sentinel is removed.
- Tier 1 is always fully present before Tier 2 begins because the feed itself is ordered by tier.
- The section header may show the total station count and collection count, but it must not show a tier control or filter.

### 5.4 Row presentation

Explore rows use the existing `stationsRow` markup and add a source chip.

- Extend `stationsRow(station, opts)` with an optional `source` string.
- When present, render a small non-interactive `.stations-row-source` chip in the metadata line.
- The chip text is the collection title.
- The chip must not be an anchor or button. The row main button already owns the row click.
- The chip truncates with an ellipsis when the title is long.
- No tier badge is shown on the row. The order itself communicates the tier.
- The row `data-id` and the station `id` are the `stationuuid`.

### 5.5 Actions

Explore stations are lightweight until resolved.

- Play, info, and add must call `getStationByUuid` before using the station.
- Use a shared resolution helper. A station needs resolution when it has no `url`.
- Play: flash the row immediately, resolve, then call `actions.onPlay(fullStation)`. On failure, remove the flash and toast `Station not available right now.`
- Info: resolve, then call `toggleInlineInfo(anchor, fullStation)`.
- Add: resolve, then call the existing heart flow with the full station. On failure, toast and do not add.
- The heart state still keys off the UUID, so `refreshAddedFlags` and `applyNowPlaying` continue to work.
- If the user clicks a row while a previous resolution is in flight, ignore the earlier result using a per-row token or the existing load token pattern.

### 5.6 Shuffle and search

- The header shuffle button in Explore picks a uniform random station from the full feed, not only the visible slice.
- It resolves the station and plays it. On failure, toast.
- If the feed is empty, shuffle falls back to `getRandomStation({ mode: "popular" })`.
- Typing in the search input leaves Explore and enters the existing API search. `previousMode` is Explore.
- Clearing the search returns to Explore with the same feed and reveal depth.
- Search results are not tiered. They use the existing search behavior.

### 5.7 Loading, empty, and error states

- Loading shows the existing skeleton list and a header `Explore` with a short loading subtitle.
- If `discover.json` fails to load, show an honest state:
  - Title: `Explore is unavailable right now.`
  - Copy: `The collection data could not be loaded.`
  - Actions: `Retry` and `Browse Popular`.
- If the feed is empty but the data loaded, show:
  - Title: `No stations in the collections yet.`
  - Action: `Browse Popular`.
- Retry rebuilds the feed and resets the limit.

### 5.8 Acceptance criteria

- On a fresh open, Explore is active and shows 60 rows.
- The first 60 rows are the first 60 entries of the tier-ordered feed.
- Tier 2 rows never appear before the last Tier 1 row.
- No UUID appears twice in the full feed.
- A station that is Tier 3 in one collection and Tier 1 in another appears in Tier 1.
- Scrolling to the bottom reveals 60 more rows until the feed is exhausted.
- Play, info, and add work on Explore rows and use the full station object.
- Search from Explore returns results, and clearing returns to Explore.
- Closing and reopening the panel builds a new order.
- Filters are hidden in Explore and return unchanged in Popular.

## 6. Discover toolbar

### 6.1 Layout

The Discover page gets a right-aligned toolbar above the collection content.

Desktop:

```text
[ optional count ]                         [ search pill ] [ Small | Large | Cloud ]
```

- The toolbar is sticky at the top of the Discover scroll area.
- It has a background matching the panel so cards scroll underneath cleanly.
- The search pill is about 220px wide and 34px tall.
- The view toggle is a compact segmented control about 34px tall.
- The toolbar uses a 10px gap.
- On mobile, the search pill fills the first row and the toggle moves to a second row aligned right.
- The toolbar must not use red. Red remains reserved for playback, errors, favorites, and the primary Discover CTA.

### 6.2 Search pill

Markup requirements:

- A label wrapper with a magnifier icon, an input, and a clear button.
- Input placeholder: `Search collections or stations`.
- Accessible name: `Search collections or stations`.
- `type="search"`, `autocomplete="off"`, `spellcheck="false"`.
- The clear button is hidden when the query is empty.
- Clear button label: `Clear search`.

Behavior:

- Search is local. It never calls the stations API.
- Debounce input by 120ms.
- Normalize the query with `trim().toLowerCase()`.
- Collection matches use a case-insensitive substring match on title and slug.
- Station matches use a case-insensitive substring match on station name.
- Station matches are deduplicated by UUID. The first collection in list order supplies the source title.
- The results area shows up to 12 station matches. If there are more, show `+ N more stations` as muted text.
- Empty query restores the normal Discover sections.
- No matches show an empty state with the query and a clear action.
- Typing must not replace the toolbar. Only the results container is re-rendered, so focus stays in the input.

### 6.3 View toggle

The toggle has three buttons:

- Small: grid icon, label `Small`.
- Large: rows icon, label `Large`.
- Cloud: orbit icon, label `Cloud`.

Requirements:

- `role="group"` with `aria-label="Collection view"`.
- Each button has `aria-pressed`.
- Desktop shows icon and label. Mobile shows icon only, with `aria-label` and `title`.
- Active state is neutral: `var(--surface)` background, normal text color, no red.
- Clicking the active view does nothing.
- The active view survives opening a collection and going back.
- Entering Discover from Stations resets the view to Small and clears the search.

### 6.4 Discover state

Add these fields to the Stations panel state:

```js
discoverView: "small" | "large" | "cloud";
discoverQuery: string;
expandedCollection: string | null;
cloud: object | null;
```

- `discoverView` defaults to `"small"`.
- `discoverQuery` resets when entering Discover from Stations.
- `expandedCollection` resets when the query or view changes.
- `cloud` holds the mounted Cloud instance or `null`.

## 7. Small view

- Small is the current card layout.
- Official collections remain in their own grid, followed by the Community collections section.
- `.stations-collection-grid` changes from `gap: 8px` to `gap: 14px`.
- The 14px gap applies to the featured grid on the Stations shell as well, because it shares the class. This is intended.
- Collection cards, save badges, hover behavior, and the community kicker stay unchanged.
- In search mode:
  - Render one `Collections` section with all matching official and community cards.
  - Community cards keep their kicker.
  - Render a `Stations` section below with matching station rows.
  - Hide the `Suggest a collection` link while a query is active.
  - Show the no-results state when both sections are empty.
- The normal `Community collections` heading and submit link return when the query is cleared.

## 8. Large view

### 8.1 Card layout

Large mode uses a single-column list.

- Container: `.stations-collection-large`.
- Card: `.stations-collection-card.is-large`.
- Up to 8 overlapping logos at 52px.
- Title: 18px.
- Count: 10px.
- Padding: 16px.
- Gap between cards: 16px.
- The cover and title sit on the left, actions on the right.
- The card head opens the collection page.
- The save button sits in the card actions and is always visible.
- On narrow panels, the cover stacks above the title and actions. The card remains single column.

### 8.2 Inline station expansion

- The card actions include a `...` button.
- `data-action="toggle-collection"`, `data-slug`, `aria-expanded`.
- Accessible label: `Show all stations in <title>` when collapsed and `Hide stations in <title>` when expanded.
- Clicking it expands all stations of that collection inline below the card head.
- Only one collection is expanded at a time. Expanding another collapses the previous.
- Clicking the same button again collapses it.
- The expanded body uses the existing collection tile pattern, two columns on desktop and one column on mobile.
- Each tile keeps play, info, and heart actions through the existing `collection-*` handlers.
- The expanded body is rendered during the same results re-render. At most one collection is expanded, so the maximum added DOM is one collection.
- After toggling, keep the card in view with `scrollIntoView({ block: "nearest" })`.
- Changing the search query or the view closes the expansion.
- Going back from a collection keeps the current view but does not need to keep the expanded card.

### 8.3 Acceptance criteria

- Large mode has one card per row.
- The logo stack is visibly larger than Small.
- The `...` button expands every station in the collection, including collections with more than 50 stations.
- Only one collection is expanded at a time.
- Play, info, and heart work from the expanded tiles.
- The save button is reachable without hovering.
- The layout is usable at 375px.

## 9. Cloud view

### 9.1 Principles

- Cloud is DOM and CSS transforms, not WebGL.
- Thumbnails must be crisp and clickable.
- Every bubble and thumbnail is a real button.
- The view is a constellation of collections, not a scatter of individual stations.
- The visual language is quiet and premium: near-black stage, thin borders, soft glows, logos as the only strong color.
- Red appears only for the currently playing station and playback controls.

### 9.2 Model and layout

Create `src/ui/discover-cloud.js` with these pure functions:

```js
export function buildCloudModel(lists) {
  // returns { nodes, edges, bounds, nodeBySlug, stationByUuid }
}

export function ringLayout(count, options) {
  // returns [{ index, x, y, ring }]
}

export function matchCloud(model, query, options) {
  // returns { collections, stations }
}
```

Node shape:

```js
{
  slug,
  title,
  count,
  stations: [...],
  preview: [{ station, x, y, size }],
  radius,
  x,
  y
}
```

Model rules:

- One node per visible collection.
- `count` is `list.stations.length`.
- `preview` uses the first 5 to 8 stations in curated order. If the list has fewer than 5, use all of them.
- Preview logos sit inside the bubble on an orbit at about 42% of the radius.
- Preview logo size is about 32% of the bubble radius, clamped to a readable range.
- Bubble radius grows with station count: `72 + sqrt(count) * 7`, clamped between 80 and 140 world units.
- Layout uses a deterministic phyllotaxis placement with a small slug-based jitter, followed by collision relaxation.
- The same input must always produce the same positions.
- No two bubbles may overlap. Required clearance is at least 20 world units between circles.
- The model centers the constellation around the origin and returns bounds with 240 world units of padding.
- `nodeBySlug` and `stationByUuid` are in-memory lookup maps.

Edges:

- Compute a country similarity between collections using the Jaccard similarity of their non-empty `countrycode` sets.
- Connect each node to its two most similar nodes when similarity is greater than zero.
- Deduplicate unordered pairs.
- Edges are visual relationships, not a ranking signal.
- Nodes without country data may have no edges.

### 9.3 Stage and bubbles

Stage:

- The stage fills the Discover content below the toolbar.
- Background: very dark base with a soft radial vignette and a faint dot or star field.
- The stage clips its overflow.
- The stage uses `touch-action: none`.
- A small hint sits bottom-left: `Drag to pan. Scroll to zoom. Click a collection.`
- On mobile the hint uses `Pinch to zoom`.

Bubble:

- Circular translucent surface with a thin light border.
- Soft outer shadow and a faint inner glow.
- 5 to 8 preview logos arranged in an orbit.
- Collection title and station count below the bubble.
- Bubble size encodes station count, but not so strongly that small collections become unreadable.
- Hover and focus brighten the border and lift the bubble slightly.
- A gentle vertical float animation, 8 to 12 seconds, staggered by index.
- Reduced motion disables the float.
- Labels for the 12 collections with the highest station counts are visible at overview scale. All labels appear once the camera scale reaches `fitScale * 1.15`. Hover and focus always show the label.

Links:

- Rendered in an SVG overlay inside the transformed world.
- Thin, faint, slightly curved paths.
- `vector-effect: non-scaling-stroke` so links stay thin while zooming.
- Hovering or focusing a bubble highlights its links and dims other bubbles slightly.
- Links must not capture pointer events.

### 9.4 Camera

The world is a single transformed element.

Camera state:

```js
{
  scale,
  tx,
  ty
}
```

Transform:

```css
transform: translate3d(tx, ty, 0) scale(scale);
transform-origin: 0 0;
```

Behavior:

- Initial view fits the whole constellation with 8% padding.
- Drag pans.
- Wheel zooms toward the cursor.
- Pinch zooms toward the midpoint of two pointers.
- `+` and `-` buttons zoom around the stage center.
- Reset fits the whole constellation.
- Scale is clamped between `fitScale * 0.75` and `fitScale * 5`.
- Programmatic moves use an eased camera animation of about 420ms.
- Reduced motion makes programmatic moves instant.
- A drag threshold of 5px suppresses accidental bubble clicks.
- Dragging must not select text or images.
- Zooming and panning hide any active tooltip.

### 9.5 Collection ring

Clicking a bubble opens its collection ring.

- The camera flies in and centers the collection.
- The rest of the constellation fades to about 16% opacity and becomes non-interactive.
- Links fade back.
- The selected bubble is replaced by a ring of all station thumbnails.
- The collection title and station count sit in the center.
- Rings:

```text
1 to 18 stations:   1 ring
19 to 36 stations:  2 rings
37 or more:         3 rings
```

- Stations are distributed evenly. Each ring is offset by half a step to avoid visual alignment.
- Thumbnail size is 52px on wide stages and 44px on narrow stages.
- Hover and focus show a tooltip with the station name and country.
- Clicking a thumbnail resolves the station and plays it.
- Clicking a thumbnail flashes it immediately. The red playing ring follows the real now-playing state.
- The center label shows the collection title, the count, and the currently playing station name when it belongs to this collection.
- Back controls:
  - `All collections` button at the top-left of the stage.
  - Escape.
  - A click on empty stage space, when it is not the end of a drag.
- Returning to the overview restores the camera and focuses the bubble that was open.
- Opening a collection with a station search match highlights that thumbnail for about 1.6 seconds.

### 9.6 Cloud search

The Discover search pill stays visible above the stage.

- The Cloud module owns a results panel below the search pill.
- The panel shows up to 6 collection matches and 12 station matches.
- Collection rows show the title and count.
- Station rows show logo, name, and source collection.
- Clicking a collection row opens its ring.
- Clicking a station row opens its collection, highlights the thumbnail, and plays the station.
- Empty results show a quiet no-results row.
- Clearing the query hides the panel and returns to the current cloud state.
- Escape closes the results panel before it closes the ring.
- The search input keeps focus. The panel must not rebuild the stage.

`matchCloud(model, query, { collectionLimit = 6, stationLimit = 12 })` returns:

```js
{
  collections: [{ slug, title, count }],
  stations: [{ stationuuid, name, countrycode, collectionSlug, collectionTitle }],
  collectionTotal,
  stationTotal
}
```

### 9.7 Playback

- The Cloud module never fetches station data itself.
- It calls `onPlay(uuid)`.
- The Stations panel resolves the UUID through `getStationByUuid` and calls `actions.onPlay(fullStation)`.
- On success, the panel updates the Cloud now-playing state through `cloud.setNowPlaying(uuid)`.
- `applyNowPlaying` also forwards the current UUID to `state.cloud`.
- The Cloud module updates the ring thumbnail class and the center label.
- A failed resolution removes the temporary flash and shows the existing toast.

### 9.8 Accessibility and keyboard

- The stage has an accessible label and instructions.
- Bubbles and station thumbnails are buttons.
- Bubbles are reachable with Tab. Enter or Space opens the ring.
- After opening a ring, focus moves to the first station thumbnail.
- Shift+Tab reaches the `All collections` button.
- Escape closes the ring and returns focus to the bubble.
- Search results are buttons in a labelled region.
- Focus-visible outlines are visible on the dark stage.
- The zoom controls have accessible labels.
- The now-playing state is not communicated by color alone. The center label names the station.

### 9.9 Mobile

- The toolbar wraps to two rows: full-width search, then the view toggle.
- The stage uses the remaining viewport height.
- One-finger drag pans.
- Pinch zooms.
- Tap opens a bubble.
- Tap a thumbnail plays.
- Ring thumbnails are 44px.
- The back button and zoom controls respect safe-area insets.
- The results panel spans the stage width with a 12px inset and a maximum height of 50%.

### 9.10 Performance and cleanup

- Render preview logos for all bubbles up front. That is at most about 280 images for 35 collections.
- Render ring thumbnails only when a collection is opened.
- Use one transformed world element, not per-bubble transforms for camera movement.
- Use CSS transitions and animations only.
- Do not use backdrop filters in the cloud.
- Cancel the camera animation frame on destroy.
- Remove pointer, wheel, keydown, and resize listeners on destroy.
- Disconnect the ResizeObserver on destroy.
- Clear highlight and tooltip timers on destroy.
- Remove the cloud stage markup on destroy.
- The Stations panel must call destroy before switching views, opening a collection, leaving Discover, resetting the panel, or closing the panel.
- The Cloud module must be safe to destroy twice.

### 9.11 Acceptance criteria

- Cloud renders one bubble per visible collection.
- Bubbles do not overlap.
- Drag pans, wheel zooms, pinch zooms, and the zoom buttons work.
- Clicking a bubble opens a ring containing every station in that collection.
- The ring uses one, two, or three rows according to the count.
- Clicking a station starts playback and shows the red playing state.
- `All collections`, Escape, and an empty-stage click return to the overview.
- Search finds collections and stations and performs the documented actions.
- Switching to Small or Large removes the cloud listeners. Reopening Cloud does not duplicate handlers.
- The view is usable at 375px and 680px.
- No console errors.

## 10. Architecture

### 10.1 New modules

`src/ui/stations-explore.js`

- Pure feed construction, tiering, deduplication, and shuffle.
- No DOM access.
- Injectable random function for tests.

`src/ui/discover-cloud.js`

- Pure model, layout, ring, and search helpers.
- `mountDiscoverCloud(host, options)` for DOM, camera, and interactions.
- Returns `{ destroy, setNowPlaying, search, openCollection, reset, element }`.
- No import from `stations-panel.js`.

`mountDiscoverCloud` options:

```js
{
  lists,
  nowPlayingId,
  onPlay(uuid)
}
```

### 10.2 Discover child changes

Extend `src/ui/discover-child.js` with:

- `renderDiscoverToolbar({ view, query })`
- `renderDiscover({ lists, isSaved, view, query, expandedSlug })`
- `renderDiscoverResults({ lists, isSaved, view, query, expandedSlug })`
- `renderLargeCollectionCard(list, { saved, saving, expanded })`
- `searchDiscover(lists, query)`
- `matchesCollection(list, query)`

Keep the module free of panel state and network calls. It renders strings and returns data.

The existing `collectionCard`, `collectionSaveButton`, `collectionTile`, `renderDiscoverUnavailable`, `featuredLists`, and `pickFeaturedLists` remain.

### 10.3 Stations panel changes

Add or update:

- `ensureDiscover()` with an in-flight promise so Explore and the featured section share one fetch.
- Explore state and `loadExplore({ reset, rebuild })`.
- Explore branch in `renderHeader`, `sectionHead`, `loadingHead`, `emptyState`, `renderContent`, and `onContentScroll`.
- Explore branch in `setMode`, `clearSearch`, and `shuffle`.
- Shared station action helper for play, info, and add, used by Stations rows and Discover search rows.
- Discover body rendering that replaces only `#discoverResults`.
- Toolbar input, clear, and view events.
- Large expansion state and re-render.
- Cloud mount, search forwarding, now-playing forwarding, and destroy.

`applyNowPlaying` forwards to `state.cloud` when present.

### 10.4 Data flow

Explore:

```text
open()
  -> loadExplore({ reset: true, rebuild: true })
  -> ensureDiscover()
  -> buildExploreFeed(lists)
  -> state.rows = feed.slice(0, 60)
  -> renderContent()
```

Scroll:

```text
onContentScroll()
  -> exploreLimit += 60
  -> state.rows = feed.slice(0, limit)
  -> renderContent() with scroll restored
```

Cloud:

```text
setDiscoverView("cloud")
  -> destroyCloud()
  -> render results host
  -> mountDiscoverCloud(host, { lists, nowPlayingId, onPlay })
  -> if query, cloud.search(query)
```

Play:

```text
cloud.onPlay(uuid)
  -> resolveStation(uuid)
  -> actions.onPlay(fullStation)
  -> player updates nowPlayingId
  -> panel.applyNowPlaying(id)
  -> cloud.setNowPlaying(id)
```

### 10.5 Error handling

- `discover.json` fetch failure: Explore and Discover show an honest unavailable state. The panel remains usable.
- Missing station on resolution: toast `Station not available right now.` and leave the UI unchanged.
- Cloud empty lists: show `No collections to show yet.` inside the stage.
- Logo failure: existing initials fallback.
- View switch while a cloud animation is running: destroy cancels the animation.
- Rapid search input: the 120ms debounce and view-state check prevent stale renders from opening a cloud the user has left.

## 11. Styling

Add to `src/styles/stations.css`:

- `.stations-collection-grid { gap: 14px; }`
- `.stations-row-source`
- `.stations-discover-toolbar`
- `.stations-discover-search`
- `.stations-discover-search-input`
- `.stations-discover-clear`
- `.stations-view-toggle`
- `.stations-view-btn`
- `.stations-view-icon`
- `.stations-view-label`
- `.stations-collection-large`
- `.stations-collection-card.is-large`
- `.stations-logo-stack.is-large`
- `.stations-collection-large-head`
- `.stations-collection-large-main`
- `.stations-collection-large-actions`
- `.stations-collection-more`
- `.stations-collection-large-stations`
- `.stations-cloud`
- `.stations-cloud-stage`
- `.stations-cloud-world`
- `.stations-cloud-links`
- `.stations-cloud-node`
- `.stations-cloud-bubble`
- `.stations-cloud-orbit`
- `.stations-cloud-logo`
- `.stations-cloud-label`
- `.stations-cloud-ring`
- `.stations-cloud-ring-label`
- `.stations-cloud-station`
- `.stations-cloud-tooltip`
- `.stations-cloud-controls`
- `.stations-cloud-back`
- `.stations-cloud-results`
- `.stations-cloud-hint`
- `.stations-cloud-empty`

Styling rules:

- Use existing tokens: `--bg`, `--bg-dark`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--red`, `--radius-sm`, `--radius-pill`.
- Do not introduce a new color system.
- Red is only for playing, error, favorite, and the primary Discover CTA.
- No em dashes in CSS comments or UI copy.
- Respect `prefers-reduced-motion`.
- Container query breakpoints follow the existing `stations-panel` query at 640px. Mobile layout follows the existing 699px media query.
- The Cloud stage is full-bleed inside the Discover content, with the toolbar keeping its 20px side padding.

## 12. Testing

### 12.1 Unit tests

`test/stations-explore.test.js`

- Tier boundaries at positions 4, 5, 9, and 10.
- Strict Tier 1, Tier 2, Tier 3 order.
- Deduplication across lists.
- Best-tier wins when duplicates occur in different tiers.
- First occurrence wins when duplicates share the same tier.
- Deterministic shuffle with an injected random function.
- Empty lists.
- Lists with fewer than 5 stations.
- Lists with 5 to 9 stations.
- Output station shape and `id = stationuuid`.

`test/discover-cloud.test.js`

- One node per list.
- Preview uses 5 to 8 stations or all when fewer.
- Node positions are deterministic for the same input.
- No bubble overlap.
- Bounds include padding.
- Edges are deduplicated and respect the similarity threshold.
- `ringLayout(5)` returns one ring with five points.
- `ringLayout(55)` returns three rings totaling 55 points.
- Ring points are evenly distributed and unique.
- `matchCloud` finds collection titles.
- `matchCloud` finds station names across collections.
- Station matches deduplicate by UUID.
- Limits are respected.
- Empty query returns no matches.

`test/discover-child.test.js`

- Toolbar renders the search input and three view buttons.
- Active view has `aria-pressed="true"`.
- Small mode renders the existing grid and cards.
- Large mode renders one-column cards with the `...` action.
- Large cards include the save button.
- Expanded Large card renders every station in the collection.
- Search filters collections by title.
- Search renders station matches with source collection.
- No results state renders.
- Clearing the query restores the normal sections.
- Community collections still render.
- Save button states still work.

Existing tests must continue to pass. Update assertions only where the Discover markup intentionally changes.

### 12.2 Manual verification

Run from the feature worktree:

```text
npm install
npm run dev
```

Browser checks:

- Panel width 680px.
- Panel width 375px.
- Explore tab is first and active on open.
- Explore rows show 60, then 120, and the tier boundary is correct.
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
- Confirm the collection grid gap is 14px in the browser.
- No console errors.

Run:

```text
npm test
```

No deploy. No changes to `C:/GitHub/radiodock.app`.

## 13. Rollout

- All work stays on `feat/stations-explore-discover`.
- The spec commit is separate from implementation commits.
- The implementation plan is written next and approved before code starts.
- The main checkout stays untouched.
- The branch is not pushed or deployed as part of this task unless the user asks.

## 14. Risks and mitigations

- **Cloud DOM weight:** render only preview logos until a collection opens. At most one ring is in the DOM.
- **Listener leaks:** one `destroyCloud()` path, called from every view change, collection open, panel open, and panel close.
- **Search focus loss:** never replace the toolbar. Replace only the results content.
- **Data drift:** counts and collections are read dynamically from `discover.json`. No hard-coded list count.
- **Lightweight stations:** resolve through `getStationByUuid` before play, info, or add.
- **Narrow panels:** Cloud uses stage dimensions, not fixed pixel rings. Large cards stack below 640px.
- **Reduced motion:** all float and camera easing has a reduced-motion fallback.
