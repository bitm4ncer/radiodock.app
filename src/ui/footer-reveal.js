// Mouse-proximity auto-reveal for the desktop footer.
//
// The footer is fixed at the bottom of the viewport and translated off-
// screen by default. When the cursor moves within REVEAL_AT pixels of the
// bottom edge, it slides up; when the cursor pulls back past HIDE_AT, it
// slides down. Hysteresis (40 px) prevents flicker around the boundary.
//
// Also reveals on mouseleave with intent toward the bottom — but really
// the simplest robust signal is just "cursor low" + "footer hover".

const REVEAL_AT = 60;     // px from viewport bottom to trigger reveal
const HIDE_AT = 100;      // px from viewport bottom below which we hide

export function mountFooterReveal() {
  // Skip on touch / coarse-pointer devices: footer is hidden anyway on
  // mobile (app-mobile.css) and `mousemove` rarely fires on touch.
  if (matchMedia('(pointer: coarse)').matches) return;

  const footer = document.querySelector('.site-footer-desktop');
  if (!footer) return;

  let revealed = false;
  let rafId = 0;
  let lastY = Infinity;

  function setRevealed(next) {
    if (next === revealed) return;
    revealed = next;
    footer.classList.toggle('is-revealed', next);
    // Mirror on body so other modules (background.js, etc.) can hook into
    // the same proximity signal via CSS alone, without re-running their
    // own mousemove listeners.
    document.body.classList.toggle('footer-revealed', next);
  }

  function evaluate() {
    rafId = 0;
    const fromBottom = window.innerHeight - lastY;
    if (!revealed && fromBottom < REVEAL_AT) {
      setRevealed(true);
    } else if (revealed && fromBottom > HIDE_AT) {
      setRevealed(false);
    }
  }

  function onMove(evt) {
    lastY = evt.clientY;
    if (rafId) return;
    rafId = requestAnimationFrame(evaluate);
  }

  function onLeave() {
    // Cursor has left the document entirely — hide so the footer doesn't
    // stay revealed during an alt-tab away.
    setRevealed(false);
  }

  // The footer itself shouldn't toggle off when the cursor enters it
  // (mousemove keeps lastY low → still revealed). Just keep it sticky:
  // mouseenter on the footer pins it open until cursor leaves the area.
  footer.addEventListener('mouseenter', () => setRevealed(true));

  document.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave);
}
