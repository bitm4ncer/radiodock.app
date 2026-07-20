// Electron-only title bar. The window is frameless (desktop/main.js), so this
// slim bar IS the window chrome: a draggable region plus minimize, always-on-top
// and close. It's prepended to <body> and shown only when body.is-electron, so
// it never depends on the app's mobile/desktop layout regime (the previous
// version lived inside .search-section, which the ≤699px mobile CSS hides — at
// 460px that's always, so the controls were invisible/unclickable).

const MINIMIZE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <path d="M5 12h14"/>
</svg>`;

const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 2v14M5 9l7-7 7 7"/>
  <circle cx="12" cy="19" r="1"/>
</svg>`;

const PIN_FILLED_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 2v14M5 9l7-7 7 7"/>
  <circle cx="12" cy="19" r="1.5"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
  <path d="M6 6l12 12M18 6 6 18"/>
</svg>`;

// Picture-in-picture style: a small pane docked in the corner of a frame.
const TINY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="4" width="18" height="16" rx="2"/>
  <rect x="12.5" y="12" width="6.5" height="5" rx="1" fill="currentColor" stroke="none"/>
</svg>`;

export function mountElectronWindowControls({ electronBridge } = {}) {
  if (document.querySelector('.electron-titlebar')) return;

  const api = typeof window !== 'undefined' ? window.electronAPI : null;
  // Capability-gate the tiny-player toggle: it needs the native resize/dock
  // method. On an older installed app that lacks it, we hide the button
  // entirely rather than let it collapse the UI in a window that won't shrink.
  const hasTiny = typeof api?.setTinyPlayer === 'function';

  const bar = document.createElement('div');
  bar.className = 'electron-titlebar';
  bar.innerHTML = `
    <div class="electron-titlebar__controls">
      <button type="button" class="electron-win-btn" data-win="min" title="Minimize" aria-label="Minimize">${MINIMIZE_SVG}</button>
      <button type="button" class="electron-win-btn" data-win="pin" title="Always on top" aria-label="Always on top">${PIN_SVG}</button>
      ${hasTiny ? `<button type="button" class="electron-win-btn" data-win="tiny" title="Tiny player" aria-label="Tiny player">${TINY_SVG}</button>` : ''}
      <button type="button" class="electron-win-btn electron-win-btn--close" data-win="close" title="Close" aria-label="Close">${CLOSE_SVG}</button>
    </div>
  `;
  document.body.prepend(bar);

  const pinBtn = bar.querySelector('[data-win="pin"]');
  let onTop = false;

  const paintPin = () => {
    pinBtn.classList.toggle('is-active', onTop);
    pinBtn.title = onTop ? 'Always on top (on)' : 'Always on top';
    pinBtn.innerHTML = onTop ? PIN_FILLED_SVG : PIN_SVG;
  };

  bar.querySelector('[data-win="min"]').addEventListener('click', () => api?.minimize?.());
  bar.querySelector('[data-win="close"]').addEventListener('click', () => api?.close?.());
  pinBtn.addEventListener('click', async () => {
    onTop = !onTop;
    paintPin();
    if (electronBridge?.setAlwaysOnTop) await electronBridge.setAlwaysOnTop(onTop);
    else await api?.setAlwaysOnTop?.(onTop);
  });

  // Tiny-player mode: collapse to just the player pill (title bar hidden),
  // docked bottom-right + always-on-top by the main process. Entered from this
  // title-bar button; exited via the in-pill maximize button or the right-click
  // context menu (both routed through the shared applyTiny below).
  const tinyBtn = bar.querySelector('[data-win="tiny"]');
  if (tinyBtn) {
    // The pill reuses the full player action bar (prev · info · favourite ·
    // record · note · next) plus the exit button, in place of a bespoke control
    // row. The bar lives as a sibling of the card in full mode, so move it into
    // the pill's text column on enter and back to its exact home on exit. Homes
    // are captured lazily on first use, after any async-injected buttons exist.
    const actionBar = document.getElementById('playerActionBar');
    const exitBtn = document.getElementById('tinyMaxBtn');
    const details = document.querySelector('.station-details');
    const pill = document.getElementById('playerCard');
    let abHome = null, exitHome = null;

    const relocatePill = (on) => {
      if (!actionBar || !details) return;
      if (on) {
        abHome = { parent: actionBar.parentNode, next: actionBar.nextSibling };
        details.appendChild(actionBar);
        // The exit button lives in the pill's top-right corner (CSS-positioned),
        // NOT in the action bar — the bar is already full with the six controls
        // plus the injected record/detect/note buttons.
        if (exitBtn && pill) {
          exitHome = { parent: exitBtn.parentNode, next: exitBtn.nextSibling };
          pill.appendChild(exitBtn);
        }
      } else {
        if (exitBtn && exitHome?.parent) exitHome.parent.insertBefore(exitBtn, exitHome.next);
        if (abHome?.parent) abHome.parent.insertBefore(actionBar, abHome.next);
      }
    };

    const applyTiny = async (on) => {
      if (document.body.classList.contains('is-tiny-player') === on) return;
      // Collapsing to the pill makes it the sole surface. Any open full-page
      // surface (Notes / Sync / About / Log / Search) must close first, or it
      // stays mounted and bleeds out around the small pill. Rides main.js's
      // page-exclusivity engine: announcing the pill as the active surface
      // closes every real page (no page id matches, so they all close).
      if (on) window.dispatchEvent(new CustomEvent('rd:page-open', { detail: { id: 'tinyPlayer' } }));
      relocatePill(on);
      document.body.classList.toggle('is-tiny-player', on);
      tinyBtn.classList.toggle('is-active', on);
      try { await api.setTinyPlayer(on); }
      catch (err) { console.warn('Tiny player toggle failed:', err); }
    };
    tinyBtn.addEventListener('click', () => applyTiny(!document.body.classList.contains('is-tiny-player')));
    window.addEventListener('rd:set-tiny', (e) => applyTiny(!!e.detail?.on));
    api?.onTinyExit?.(() => applyTiny(false));
  }

  // Restore persisted always-on-top state.
  const getState = electronBridge?.getAlwaysOnTop
    ? electronBridge.getAlwaysOnTop()
    : api?.getAlwaysOnTop?.();
  Promise.resolve(getState)
    .then((v) => { onTop = !!v; paintPin(); })
    .catch(() => {});
}
