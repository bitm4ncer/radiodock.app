# Discover Cloud 3D performance audit

Date: 2026-10-23

Scope: local Discover Cloud 3D feature, its 2D axis editor, mode transitions, orbit, zoom, focus ring, fullscreen, Tiny Player, light and dark themes, reduced motion, and mobile portrait and landscape layouts. No deployment or publish was performed.

## Setup

| Item | Value |
| --- | --- |
| Browser | Chrome for Testing 156.0.8078.4, headless Chromium via Playwright 1.64.1 |
| Platform | Windows, Node 22.14.0 |
| Desktop viewport | 1280 x 900, DPR 1 |
| Mobile portrait | 390 x 844, DPR 2, touch and coarse pointer |
| Mobile landscape | 667 x 375, DPR 2, touch and coarse pointer |
| Reduced motion | `prefers-reduced-motion: reduce` context |
| CPU throttle | 4x, mobile orbit and pinch only |
| Dataset | 89 runtime collections, 204 curated edges, 89 node buttons, 204 SVG paths, 3 projected axes |
| Page visibility | `visible` for all measured runs |

The audit used a headless browser on this machine. It is not a physical-phone or GPU benchmark. Screenshots and raw JSON were captured locally under the audit scratch directory and are not committed.

## Results

### Desktop

| Interaction | Samples | Average | p95 | p99 | Max | Frames over 17.5 ms | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Idle 2D | 60 | 16.62 ms | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 |
| Axis transition | 38 | 19.48 ms | 33.3 ms | 33.4 ms | 33.4 ms | 7 | 0 |
| Enter 3D | 72 | 16.44 ms | 16.7 ms | 16.7 ms | 16.7 ms | 0 | 0 |
| Idle 3D | 61 | 16.44 ms | 16.8 ms | 16.8 ms | 16.8 ms | 0 | 0 |
| Sustained orbit | 208 | 16.62 ms | 16.7 ms | 16.8 ms | 16.8 ms | 0 | 0 |
| Wheel zoom | 54 | 16.45 ms | 16.8 ms | 16.8 ms | 16.8 ms | 0 | 0 |
| Leave 3D | 47 | 16.86 ms | 16.8 ms | 33.3 ms | 33.3 ms | 1 | 0 |
| Focus ring open | 45 | 18.78 ms | 33.3 ms | 50 ms | 50 ms | 5 | 0 |
| Fullscreen | 36 | 16.46 ms | 16.8 ms | 16.8 ms | 16.8 ms | 0 | 0 |

Idle checks: 0 application animation-frame calls and 0 DOM mutations in a 1 second 2D sample and a 1 second 3D sample. No long tasks were recorded while idle.

Sustained orbit trace: 89 Layout events totaling 25.24 ms, 94 style events totaling 123.56 ms, 266 paint events totaling 78.22 ms, 0 long tasks, maximum task 20.1 ms. CDP performance metrics for the 1.4 second interaction reported 0.0883 s scripting, 0.1307 s style recalculation, 0.0302 s layout, and 0.7999 s total task duration. No forced-reflow console warning appeared.

Fullscreen entered successfully in headless Chromium. The Tiny Player moved into the fullscreen dock and was restored after exit. The 3D fullscreen run at 1280 x 800 kept all 89 nodes fully inside the stage.

### Mobile

| Interaction | Samples | Average | p95 | p99 | Max | Frames over 17.5 ms | Frames over 50 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Orbit, 4x CPU | 248 | 22.02 ms | 33.4 ms | 66.6 ms | 83.4 ms | 74 | 3 |
| Pinch, 4x CPU | 46 | 28.57 ms | 50 ms | 83.3 ms | 83.3 ms | 24 | 2 |

Mobile orbit trace at 4x CPU: 75 Layout events totaling 141.12 ms, 80 style events totaling 583.47 ms, 229 paint events totaling 423.12 ms, 3 long tasks, maximum task 99.56 ms.

The pinch measurement used an intentionally large spread change from 80 px to 276 px, roughly 3.45x camera zoom, and is the worst-case zoom gesture rather than a typical pinch.

Touch targets: mode toggle 44 x 44, zoom control 44 x 44, axis summary 151 x 44, axis option 176 x 44. The mobile axis sheet is fixed, spans 390 px of the 390 px viewport, stays inside the viewport, and produces no horizontal overflow. Escape returns focus to the axis summary.

Landscape: compact cloud chrome increases the stage from 96 px to 180 px tall. All 89 nodes are fully inside the stage in a 667 x 375 viewport, with no horizontal or vertical page overflow. The utility controls switch to a horizontal row so all four remain visible. The cloud is still small because the existing mobile landscape chrome leaves little stage height.

### Fit and accessibility

All 89 nodes were fully inside the stage at 1280 x 900, 390 x 844, 667 x 375, and 1280 x 800 fullscreen. Median node width was 46.1 px on desktop and 27.6 px on mobile portrait.

Reduced motion: the 3D mode was entered with no transition class, and all 89 node transforms were applied immediately.

The three axis endpoint labels are rendered in a separate non-interactive layer above the nodes, so node bubbles cannot cover them. The stage description announces all three dimensions and their endpoints.

## Optimizations applied from measurements

The first trace showed two avoidable costs on the 3D hot path:

1. Each node set an inherited CSS custom property for depth opacity. That invalidated style for the full logo subtree of every node on every frame.
2. Every frame wrote a new `z-index` for every node even when the depth order had not changed.

Changes:

- Replaced the inherited custom property with direct, quantized inline opacity. Opacity now changes in 0.05 steps.
- Quantized depth ordering into buckets, reducing `z-index` writes.
- Added a viewport-fitted default camera distance. The cloud now fits the stage instead of clipping on narrow screens.
- Added a compact mobile landscape layout and a horizontal control row.
- Moved axis labels above the node layer without moving the axis lines.

Measured before and after, same 89 collections and 204 edges:

| Metric | Before | After |
| --- | ---: | ---: |
| Desktop enter 3D | 50.3 fps, p95 33.3 ms | 60.8 fps, p95 16.7 ms |
| Desktop leave 3D | 42.6 fps, p95 50.1 ms | 59.3 fps, p95 16.8 ms |
| Desktop orbit | 59.5 fps, p99 33.3 ms | 60.2 fps, p99 16.8 ms |
| Mobile orbit at 4x CPU | 23.7 fps, p95 133.4 ms | 45.4 fps, p95 33.4 ms |
| Mobile frames over 50 ms | 67 | 3 |
| Mobile long tasks | 69 | 3 |
| Mobile style time | 5988.57 ms | 583.47 ms |
| Mobile task time | 9445.51 ms | 3468.23 ms |
| Mobile maximum task | 217.74 ms | 99.56 ms |
| Mobile nodes fully inside stage | Not guaranteed, clipping observed | 89 of 89 |

The earlier build also rendered individual nodes up to 188 px wide on desktop and clipped nodes at the mobile stage edge. The fitted camera reduced the desktop median node width to 46.1 px and kept every node fully inside at every measured viewport.

## Lifecycle and memory

A warm lifecycle run opened and closed the focus ring once to build the lazy mini-cloud, then performed 8 complete 2D/3D mode cycles, 6 axis changes, and 4 more focus-ring open and close cycles.

| Metric | Warm baseline | After cycles |
| --- | ---: | ---: |
| DOM elements | 7714 | 7697 |
| JS heap after GC | 10,344,764 bytes | 10,617,564 bytes |
| Node buttons | 89 | 89 |
| Edge paths | 204 | 204 |
| Ring open | false | false |
| Player left in dock | 0 | 0 |

DOM count did not grow. Heap grew by 272,800 bytes after forced GC. A single heap snapshot is not proof of a leak, but the repeated mode, axis, and ring cycles did not show detached-node or listener growth in this run.

The initial lifecycle run reported a one-time +88 DOM elements because the first focus-ring open builds the lazy mini-cloud logo layer. After that first build, the warm baseline above shows no further growth.

## Behavioral matrix

Verified locally in the browser:

- All 12 ordered 2D axis pairs from Electronic, Energy, Era, and Mood. Every pair produced a distinct node layout, updated summary, and correct endpoint labels.
- Selecting the dimension already used by the other axis swapped the two. The dedicated Swap X and Y control also worked.
- Axis editor: desktop panel, mobile bottom sheet, Escape, outside dismissal, close button, initial focus, and focus return.
- 2D pan, wheel zoom, pinch zoom, zoom buttons, reset, search, collection and station results, focus ring, focus return, fullscreen, Tiny Player, light and dark themes.
- 3D mode toggle with `aria-pressed`, blocked while the focus ring is open, mode enter and leave interpolation, reduced-motion immediate state.
- 3D orbit by pointer drag, pitch clamp, wheel distance zoom, pinch distance zoom, plus and minus distance controls, and reset.
- Dashed projected edges, neighbor highlighting on hover and focus, collection tooltips, and collection labels hidden in 3D.
- Clicking a collection in 3D, keyboard Enter on a focused collection, and collection search results all exit 3D and open the existing focus ring with zero playback calls.
- A station search result in 3D opens and highlights its ring station with zero playback calls. The same action in 2D still starts playback exactly once.
- Fullscreen 3D at 1280 x 800, Tiny Player docked and restored, 89 of 89 nodes fully inside.
- Mobile portrait and landscape 3D, bottom sheet, touch targets of at least 44 px, no horizontal overflow.
- Light theme stage resolves to `rgb(247, 247, 249)`. Dark theme was captured separately and renders the cloud with all axis labels visible.
- Reduced motion entered 3D without a transition and transformed all nodes immediately.

Final test suite: 351 of 351 tests passed. Vite production build succeeded.

## Limitations

- Headless Chromium is not a physical phone. GPU, compositor, thermal, and battery behavior can differ. The 4x CPU throttle is an emulation, not a device measurement.
- The mobile pinch case reaches 35 fps under 4x CPU with the extreme 3.45x spread used here. Typical orbit reached 45.4 fps.
- The axis transition remains at 51.3 fps on desktop, with 7 of 38 frames at roughly 33 ms and no frame over 50 ms. It animates the existing 2D layout properties for 89 nodes and 204 paths. This predates 3D and was not rewritten during this feature.
- Landscape stage height is limited by the existing mobile app chrome. Compact cloud styling raises it from 96 px to 180 px and all nodes fit, but the cloud remains small in this orientation.
- The trace did not expose `DrawFrame` events in this Chromium capture, so compositor frame timing was assessed from requestAnimationFrame intervals, not from DrawFrame counts.
- Heap evidence covers 8 mode cycles and 10 ring transitions after a warm baseline. It is not a long-soak leak proof.
- The one browser warning in the final run was an unrelated WebAssembly capability probe. No page errors occurred in the final measured run.
