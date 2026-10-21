// Desktop-footer switch for the panel rubber-snap behaviour.
// The snap geometry itself lives in panel-snap.js; this only renders the
// footer pill and forwards the persisted on/off state.

import { isSnapEnabled, setSnapEnabled } from './panel-snap.js';

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 3.75V9H3.75M9 9 3.75 3.75M15 3.75V9h5.25M15 9l5.25-5.25M9 20.25V15H3.75M9 15l-5.25 5.25M15 20.25V15h5.25M15 15l5.25 5.25"/>
</svg>`;

export function mountSnapToggle() {
  const pills = document.querySelector('.site-footer-desktop__pills');
  if (!pills) return null;

  let btn = pills.querySelector('[data-action="snap-toggle"]');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'snap-toggle--pill';
    btn.dataset.action = 'snap-toggle';
    btn.innerHTML = ICON;
    const anchor = pills.querySelector('.surface-toggle--pill, .theme-toggle--pill, .site-footer-desktop__version');
    pills.insertBefore(btn, anchor);
  }

  function sync() {
    const on = isSnapEnabled();
    btn.setAttribute('aria-pressed', String(on));
    const label = on ? 'Turn window snap off' : 'Turn window snap on';
    btn.setAttribute('aria-label', label);
    btn.title = on ? 'Window snap: on' : 'Window snap: off';
  }

  btn.addEventListener('click', () => {
    setSnapEnabled(!isSnapEnabled());
    sync();
  });
  document.addEventListener('snapchange', sync);
  sync();
  return { button: btn };
}
