// Snap-away geometry for floating desktop panels.
//
// Every draggable panel registers its root element, optionally with an
// adapter that can move and persist it. When a drag ends the caller passes
// the final viewport position to snapPanel(). If the panel was dropped
// between two vertically overlapping panels, the neighbours part like a
// squeezed rubber band: they slide outward and spring back with a small
// overshoot. Otherwise the old rule applies and the dragged panel escapes to
// the nearest free side. The geometry is pure so it can be unit-tested
// without a DOM.

const surfaces = new Map();
const animations = new WeakMap();

export const SNAP_GAP = 12;
export const SNAP_MARGIN = 12;

const SNAP_DURATION = 280;
const SNAP_OVERSHOOT = 10; // px along the travel vector; ~4-5px past target
const MAX_ITERATIONS = 8;

const SNAP_PREF_KEY = 'radiodock-snap';

function readSnapEnabled() {
  try {
    return globalThis.localStorage?.getItem(SNAP_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

let snapEnabled = readSnapEnabled();

export function isSnapEnabled() {
  return snapEnabled;
}

export function setSnapEnabled(enabled) {
  const next = enabled !== false;
  if (next === snapEnabled) return;
  snapEnabled = next;
  try {
    globalThis.localStorage?.setItem(SNAP_PREF_KEY, next ? 'on' : 'off');
  } catch {}
  if (!next) {
    for (const el of surfaces.keys()) cancelSnap(el);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('snap-disabled', !next);
    document.dispatchEvent(new CustomEvent('snapchange', { detail: { enabled: next } }));
  }
}

export function registerSnapSurface(el, adapter = null) {
  if (el) surfaces.set(el, adapter || null);
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
 * Move `el` into place and animate it. If it was dropped between two panels,
 * those panels are pushed aside first. Returns the final target immediately;
 * the caller can persist it before the spring has finished.
 */
export function snapPanel(el, { x, y, setPosition } = {}) {
  if (!el || typeof setPosition !== 'function') return { x, y };
  if (!snapEnabled) return { x, y };

  const rect = el.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const entries = collectOtherRects(el);
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  const insertion = resolvePanelInsertion({
    x,
    y,
    width,
    height,
    others: entries.map((entry) => ({
      id: entry.el,
      left: entry.rect.left,
      top: entry.rect.top,
      right: entry.rect.right,
      bottom: entry.rect.bottom,
      movable: !!(entry.adapter && typeof entry.adapter.setPosition === 'function'),
    })),
    viewport,
    gap: SNAP_GAP,
    margin: SNAP_MARGIN,
  });

  if (insertion.inserted) {
    const byId = new Map(entries.map((entry) => [entry.el, entry]));
    for (const move of insertion.moves) {
      const entry = byId.get(move.id);
      if (!entry?.adapter?.setPosition) continue;
      // Each neighbour gets a tiny outward kick, like the panel is settling
      // into a too-small gap.
      const distance = Math.hypot(move.x - entry.rect.left, move.y - entry.rect.top);
      const bump = Math.min(8, Math.max(2, distance * 0.1));
      animateElement(entry.el, entry.rect.left, entry.rect.top, move.x, move.y, entry.adapter.setPosition, bump);
      try {
        entry.adapter.persist?.(move.x, move.y);
      } catch {}
    }
    animateElement(el, x, y, insertion.x, insertion.y, setPosition, SNAP_OVERSHOOT);
    return { x: insertion.x, y: insertion.y };
  }

  const target = resolveSnapPosition({
    x,
    y,
    width,
    height,
    others: entries.map((entry) => entry.rect),
    viewport,
    gap: SNAP_GAP,
    margin: SNAP_MARGIN,
  });
  animateElement(el, x, y, target.x, target.y, setPosition, SNAP_OVERSHOOT);
  return target;
}

function animateElement(el, fromX, fromY, toX, toY, setPosition, bump) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  // Already in place. Do not call setPosition here: opening a panel that is
  // docked by CSS must stay docked when it does not overlap anything.
  if (distance < 0.5) return;

  cancelSnap(el);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    // Suppress the panel's own left/top transition for this frame so the snap
    // lands instantly instead of gliding for another 300ms.
    el.classList.add('is-snapping');
    setPosition(toX, toY);
    requestAnimationFrame(() => el.classList.remove('is-snapping'));
    return;
  }

  const rect = el.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const minX = SNAP_MARGIN;
  const minY = SNAP_MARGIN;
  const maxX = Math.max(minX, viewport.width - width - SNAP_MARGIN);
  const maxY = Math.max(minY, viewport.height - height - SNAP_MARGIN);

  el.classList.add('is-snapping');
  const started = performance.now();
  const anim = { raf: 0 };
  animations.set(el, anim);
  const ux = dx / distance;
  const uy = dy / distance;
  const kickSize = Math.min(SNAP_OVERSHOOT, Math.max(3, bump ?? distance * 0.12));

  function frame(now) {
    const t = Math.min(1, (now - started) / SNAP_DURATION);
    const eased = 1 - Math.pow(1 - t, 3);
    const kick = Math.sin(Math.PI * t) * kickSize;
    const px = fromX + dx * eased + ux * kick;
    const py = fromY + dy * eased + uy * kick;
    setPosition(
      Math.min(Math.max(px, minX), maxX),
      Math.min(Math.max(py, minY), maxY),
    );
    if (t < 1) {
      anim.raf = requestAnimationFrame(frame);
      return;
    }
    setPosition(toX, toY);
    animations.delete(el);
    el.classList.remove('is-snapping');
  }

  anim.raf = requestAnimationFrame(frame);
}

function collectOtherRects(el) {
  const out = [];
  for (const [other, adapter] of surfaces) {
    if (!other || other === el || !other.isConnected) continue;
    if (other.contains(el) || el.contains(other)) continue;
    const rect = visibleRect(other);
    if (rect) out.push({ el: other, rect, adapter });
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
 * Pure insertion resolver. If the drop sits between two movable panels that
 * overlap it vertically, push those panels outward (never inward) until the
 * dragged panel fits with the standard gap. When the neighbours run out of
 * room the dragged panel may shift into the remaining slot; if that still
 * does not fit, return inserted:false so the normal snap-away logic runs.
 */
export function resolvePanelInsertion({
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

  const dropX = clampX(x);
  const dropY = clampY(y);
  const drag = rectAt(dropX, dropY, width, height);
  const centerX = dropX + width / 2;
  const minOverlap = Math.max(40, Math.min(120, height * 0.35));
  const overlapsVertically = (other) => (
    Math.min(drag.bottom, other.bottom) - Math.max(drag.top, other.top) >= minOverlap
  );

  // Classify by the neighbour's centre instead of its inner edge: a wide
  // panel can overlap past the dragged panel's centre and still sit on its
  // right-hand side.
  const left = others
    .filter((other) => other.movable && overlapsVertically(other) && (other.left + other.right) / 2 <= centerX)
    .sort((a, b) => b.right - a.right)[0];
  const right = others
    .filter((other) => (
      other.movable
      && overlapsVertically(other)
      && (other.left + other.right) / 2 >= centerX
      && other.id !== left?.id
    ))
    .sort((a, b) => a.left - b.left)[0];

  if (!left || !right) return { inserted: false };
  // Already clear of both neighbours: leave the drop alone.
  if (dropX >= left.right + gap && dropX + width <= right.left - gap) {
    return { inserted: false };
  }

  const leftX = clampX(Math.min(left.left, dropX - gap - (left.right - left.left)));
  const rightX = clampX(Math.max(right.left, dropX + width + gap));
  const leftInner = leftX + (left.right - left.left);
  const rightInner = rightX;
  const minDropX = leftInner + gap;
  const maxDropX = rightInner - gap - width;
  if (minDropX > maxDropX + 0.5) return { inserted: false };

  // If the drop itself no longer fits (the neighbours ran into the viewport
  // edges), settle in the middle of the remaining slot instead of hugging one
  // neighbour.
  const nextX = dropX < minDropX - 0.5 || dropX > maxDropX + 0.5
    ? (minDropX + maxDropX) / 2
    : dropX;
  const nextY = dropY;
  const moves = [];
  if (Math.abs(leftX - left.left) > 0.5) moves.push({ id: left.id, x: leftX, y: left.top });
  if (Math.abs(rightX - right.left) > 0.5) moves.push({ id: right.id, x: rightX, y: right.top });

  const moveIds = new Set(moves.map((move) => move.id));
  for (const move of moves) {
    const source = move.id === left.id ? left : right;
    const target = rectAt(move.x, move.y, source.right - source.left, source.bottom - source.top);
    for (const other of others) {
      if (other.id === move.id || moveIds.has(other.id)) continue;
      if (other.id === left.id || other.id === right.id) continue;
      if (overlapArea(target, other) > 1) return { inserted: false };
    }
  }

  const dragTarget = rectAt(nextX, nextY, width, height);
  for (const other of others) {
    if (other.id === left.id || other.id === right.id) continue;
    if (overlapArea(dragTarget, other) > 1) return { inserted: false };
  }

  return { inserted: true, x: nextX, y: nextY, moves };
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
