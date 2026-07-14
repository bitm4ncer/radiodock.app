// Electron-only window control buttons: Minimize + Always-on-Top.
// Mounted next to the search input, only visible when running in Electron.

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

export function mountElectronWindowControls({ electronBridge, player }) {
  const searchContainer = document.querySelector('.search-input-container');
  if (!searchContainer) return;

  // --- Container for the two buttons ---
  const group = document.createElement('div');
  group.className = 'electron-window-controls';

  // --- Minimize button ---
  const minBtn = document.createElement('button');
  minBtn.type = 'button';
  minBtn.className = 'electron-win-btn';
  minBtn.title = 'Minimize to tray';
  minBtn.setAttribute('aria-label', 'Minimize');
  minBtn.innerHTML = MINIMIZE_SVG;
  minBtn.addEventListener('click', () => {
    electronBridge?.cleanup; // no-op safety
    if (window.electronAPI) window.electronAPI.minimize();
  });

  // --- Always-on-Top toggle ---
  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'electron-win-btn';
  pinBtn.title = 'Always on top';
  pinBtn.setAttribute('aria-label', 'Always on top');
  pinBtn.innerHTML = PIN_SVG;

  let onTop = false;
  pinBtn.addEventListener('click', async () => {
    onTop = !onTop;
    pinBtn.classList.toggle('is-active', onTop);
    pinBtn.title = onTop ? 'Always on top (on)' : 'Always on top';
    pinBtn.innerHTML = onTop ? PIN_FILLED_SVG : PIN_SVG;
    if (electronBridge) await electronBridge.setAlwaysOnTop(onTop);
  });

  // Restore initial state
  if (electronBridge) {
    electronBridge.getAlwaysOnTop().then((v) => {
      onTop = v;
      pinBtn.classList.toggle('is-active', onTop);
      pinBtn.title = onTop ? 'Always on top (on)' : 'Always on top';
      pinBtn.innerHTML = onTop ? PIN_FILLED_SVG : PIN_SVG;
    }).catch(() => {});
  }

  group.append(minBtn, pinBtn);
  searchContainer.append(group);
}
