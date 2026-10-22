// Geometry for the onboarding bubbles. Kept pure so the edge cases can be
// tested without a DOM.

const GAP = 12;
const EDGE = 12;

export function computeTipPosition({ target, tipWidth, tipHeight, viewportWidth, viewportHeight, preferBelow = false }) {
  const centerX = target.left + target.width / 2;
  const fitsAbove = !preferBelow && target.top >= tipHeight + GAP + EDGE;
  const rawTop = fitsAbove ? target.top - tipHeight - GAP : target.bottom + GAP;
  const top = Math.max(EDGE, Math.min(viewportHeight - tipHeight - EDGE, rawTop));
  const left = Math.max(EDGE, Math.min(viewportWidth - tipWidth - EDGE, centerX - tipWidth / 2));
  const arrowX = Math.max(12, Math.min(tipWidth - 20, centerX - left - 5));
  return { top, left, arrowX, below: !fitsAbove };
}
