// Geometry for resizing a floating panel from its bottom-right corner.
// Pure so it can be unit-tested without a DOM.

export const PANEL_RESIZE_MIN_WIDTH = 480;
export const PANEL_RESIZE_MIN_HEIGHT = 480;
export const PANEL_RESIZE_MAX_WIDTH = 960;
// Keep the same breathing room the floating panels use at the viewport edge.
export const PANEL_RESIZE_MARGIN = 24;

/**
 * Resolve a panel size from a bottom-right drag. The top-left corner stays
 * fixed, so the maximum size depends on how much room is left to the right
 * and below that corner. When the viewport is smaller than the preferred
 * minimum, the available space wins instead of pushing the panel off-screen.
 */
export function resolvePanelSize({
  startWidth,
  startHeight,
  deltaX = 0,
  deltaY = 0,
  left = 0,
  top = 0,
  viewportWidth,
  viewportHeight,
  minWidth = PANEL_RESIZE_MIN_WIDTH,
  minHeight = PANEL_RESIZE_MIN_HEIGHT,
  maxWidth = PANEL_RESIZE_MAX_WIDTH,
  margin = PANEL_RESIZE_MARGIN,
}) {
  const availableWidth = Math.max(1, viewportWidth - Math.max(0, left) - margin);
  const availableHeight = Math.max(1, viewportHeight - Math.max(0, top) - margin);
  const hardMaxWidth = Math.max(1, Math.min(maxWidth, availableWidth));
  const hardMaxHeight = Math.max(1, availableHeight);
  const effectiveMinWidth = Math.min(minWidth, hardMaxWidth);
  const effectiveMinHeight = Math.min(minHeight, hardMaxHeight);

  return {
    width: clamp(Math.round(startWidth + deltaX), effectiveMinWidth, hardMaxWidth),
    height: clamp(Math.round(startHeight + deltaY), effectiveMinHeight, hardMaxHeight),
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
