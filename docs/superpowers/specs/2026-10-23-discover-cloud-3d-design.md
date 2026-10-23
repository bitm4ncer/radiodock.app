# Discover Cloud 3D and configurable axes

## Summary

RadioDock's Discover Cloud gains an optional 3D view while preserving the existing collection graph, focus ring, search, themes, fullscreen behavior, and Tiny Player integration. The 2D view replaces its fixed axis presets with independent horizontal and vertical axis assignment.

The feature remains dependency-free and uses DOM, SVG, CSS, and JavaScript perspective projection. It renders every published collection supplied at runtime. No collection count is hardcoded.

Implementation and verification stay local. This work does not include deployment.

## Goals

- Add a responsive 2D/3D mode switch with 2D as the default.
- Use the existing collection nodes and `buildCloudModel(...).edges` in both modes.
- Let users assign the 2D X and Y axes independently.
- Use Acoustic/Electronic, Calm/Intense, and Dark/Bright as the fixed 3D dimensions.
- Keep navigation and animation smooth on desktop and mobile.
- Preserve collection focus rings, search, fullscreen, Tiny Player, and light/dark themes.
- Never start a station or trigger playback as a result of entering 3D, navigating it, or selecting a collection.
- Keep deterministic positions as the published collection list grows.

## Non-goals

- WebGL, canvas rendering, or a new rendering dependency.
- Backend or schema changes.
- Automatic axis inference from station data.
- User-authored collection vectors.
- A deployment or production release.
- A rewrite of the existing 2D cloud and focus-ring renderer.

## Data model

### Genre dimensions

Each curated vector gains a fourth numeric dimension:

```js
{
  family: '...',
  electronic: 0..100,
  energy: 0..100,
  era: 0..100,
  mood: 0..100,
}
```

The dimensions mean:

| Key | 0 | 100 |
| --- | --- | --- |
| `electronic` | Acoustic | Electronic |
| `energy` | Calm | Intense |
| `era` | Roots | Modern |
| `mood` | Dark | Bright |

`mood` describes the collection's broad emotional color. It is not a quality, popularity, or personal-preference score. Existing curated vectors receive editorial mood values. Existing electronic, energy, and era values remain unchanged.

### Dynamic collections and fallback vectors

The cloud consumes every published collection provided to `buildCloudModel`. It does not assume 71, 74, or any other fixed number.

When a slug has no curated vector, a stable hash of that slug produces all four numeric dimensions. The fallback must not depend on array index, collection order, or collection count. Adding a future collection therefore cannot move an existing fallback collection.

Curated graph edges remain the source of relationships. Edges whose endpoints are not present in the current runtime collection set remain filtered out as they are today.

## Architecture

### Preserve the existing renderer

The existing 2D cloud remains the primary renderer. A small 3D scene controller is added inside the Discover Cloud module rather than replacing the 2D camera and layout system.

The controller owns:

```js
{
  mode: '2d' | '3d',
  orbit: { yaw, pitch, distance },
  axes2d: { x, y },
  renderDirty: boolean,
}
```

Entering 3D saves the active 2D camera state. Leaving 3D removes 3D-only styles and restores that state. The same node buttons and edge elements are reused. No duplicate collection DOM is created.

Pure geometry helpers handle rotation, perspective projection, depth, and axis projection. Keeping these calculations independent of the DOM makes them deterministic and unit-testable.

### 2D axis layouts

The fixed `Vibe`, `Era`, and `Texture` controls are removed. The model prepares or lazily caches layouts by axis pair. A pair is identified by both ordered dimensions, so swapping X and Y produces the corresponding transposed layout.

The initial pair remains:

- X: Acoustic/Electronic
- Y: Calm/Intense

Changing either assignment animates from current screen coordinates to the selected layout. It does not rebuild nodes, graph edges, previews, or event listeners.

The same dimension is never left on both axes. If a user selects the dimension currently assigned to the other axis, the two assignments swap. This keeps every selection useful while making both controls independent.

### 3D projection

The fixed 3D coordinates are normalized from:

- X: `electronic`
- Y: `energy`
- Z: `mood`

Each frame uses one yaw/pitch rotation matrix and a perspective projection based on camera distance and focal length. Projected coordinates position nodes using CSS transforms. Projection depth controls node scale, opacity within a restrained range, pointer eligibility, and stacking order.

Three projected SVG axes show these endpoint labels:

- Acoustic / Electronic
- Calm / Intense
- Dark / Bright

Existing graph edges are projected between their endpoint nodes and remain dashed. Hovering or focusing a collection highlights the same neighboring nodes and edges as in 2D.

Nodes behind the near plane are hidden and cannot receive pointer events. Values are clamped so an extreme zoom or viewport size cannot generate invalid transforms.

## Interaction design

### Primary controls

The upper-right corner contains only one compact 2D/3D toggle. It exposes an accessible name and `aria-pressed`, with 2D as the unpressed default.

The old axis preset control is removed. In 2D, a compact axis button near the lower-left edge summarizes the current assignment, for example `Axes: Electronic x Energy`. It opens one responsive axis editor:

- Desktop: a compact floating panel anchored near the axis button.
- Mobile: a bottom sheet above the safe area.

The editor contains clearly labeled X and Y native selects or equivalent semantic radio groups, plus a dedicated Swap axes button. Changes apply immediately. Escape, outside activation, and the close control dismiss the editor and return focus to its trigger.

The existing zoom, reset, and fullscreen capabilities remain available but are not placed in the upper-right mode-toggle position. They use a separate compact utility group near the lower-right edge. Touch targets are at least 44 by 44 CSS pixels on coarse pointers.

### 2D navigation

Current pan, wheel zoom, pinch zoom, zoom buttons, reset, and collection interactions remain behaviorally unchanged except for the configurable axes.

### 3D navigation

- One-pointer drag changes yaw and pitch.
- Pitch is clamped to avoid disorienting inversion.
- Wheel and two-pointer pinch change camera distance.
- Plus and minus adjust camera distance around the cloud center.
- Reset restores the default yaw, pitch, and distance.
- Input deltas are accumulated and rendered once per animation frame.
- Pointer capture keeps drags stable when a pointer crosses a node or leaves the stage.

Dragging beyond a small movement threshold suppresses the following click. A regular click or keyboard activation on a collection first exits 3D, then opens the existing in-cloud focus ring for that collection. This path must not call `playStation` or `onPlay`. Playback remains possible only through the existing explicit station action inside the focus ring.

Search results follow the same rule: selecting a collection while in 3D exits 3D and opens that collection's focus ring without playback.

### Labels and tooltips

Collection labels are hidden in 3D to avoid depth clutter. Hover and keyboard focus show the existing tooltip with the collection name. Tooltip placement is clamped to the viewport and does not participate in the projection transform.

### Mode transitions

Mode and axis changes use a short position interpolation rather than rebuilding the scene. No large gradient, glow, or decorative depth effect is introduced. `prefers-reduced-motion: reduce` makes these transitions immediate while preserving all controls and state changes.

## Responsive behavior

- Controls respect viewport safe-area insets.
- The mode toggle remains in the upper-right corner at every breakpoint.
- The axis editor becomes a bottom sheet on narrow or coarse-pointer layouts.
- Orbit starts only from the cloud stage, not from controls, the search UI, the Tiny Player, or the axis editor.
- Browser page scrolling is prevented only during an active cloud drag or pinch.
- Fullscreen recalculates projection bounds without recreating nodes.
- Portrait, landscape, resize, and device-pixel-ratio changes mark the scene dirty and schedule one render.
- Tiny Player docking and restoration continue through the existing fullscreen lifecycle.

## Accessibility

- The mode toggle has `aria-pressed` and a label that describes the action.
- Axis controls have explicit horizontal and vertical labels.
- Visible axis lines remain decorative, while the stage or control description announces the active dimensions.
- Collection buttons retain their existing keyboard behavior.
- Focus and hover produce equivalent neighbor highlighting and tooltips.
- The axis editor manages initial focus, Escape, dismissal, and focus restoration.
- Focus indicators remain visible in light and dark themes.
- Instructions change between 2D and 3D and between fine and coarse pointers.
- Reduced-motion users get immediate state changes without losing spatial information or functionality.

## Performance strategy

### Render scheduling

There is no permanent animation loop. State changes call a single invalidation function that schedules `requestAnimationFrame` only when the scene is dirty. Orbit, pinch, wheel, resize, transitions, and mode changes can invalidate the scene. An idle cloud performs no projection work.

Pointer events store the latest input state. Geometry and DOM updates happen at most once per animation frame, even when the browser delivers more pointer events.

### Hot-path constraints

- Cache normalized 3D coordinates, edge endpoint references, and node element references.
- Calculate trigonometric values and the rotation matrix once per frame.
- Avoid `getBoundingClientRect`, computed-style reads, and DOM queries inside the frame loop.
- Batch reads before writes when dimensions must be measured.
- Update node transforms and SVG edge geometry only when their serialized values changed.
- Reuse arrays and small projection records where practical to reduce garbage collection during orbit.
- Apply `will-change` only during active interaction or transition, then remove it.
- Keep depth effects to transform, opacity, visibility, and stacking. Do not animate layout properties.
- Pause transition work when the document is hidden and render the final state when it becomes visible again.

The expected collection scale is the complete runtime list plus future growth. The implementation must remain correct without a count limit. Performance work must be measurement-led rather than hiding valid collections or edges by default.

### Audit and acceptance

A local browser performance audit compares idle, orbit, wheel zoom, pinch emulation, axis changes, mode transitions, fullscreen, and focus-ring opening. It includes desktop and a mobile viewport with CPU throttling where browser tooling permits.

The audit records:

- observed frame duration and dropped or long frames during sustained interaction
- scripting, style, layout, and paint costs
- forced synchronous layout warnings
- event-listener or animation work while idle
- memory or detached-node growth after repeated mode changes

The target is a 16.7 ms frame budget on a typical desktop and the smoothest sustainable result under throttled mobile conditions. This is a target, not a claim made before measurement. Any remaining limitation is documented with measured evidence.

## Error handling and cleanup

- Unknown axis keys fall back to the default 2D pair.
- Invalid or missing vector values are replaced by the slug-based deterministic fallback and clamped to 0 through 100.
- Projection rejects non-finite values and hides unprojectable geometry rather than emitting invalid CSS or SVG values.
- Fullscreen promise rejection preserves the current layout and Player placement.
- Cloud destruction cancels pending animation frames and transitions, releases pointer capture, removes listeners and observers, closes the axis editor, and restores moved Player DOM.

## Testing

### Unit tests

- Stable slug-hash fallback is independent of collection order and count.
- All four vector dimensions stay within 0 through 100.
- Every currently published curated collection has an editorial vector and mood value.
- Arbitrary ordered 2D axis pairs produce deterministic, bounded layouts.
- Selecting an occupied dimension swaps X and Y.
- 3D rotation and perspective projection return finite, deterministic coordinates and depth.
- Camera-distance and pitch clamps are enforced.
- Near-plane visibility behaves correctly.
- Runtime edges remain filtered and deduplicated.
- Existing ring layout and cloud search tests continue passing.

### Behavioral verification

Local browser checks cover:

- 2D pan, zoom, reset, search, axis selection, and axis swapping
- 3D entry, orbit, wheel zoom, pinch, buttons, reset, and exit
- collection click and keyboard activation from 3D into the focus ring
- confirmation that collection navigation never calls playback
- hover and focus neighbor highlighting and tooltips
- fullscreen entry/exit and Tiny Player placement
- light and dark themes
- mobile portrait and landscape layouts
- reduced motion
- repeated mode changes and teardown

### Project verification

- `npm test`
- `npm run build`
- Local browser performance recording and visual inspection

## Intended file scope

- `src/ui/cloud-genre-map.js`: axis metadata, mood values, and dimension projection helpers.
- `src/ui/discover-cloud.js`: stable fallback, axis assignment, 3D controller, projection, interaction, and render scheduling.
- `src/styles/stations.css`: mode switch, axis editor, 3D state, responsive controls, and reduced-motion styling.
- `test/cloud-genre-map.test.js`: vector, mood, dimension, and projection coverage.
- `test/discover-cloud.test.js`: fallback, dynamic axes, geometry, and regression coverage.

No backend file or dependency manifest should change.
