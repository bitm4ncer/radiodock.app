// Standalone-mode menu. Only mounted when the app is running as an
// installed PWA on a desktop-class viewport (mobile already gets the
// off-canvas drawer via the .mobile-topbar hamburger). Hides the
// website-style footer and surfaces the same nav items inside a
// compact popover anchored to a tool-btn next to drag/minimize.

import { mountThemeToggle } from './theme.js';

const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="5" cy="12" r="1.2" fill="currentColor"/>
  <circle cx="12" cy="12" r="1.2" fill="currentColor"/>
  <circle cx="19" cy="12" r="1.2" fill="currentColor"/>
</svg>`;

export function mountStandaloneMenu({ onAboutClick } = {}) {
  if (matchMedia('(pointer: coarse)').matches) return null; // desktop-only
  if (!document.documentElement.classList.contains('is-standalone')) return null;

  const container = document.getElementById('app');
  if (!container) return null;
  container.classList.add('has-tools');

  // --- Button ---
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tool-btn standalone-menu-btn';
  btn.title = 'Menu';
  btn.dataset.label = 'Menu';
  btn.setAttribute('aria-label', 'Open menu');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `
    <span class="tool-btn__pill" aria-hidden="true">Menu</span>
    <span class="tool-btn__icon">${MENU_ICON}</span>
  `;
  container.appendChild(btn);

  // --- Popover ---
  const pop = document.createElement('div');
  pop.className = 'standalone-menu-popover';
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-hidden', 'true');
  pop.innerHTML = `
    <button type="button" class="standalone-menu__item" data-action="about" role="menuitem">About</button>
    <a class="standalone-menu__item" href="https://github.com/bitm4ncer/radiodock.app" target="_blank" rel="noopener" role="menuitem">GitHub</a>
    <a class="standalone-menu__item" href="https://github.com/bitm4ncer/radiodock.app/issues" target="_blank" rel="noopener" role="menuitem">Issues</a>
    <a class="standalone-menu__item" href="https://buymeacoffee.com/bitmancer" target="_blank" rel="noopener" role="menuitem">Buy me a coffee</a>
    <a class="standalone-menu__item" href="/legal.html" target="_blank" rel="noopener" role="menuitem">Legal Notice</a>
    <div class="standalone-menu__sep" aria-hidden="true"></div>
    <button type="button" class="standalone-menu__theme theme-toggle--row" data-action="theme-toggle" aria-pressed="false" aria-label="Switch theme">
      <svg class="theme-toggle__icon theme-toggle__icon--moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="currentColor"/>
      </svg>
      <svg class="theme-toggle__icon theme-toggle__icon--sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor"/>
        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="theme-toggle--row__label">
        <span class="theme-toggle__label theme-toggle__label--dark">Dark</span>
        <span class="theme-toggle__label theme-toggle__label--light">Light</span>
      </span>
      <span class="theme-toggle__switch" aria-hidden="true">
        <span class="theme-toggle__track"></span>
      </span>
    </button>
  `;
  container.appendChild(pop);

  mountThemeToggle({ root: pop });

  // --- Open/close ---
  function open() {
    pop.classList.add('is-open');
    pop.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
    document.addEventListener('keydown', onKeydown, true);
  }
  function close() {
    pop.classList.remove('is-open');
    pop.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeydown, true);
  }
  function toggle() {
    if (pop.classList.contains('is-open')) close();
    else open();
  }

  function onDocClick(evt) {
    if (pop.contains(evt.target) || btn.contains(evt.target)) return;
    close();
  }
  function onKeydown(evt) {
    if (evt.key === 'Escape') close();
  }

  btn.addEventListener('click', toggle);

  // Wire interactive items.
  pop.addEventListener('click', (evt) => {
    const item = evt.target.closest('.standalone-menu__item, .standalone-menu__theme');
    if (!item) return;
    const action = item.dataset.action;
    if (action === 'about') {
      onAboutClick?.();
      close();
    } else if (action === 'theme-toggle') {
      // theme toggle handles itself via mountThemeToggle — don't close so the
      // user can see the icon/label swap.
      return;
    } else {
      // Plain link — let it navigate, then close.
      close();
    }
  });

  return { open, close, toggle, btn, pop };
}
