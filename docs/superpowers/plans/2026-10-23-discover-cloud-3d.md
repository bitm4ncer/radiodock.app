# Discover Cloud 3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a smooth, dependency-free 3D Discover Cloud and independently configurable 2D axes without changing collection, focus-ring, search, fullscreen, Tiny Player, or playback semantics.

**Architecture:** Keep the existing 2D renderer and DOM nodes, add pure axis and 3D geometry helpers, then layer a dirty-frame 3D controller into `mountDiscoverCloud`. Use all runtime collections, stable slug-derived fallback vectors, cached ordered-axis layouts, and projected SVG geometry.

**Tech Stack:** Vanilla JavaScript ES modules, DOM, SVG, CSS, Node test runner, Vite 5

**Spec:** `docs/superpowers/specs/2026-10-23-discover-cloud-3d-design.md`

## Global Constraints

- No new dependency, WebGL, canvas renderer, backend change, or hardcoded collection count.
- Use Acoustic/Electronic, Calm/Intense, Roots/Modern, and Dark/Bright as the available 2D dimensions.
- Use Acoustic/Electronic, Calm/Intense, and Dark/Bright as the fixed 3D axes.
- Reuse existing collection node and edge DOM.
- The upper-right corner contains only the 2D/3D toggle.
- Entering, navigating, searching, or selecting a collection in 3D must never call `playStation` or `onPlay`.
- Preserve focus rings, search, fullscreen, Tiny Player, light/dark themes, keyboard access, and reduced motion.
- Render every published runtime collection and keep unknown-slug vectors stable as lists are reordered or extended.
- Verify observable behavior in a local browser and do not deploy.
- Do not use an em dash in code, UI copy, documentation, or chat.

## Review Focus

- Unknown, empty, Unicode, and very long slugs must always produce finite stable vectors without depending on list order. Task 2 adds these tests.
- Selecting the other axis's current dimension must swap the pair, never leave a duplicate-axis diagonal. Task 2 adds this test.
- Projection near or behind the camera must never emit `NaN`, `Infinity`, or pointer-active hidden nodes. Task 3 adds this test.
- Drag end and collection search selection in 3D must open only the collection ring, with no playback callback. Task 6 verifies this behavior in the browser with a playback spy.
- Repeated mode, fullscreen, and axis changes followed by teardown must leave no active frames, detached nodes, captured pointers, or displaced Player. Task 7 audits this lifecycle.

---

### Task 1: Dimension metadata and editorial mood values

**Files:**
- Modify: `src/ui/cloud-genre-map.js:7-126`
- Modify: `test/cloud-genre-map.test.js:4-62`

**Interfaces:**
- Produces: `CLOUD_DIMENSIONS`, `CLOUD_DEFAULT_2D_AXES`, `CLOUD_3D_AXES`, and generic `projectVector(vector, { x, y })`.
- Preserves: `CLOUD_GENRE_VECTORS`, `CLOUD_GENRE_EDGES`, and `CLOUD_MAP_SCALE`.

- [ ] **Step 1: Replace preset-oriented tests with failing dimension tests**

Test that `CLOUD_DIMENSIONS` has exactly `electronic`, `energy`, `era`, and `mood`; each entry has two endpoint labels; defaults equal `{ x: 'electronic', y: 'energy' }`; 3D axes equal `{ x: 'electronic', y: 'energy', z: 'mood' }`; and every vector has finite values from 0 through 100 for all four keys.

- [ ] **Step 2: Add a failing generic projection test**

Assert that `projectVector({ electronic: 20, energy: 80, era: 60, mood: 35 }, { x: 'mood', y: 'era' })` returns `{ x: (35 - 50) * CLOUD_MAP_SCALE, y: (50 - 60) * CLOUD_MAP_SCALE }`.

- [ ] **Step 3: Run the focused tests and confirm the new exports fail**

Run: `node --test test/cloud-genre-map.test.js`

Expected: FAIL because dimension metadata and `mood` do not exist.

- [ ] **Step 4: Implement dimension metadata and editorial mood values**

Add the three exported constants, make `projectVector` accept any valid `{ x, y }` pair, and add an editorial `mood` value to every curated vector. Keep all existing values and edge definitions unchanged.

- [ ] **Step 5: Run the focused tests**

Run: `node --test test/cloud-genre-map.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/cloud-genre-map.js test/cloud-genre-map.test.js
git commit -m "feat(discover): add cloud mood dimension"
```

### Task 2: Stable fallbacks and arbitrary 2D axis pairs

**Files:**
- Create: `src/ui/cloud-geometry.js`
- Create: `test/cloud-geometry.test.js`
- Modify: `src/ui/discover-cloud.js:11-235`
- Modify: `test/discover-cloud.test.js:59-155`

**Interfaces:**
- Consumes: `CLOUD_DIMENSIONS`, `CLOUD_DEFAULT_2D_AXES`, and `projectVector` from Task 1.
- Produces from `cloud-geometry.js`: `fallbackVectorForSlug(slug)`, `normaliseCloudVector(slug, vector)`, `axisPairKey(x, y)`, `normaliseCloudAxes(axes)`, and `assignCloudAxis(current, targetAxis, dimension)`.
- Produces model fields: `node.point3d` and `node.layouts[axisPairKey(x, y)]`.

- [ ] **Step 1: Write failing fallback and axis-assignment tests**

Cover identical vectors for the same unknown slug across reordered and extended list arrays; distinct finite vectors for representative unknown slugs including `''`, Unicode, and a 1,000-character slug; and all four fallback values within 0 through 100. Assert that missing or non-finite vector fields use that slug's fallback sample and out-of-range numbers clamp to 0 through 100. Assert that assigning Y to the current X value swaps X and Y, while assigning an unused dimension changes only the target axis. Assert that unknown or duplicate axis pairs normalize to `CLOUD_DEFAULT_2D_AXES`.

- [ ] **Step 2: Write failing model-layout tests**

Build all 12 ordered, non-duplicate axis pairs from the four dimensions. Assert each node has a deterministic layout for each pair, reversed pairs transpose coordinates, no pair overlaps bubbles, bounds include every pair, and adding an unknown collection does not move an existing unknown collection's anchor input.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `node --test test/cloud-geometry.test.js test/discover-cloud.test.js`

Expected: FAIL because fallback and arbitrary-pair helpers are absent.

- [ ] **Step 4: Implement stable hashing, axis assignment, and pair keys**

Use a deterministic 32-bit string hash with independent salted samples for `electronic`, `energy`, `era`, and `mood`. Clamp fallback outputs to 6 through 94 and return `family: 'other'`. `normaliseCloudVector` preserves finite supplied values after clamping them to 0 through 100 and fills invalid fields from the slug fallback. `axisPairKey` must preserve order, for example `mood:era`. `normaliseCloudAxes` accepts only two known, distinct dimensions and otherwise returns the default pair.

- [ ] **Step 5: Generalize `buildCloudModel` layouts**

Pass curated and missing vectors through `normaliseCloudVector(list.slug, CLOUD_GENRE_VECTORS[list.slug])`. Compute each unordered dimension pair once with `relaxLayout`, store its reversed transpose without rerunning relaxation, and set the default pair on `node.x` and `node.y`. Derive `point3d` from centered electronic, energy, and mood values. Remove model dependence on `CLOUD_AXIS_PRESETS`.

- [ ] **Step 6: Run the focused tests**

Run: `node --test test/cloud-geometry.test.js test/discover-cloud.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/cloud-geometry.js src/ui/discover-cloud.js test/cloud-geometry.test.js test/discover-cloud.test.js
git commit -m "refactor(discover): support arbitrary cloud axes"
```

### Task 3: Pure 3D camera and projection geometry

**Files:**
- Modify: `src/ui/cloud-geometry.js`
- Modify: `test/cloud-geometry.test.js`

**Interfaces:**
- Produces: `DEFAULT_CLOUD_ORBIT`, `clampCloudOrbit(orbit)`, `projectCloudPoint(point, orbit, viewport)`, and `projectCloudAxis(axis, orbit, viewport)`.
- `projectCloudPoint` returns `{ x, y, depth, scale, visible }`, with every numeric field finite.

- [ ] **Step 1: Write failing camera tests**

Assert default orbit values are finite; pitch clamps short of inversion; distance clamps to exported minimum and maximum constants; and repeated clamping is idempotent.

- [ ] **Step 2: Write failing projection tests**

Assert the origin projects to viewport center at zero yaw and pitch; yaw and pitch change the expected screen direction; nearer points have larger scale; points on or behind the near plane return `visible: false`; and extreme finite inputs never produce non-finite output.

- [ ] **Step 3: Write failing axis-projection tests**

Assert each projected X, Y, and Z axis returns two visible endpoints and preserves its endpoint label identity for the default orbit.

- [ ] **Step 4: Run the geometry tests and confirm failure**

Run: `node --test test/cloud-geometry.test.js`

Expected: FAIL because camera and projection exports are absent.

- [ ] **Step 5: Implement rotation, perspective, and clamps**

Normalize vectors around zero, compute one yaw/pitch rotation, translate by camera distance, reject the near plane before division, and clamp projection scale. Keep scene scale, focal length, near plane, pitch, and distance limits as named exported constants so interaction and tests share them.

- [ ] **Step 6: Run the geometry tests**

Run: `node --test test/cloud-geometry.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/cloud-geometry.js test/cloud-geometry.test.js
git commit -m "feat(discover): add cloud perspective geometry"
```

### Task 4: Responsive 2D axis editor and control layout

**Files:**
- Modify: `src/ui/discover-cloud.js:338-723,941-1021,1260-1400,1500-1709`
- Modify: `src/styles/stations.css:3021-3160,3420-3520`

**Interfaces:**
- Consumes: `assignCloudAxis`, `axisPairKey`, `normaliseCloudAxes`, and model layouts from Task 2.
- Produces inside `mountDiscoverCloud`: `setAxes2d(nextAxes)`, `openAxisEditor()`, `closeAxisEditor({ restoreFocus })`, and updated `reset()` and `destroy()` behavior.

- [ ] **Step 1: Replace preset state and controls with ordered axis state**

Initialize `axes2d` from `CLOUD_DEFAULT_2D_AXES`. Remove `axis`, `axisButtons`, and the three preset buttons. Update axis interpolation to accept source and destination pair keys and keep the existing reduced-motion behavior.

- [ ] **Step 2: Build the axis editor DOM**

Add a lower-left summary button, responsive panel, X and Y controls sourced from `CLOUD_DIMENSIONS`, Swap axes button, close button, Escape/outside dismissal, and focus restoration. Use `assignCloudAxis` so choosing the occupied dimension swaps axes. Update visible axis endpoint labels and the stage description immediately.

- [ ] **Step 3: Reorganize utility controls**

Keep zoom in, zoom out, reset, and fullscreen in a lower-right utility group. Reserve a separate upper-right container for the later mode toggle, with no other control in that position. Add the new controls to pointer-input exclusion and focus hiding/restoration while a ring is open.

- [ ] **Step 4: Add responsive and accessible styles**

Style a compact desktop panel and a mobile bottom sheet with safe-area spacing, at least 44 by 44 pixel coarse-pointer targets, visible focus, restrained surfaces, and no large gradient or glow. Ensure panel stacking works with results, tooltip, note panel, Tiny Player, and fullscreen.

- [ ] **Step 5: Run unit tests and build**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 6: Verify 2D locally before adding 3D**

In the local app, verify all 12 valid ordered pairs, automatic swap, direct swap, Escape/focus return, pan, wheel, pinch, reset, search, ring transitions, fullscreen, Tiny Player, portrait, and landscape. Confirm no preset control remains and only the reserved mode location occupies the upper-right corner.

- [ ] **Step 7: Commit**

```bash
git add src/ui/discover-cloud.js src/styles/stations.css
git commit -m "feat(discover): add configurable cloud axes"
```

### Task 5: Dirty-frame 3D renderer and scene visuals

**Files:**
- Modify: `src/ui/discover-cloud.js:338-1230,1605-1709`
- Modify: `src/styles/stations.css:2607-3160,3360-3520`

**Interfaces:**
- Consumes: projection and orbit interfaces from Task 3 and existing `model.edges`, `nodeElements`, and `linkElements`.
- Produces inside `mountDiscoverCloud`: `setMode(mode)`, `invalidateScene()`, `renderScene3d()`, `enter3d()`, `leave3d()`, and projected axis SVG elements.

- [ ] **Step 1: Add explicit mode, saved 2D camera, and orbit state**

Create the upper-right toggle button with `aria-pressed`, default it to 2D, block mode changes while a focus ring is open, and preserve the exact 2D camera across 3D entry and exit.

- [ ] **Step 2: Add one dirty-frame scheduler**

`invalidateScene()` may schedule at most one animation frame. `renderScene3d()` measures no layout, projects cached node coordinates and edge endpoints, writes changed serialized attributes only, and stops scheduling when no transition or input remains. Cancel it when hidden or destroyed and render the final state after visibility returns.

- [ ] **Step 3: Project existing nodes and links**

Reuse every node button and SVG path. Position nodes with `translate3d` and scale, set depth ordering, hide near-plane nodes from display and pointer access, project dashed edges, and preserve active/related/dimmed classes. Hide collection labels in 3D and show collection names through the existing tooltip on hover and focus.

- [ ] **Step 4: Render the three labeled axes**

Add projected SVG lines and endpoint labels for Acoustic/Electronic, Calm/Intense, and Dark/Bright. Keep them decorative to assistive technology while the stage description announces the dimensions.

- [ ] **Step 5: Add short mode interpolation**

Interpolate screen position and scale without recreating DOM. Use immediate final-state changes for reduced motion. Apply `will-change` only during orbit or transition and remove it afterward.

- [ ] **Step 6: Run tests and build**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/ui/discover-cloud.js src/styles/stations.css
git commit -m "feat(discover): render collection cloud in 3D"
```

### Task 6: Orbit input and playback-safe collection transitions

**Files:**
- Modify: `src/ui/discover-cloud.js:586-710,1023-1180,1361-1603,1633-1709`
- Modify: `src/styles/stations.css:2607-2650,3091-3169,3420-3520`

**Interfaces:**
- Consumes: `setMode`, `invalidateScene`, and orbit clamps from Tasks 3 and 5.
- Produces unified mode-aware pointer, wheel, zoom-button, reset, collection activation, search activation, and teardown behavior.

- [ ] **Step 1: Make pointer and wheel handling mode-aware**

In 2D retain current pan and zoom behavior. In 3D map one-pointer deltas to yaw/pitch, two-pointer distance to camera distance, and wheel to camera distance. Cache the stage rectangle outside move-frame writes, use pointer capture, exclude every control/result/player/note target, and invalidate once per frame.

- [ ] **Step 2: Make buttons and reset mode-aware**

In 3D, plus/minus change clamped distance and reset restores `DEFAULT_CLOUD_ORBIT`. In 2D retain current centered zoom and fit behavior. Update labels and hints for mouse, touch, 2D, and 3D.

- [ ] **Step 3: Centralize collection activation**

Add `activateCollection(slug, { stationUuid = null } = {})`. If mode is 3D, leave 3D first, then call the existing ring-opening path. Collection-node and collection-search activation must never call `playStation`. Preserve the current explicit station-search behavior in 2D, but in 3D a station search result opens and highlights its ring station without calling `playStation`.

- [ ] **Step 4: Suppress clicks after orbit and preserve keyboard activation**

Keep the 5-pixel movement threshold, clear suppression after pointer completion, and ensure Enter/Space activation on focused collection buttons is not mistaken for a drag.

- [ ] **Step 5: Complete cleanup and lifecycle handling**

Cancel scene and transition frames, close the axis editor, release captured pointers, remove visibility and media-query listeners, clear 3D inline styles, and preserve the existing fullscreen Player restoration.

- [ ] **Step 6: Run tests and build**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 7: Verify playback safety in a local browser**

Temporarily instrument the local `onPlay` callback with a counter. Verify 3D node clicks, keyboard activation, collection search results, and station search results leave the counter unchanged while opening the expected focus ring. Verify an explicit ring-station click increments it once. Remove the instrumentation before committing.

- [ ] **Step 8: Commit**

```bash
git add src/ui/discover-cloud.js src/styles/stations.css
git commit -m "feat(discover): add 3D cloud navigation"
```

### Task 7: Performance audit, optimization, and final verification

**Files:**
- Modify as measurements require: `src/ui/discover-cloud.js`
- Modify as measurements require: `src/styles/stations.css`
- Create: `docs/performance/discover-cloud-3d-audit.md`

**Interfaces:**
- Consumes the complete local feature.
- Produces measured audit evidence and any measurement-backed hot-path optimizations.

- [ ] **Step 1: Record the audit setup**

In the report, record browser version, hardware, viewport, collection/node/edge counts, reduced-motion state, and throttle settings. Do not invent unavailable metrics.

- [ ] **Step 2: Record idle and interaction traces**

Capture local traces for idle 2D, axis transition, idle 3D, sustained orbit, wheel zoom, emulated pinch, mode transition, fullscreen resize, and focus-ring opening. Repeat mobile portrait and landscape under CPU throttling where available.

- [ ] **Step 3: Inspect lifecycle and memory**

Repeat 2D/3D switching, axis changes, fullscreen entry/exit, ring open/close, and cloud destruction. Check for perpetual animation callbacks, forced synchronous layout in the interaction hot path, detached nodes, retained listeners, displaced Player DOM, and growing heap use.

- [ ] **Step 4: Optimize only measured bottlenecks**

Prefer cached rectangle and endpoint references, one rotation matrix per frame, reused projection records, changed-value guards, batched DOM writes, and temporary `will-change`. Do not hide collections or valid edges to meet a timing target. Record before/after observations and remaining limitations.

- [ ] **Step 5: Run the complete automated verification**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: Vite build succeeds.

- [ ] **Step 6: Run the complete behavioral matrix**

Verify 2D and 3D navigation, every axis pair, search, neighbor highlights, tooltips, focus rings, explicit playback, no implicit playback, fullscreen, Tiny Player, light/dark themes, reduced motion, keyboard, mobile portrait/landscape, resize, and teardown. Capture a local screenshot or recording for review, but do not deploy or publish it automatically.

- [ ] **Step 7: Check the final diff**

Run: `git diff --check`

Expected: no whitespace errors. Confirm no dependency manifest, backend file, generated `dist` artifact, local instrumentation, or unrelated user file is staged.

- [ ] **Step 8: Commit the audit and final optimizations**

```bash
git add src/ui/discover-cloud.js src/styles/stations.css
git add -f docs/performance/discover-cloud-3d-audit.md
git commit -m "perf(discover): audit 3D cloud interactions"
```
