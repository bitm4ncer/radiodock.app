// Publishes the app chrome's insets as --app-page-top / --app-page-bottom so the
// full-page surfaces (About, Notes, Sync, Log) navigate BETWEEN the top bar and
// the player bar instead of covering them.
//
// Measured, not hard-coded: the header's height moves with the iOS safe-area and
// with the Electron title bar stacked above it, and the player bar grows with
// its content (station name wrapping, volume row). getBoundingClientRect() is
// viewport-relative, so both are folded in for free.

export function mountAppPageBounds() {
  const root = document.documentElement;
  const topbar = document.querySelector('.mobile-topbar');
  const player = document.querySelector('.player-section');
  if (!topbar || !player) return null;

  let raf = 0;

  function measure() {
    raf = 0;
    const tb = topbar.getBoundingClientRect();
    const pb = player.getBoundingClientRect();
    // A display:none element reports an all-zero rect (desktop regime hides the
    // top bar). Fall back to 0 there so a page fills the window rather than
    // collapsing to nothing.
    const top = tb.height > 0 ? Math.max(0, Math.round(tb.bottom)) : 0;
    const bottom = pb.height > 0 ? Math.max(0, Math.round(window.innerHeight - pb.top)) : 0;
    root.style.setProperty('--app-page-top', `${top}px`);
    root.style.setProperty('--app-page-bottom', `${bottom}px`);
  }

  const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };

  measure();

  const ro = new ResizeObserver(schedule);
  ro.observe(topbar);
  ro.observe(player);
  window.addEventListener('resize', schedule);
  // iOS: the keyboard resizes the visual viewport without firing window resize.
  window.visualViewport?.addEventListener('resize', schedule);

  return { remeasure: schedule };
}
