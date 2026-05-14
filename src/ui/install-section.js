// Collapsible install section. Three buttons (Chrome Extension / Desktop
// App / Mobile). The button matching the user's current platform is
// highlighted. Section is open by default; collapse state persists in
// IndexedDB. Entire section is hidden when the app is in standalone mode.

import * as storage from '../data/storage.js';

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/radiodock/dcjmegapbbplapeghilpbdddhkgndbbh';

function detectPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return 'installed';
  if (/iphone|ipad|ipod|android/i.test(ua)) return 'mobile';
  if (/Chrome|Edg|Brave|OPR/i.test(ua) && !/Firefox/i.test(ua)) return 'chrome-ext';
  return 'desktop';
}

const CHEVRON_SVG = `<svg class="install-section__chevron" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

export async function mountInstallSection({ container, installInfo }) {
  const platform = detectPlatform();
  if (platform === 'installed') {
    // Already a PWA, no need to install again.
    return { destroy() {} };
  }

  const section = document.createElement('section');
  section.className = 'install-section';
  section.id = 'installSection';
  section.innerHTML = `
    <button type="button" class="install-section__toggle" aria-expanded="true" aria-controls="installSectionBody">
      <span class="install-section__title">Install RadioDock</span>
      ${CHEVRON_SVG}
    </button>
    <div class="install-section__body" id="installSectionBody">
      <p class="install-section__intro">You can use RadioDock across devices.</p>
      <div class="install-section__buttons" role="group">
        <button type="button" class="install-section__btn${platform === 'chrome-ext' ? ' is-current' : ''}" data-target="chrome-ext">
          Chrome Extension
        </button>
        <button type="button" class="install-section__btn${platform === 'desktop' ? ' is-current' : ''}" data-target="desktop">
          Desktop App
        </button>
        <button type="button" class="install-section__btn${platform === 'mobile' ? ' is-current' : ''}" data-target="mobile">
          Mobile
        </button>
      </div>
    </div>
  `;
  container.append(section);

  const toggleBtn = section.querySelector('.install-section__toggle');
  const body = section.querySelector('.install-section__body');

  // Restore collapse state.
  const collapsed = await storage.getPref('installSectionCollapsed', false);
  if (collapsed) setCollapsed(true, { skipAnimate: true });

  function setCollapsed(value, { skipAnimate = false } = {}) {
    section.classList.toggle('is-collapsed', value);
    toggleBtn.setAttribute('aria-expanded', String(!value));
    if (skipAnimate) body.style.transition = 'none';
    body.style.display = value ? 'none' : '';
    if (skipAnimate) {
      requestAnimationFrame(() => {
        body.style.transition = '';
      });
    }
    storage.setPref('installSectionCollapsed', value).catch(() => {});
  }

  toggleBtn.addEventListener('click', () => {
    const next = !section.classList.contains('is-collapsed');
    setCollapsed(next);
  });

  section.querySelector('.install-section__buttons').addEventListener('click', (evt) => {
    const btn = evt.target.closest('[data-target]');
    if (!btn) return;
    const target = btn.dataset.target;
    if (target === 'chrome-ext') {
      window.open(CHROME_STORE_URL, '_blank', 'noopener');
      return;
    }
    if (target === 'desktop') {
      installInfo.open('desktop');
      return;
    }
    if (target === 'mobile') {
      // Pick the right mobile sub-branch based on UA. Default to ios-safari
      // if we can't tell, since iOS is the platform where instructions are
      // strictly required (Android offers an automatic install prompt).
      const ua = navigator.userAgent;
      const branch = /android/i.test(ua) ? 'android' : 'ios-safari';
      installInfo.open(branch);
    }
  });

  return {
    destroy() {
      section.remove();
    },
  };
}
