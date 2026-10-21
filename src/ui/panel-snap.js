// Snap-away geometry for floating desktop panels.
//
// Every draggable panel registers its root element. When a drag ends the
// caller passes the final viewport position to snapPanel(). If the panel
// overlaps another registered surface (main player, Stations, Notes, Sync,
// Add, install card), the nearest free side wins and the panel springs
// there with a small overshoot. The geometry is a pure function so it can
// be unit-tested without a DOM.

const surfaces = new Set();
const animations = new WeakMap();

export const SNAP_GAP = 12;
export const SNAP_MARGIN = 12;

const SNAP_DURATION = 280;
const SNAP_OVERSHOOT = 10; // px along the travel vector; ~4-5px past target
const MAX_ITERATIONS = 8;

export function registerSnapSurface(el) {
  if (el) surfaces.add(el);
}

export function unregisterSnapSurface(el) {
  if (!el) return;
  surfaces.delete(el);
  cancelSnap(el);
}

export function cancelSnap(el) {
  const anim = animations.get(el);
  if (!anim) return;
  cancelAnimationFrame(anim.raf);
  animations.delete(el);
  el.classList.remove('is-snapping');
}

/**
 * Move `el` out of every overlapping surface and animate it into place.
 * Returns the final target immediately; the caller can persist it before
 * the spring has finished.
 */
export function snapPanel(el, { x, y, setPosition } = {}) {
  if (!el || typeof setPosition !== 'function') return { x, y };

  const rect = el.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const others = collectOtherRects(el);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const target = resolveSnapPosition({
    x, y, width, height, others, viewport, gap: SNAP_GAP, margin: SNAP_MARGIN,
  });

  const dx = target.x - x;
  const dy = target.y - y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.5) {
    setPosition(target.x, target.y);
    return target;
  }

  cancelSnap(el);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    // Suppress the panel's own left/top transition for this frame so the snap
    // lands instantly instead of gliding for another 300ms.
    el.classList.add('is-snapping');
    setPosition(target.x, target.y);
    requestAnimationFrame(() => el.classList.remove('is-snapping'));
    return target;
  }

  el.classList.add('is-snapping');
  const started = performance.now();
  const anim = { raf: 0 };
  animations.set(el, anim);
  const ux = dx / distance;
  const uy = dy / distance;
  const bump = Math.min(SNAP_OVERSHOOT, Math.max(3, distance * 0.12));
  const minX = SNAP_MARGIN;
  const minY = SNAP_MARGIN;
  const maxX = Math.max(minX, viewport.width - width - SNAP_MARGIN);
  const maxY = Math.max(minY, viewport.height - height - SNAP_MARGIN);

  function frame(now) {
    const t = Math.min(1, (now - started) / SNAP_DURATION);
    const eased = 1 - Math.pow(1 - t, 3);
    const kick = Math.sin(Math.PI * t) * bump;
    const px = x + dx * eased + ux * kick;
    const py = y + dy * eased + uy * kick;
    setPosition(
      Math.min(Math.max(px, minX), maxX),
      Math.min(Math.max(py, minY), maxY),
    );
    if (t < 1) {
      anim.raf = requestAnimationFrame(frame);
      return;
    }
    setPosition(target.x, target.y);
    animations.delete(el);
    el.classList.remove('is-snapping');
  }

  anim.raf = requestAnimationFrame(frame);
  return target;
}

function collectOtherRects(el) {
  const out = [];
  for (const other of surfaces) {
    if (!other || other === el || !other.isConnected) continue;
    if (other.contains(el) || el.contains(other)) continue;
    const rect = visibleRect(other);
    if (rect) out.push(rect);
  }
  return out;
}

function visibleRect(el) {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
    return null;
  }
  if (Number(style.opacity) < 0.05) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

/**
 * Pure resolver: clamps the drop position to the viewport, then repeatedly
 * takes the free side with the least remaining overlap (and shortest travel)
 * until the panel clears every other surface.
 */
export function resolveSnapPosition({
  x,
  y,
  width,
  height,
  others = [],
  viewport,
  gap = SNAP_GAP,
  margin = SNAP_MARGIN,
}) {
  const minX = margin;
  const minY = margin;
  const maxX = Math.max(minX, viewport.width - width - margin);
  const maxY = Math.max(minY, viewport.height - height - margin);
  const clampX = (value) => Math.min(Math.max(value, minX), maxX);
  const clampY = (value) => Math.min(Math.max(value, minY), maxY);

  let pos = { x: clampX(x), y: clampY(y) };

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const rect = rectAt(pos.x, pos.y, width, height);
    const hit = others.find((other) => intersects(rect, other, gap));
    if (!hit) break;

    const candidates = [
      { x: hit.left - gap - width, y: pos.y },
      { x: hit.right + gap, y: pos.y },
      { x: pos.x, y: hit.top - gap - height },
      { x: pos.x, y: hit.bottom + gap },
    ];

    let best = null;
    for (const candidate of candidates) {
      const nx = clampX(candidate.x);
      const ny = clampY(candidate.y);
      const nextRect = rectAt(nx, ny, width, height);
      let overlap = 0;
      for (const other of others) overlap += overlapArea(nextRect, other);
      const distance = Math.hypot(nx - pos.x, ny - pos.y);
      if (
        !best
        || overlap < best.overlap - 0.5
        || (Math.abs(overlap - best.overlap) <= 0.5 && distance < best.distance)
      ) {
        best = { x: nx, y: ny, overlap, distance };
      }
    }

    if (!best || best.distance < 0.5) break;
    pos = { x: best.x, y: best.y };
  }

  return pos;
}

function rectAt(x, y, width, height) {
  return { left: x, top: y, right: x + width, bottom: y + height };
}

// A gap counts as "too close": panels settle exactly `gap` away, and a
// fractional pixel of breathing room is not considered an overlap.
function intersects(rect, other, gap) {
  return rect.right + gap > other.left
    && rect.left < other.right + gap
    && rect.bottom + gap > other.top
    && rect.top < other.bottom + gap;
}

function overlapArea(rect, other) {
  const w = Math.min(rect.right, other.right) - Math.max(rect.left, other.left);
  const h = Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top);
  return w > 0 && h > 0 ? w * h : 0;
}
