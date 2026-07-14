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

export function mountElectronWindowControls({ electronBridge } = {}) {
  if (document.querySelector('.electron-titlebar')) return;

  const api = typeof window !== 'undefined' ? window.electronAPI : null;

  const bar = document.createElement('div');
  bar.className = 'electron-titlebar';
  bar.innerHTML = `
    <span class="electron-titlebar__brand">RadioDock</span>
    <div class="electron-titlebar__controls">
      <button type="button" class="electron-win-btn" data-win="min" title="Minimize" aria-label="Minimize">${MINIMIZE_SVG}</button>
      <button type="button" class="electron-win-btn" data-win="pin" title="Always on top" aria-label="Always on top">${PIN_SVG}</button>
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

  // Restore persisted always-on-top state.
  const getState = electronBridge?.getAlwaysOnTop
    ? electronBridge.getAlwaysOnTop()
    : api?.getAlwaysOnTop?.();
  Promise.resolve(getState)
    .then((v) => { onTop = !!v; paintPin(); })
    .catch(() => {});
}
