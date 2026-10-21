// Desktop-footer switch for the panel rubber-snap behaviour.
// The snap geometry itself lives in panel-snap.js; this only renders the
// footer pill and forwards the persisted on/off state.

import { isSnapEnabled, setSnapEnabled } from './panel-snap.js';

// Two window panes that meet in the middle when snapping is on. When it is
// off the panes pull apart and turn into dashed outlines, so the state is
// readable at a glance and not just from the button colour.
const ICON_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="2.75" y="4.5" width="8" height="15" rx="2" fill="currentColor" fill-opacity=".18"/>
  <rect x="13.25" y="4.5" width="8" height="15" rx="2"/>
  <path d="M10.75 12h2.5"/>
</svg>`;

const ICON_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="2" y="4.5" width="6.5" height="15" rx="2" stroke-dasharray="2.2 2.2"/>
  <rect x="15.5" y="4.5" width="6.5" height="15" rx="2" stroke-dasharray="2.2 2.2"/>
  <path d="M12 9.5v5"/>
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
    btn.innerHTML = ICON_ON;
    const anchor = pills.querySelector('.surface-toggle--pill, .theme-toggle--pill, .site-footer-desktop__version');
    pills.insertBefore(btn, anchor);
  }

  function sync() {
    const on = isSnapEnabled();
    btn.setAttribute('aria-pressed', String(on));
    btn.dataset.state = on ? 'on' : 'off';
    btn.innerHTML = on ? ICON_ON : ICON_OFF;
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
