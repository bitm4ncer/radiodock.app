// Install section. Two distinct presentations:
//   - Mobile (≤699 px): inline block inside the main column, collapsible
//     via the chevron toggle, takes space in the scroll flow.
//   - Desktop (≥700 px): a floating info badge in the bottom-right corner
//     of the viewport with a × dismiss button. The badge is sticky and
//     stays visible until the user dismisses it (persisted in IndexedDB)
//     or the app is in standalone mode.
// In both regimes, clicking one of the three platform buttons opens the
// matching install-info modal (or the Web Store link).

import * as storage from '../data/storage.js';

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/radiodock/dcjmegapbbplapeghilpbdddhkgndbbh';

function detectPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return 'installed';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/Chrome|Edg|Brave|OPR/i.test(ua) && !/Firefox/i.test(ua)) return 'chrome-ext';
  return 'desktop';
}

// Map detection result → which button to highlight as "you".
function highlightTargetFor(platform) {
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'ios'; // closest match in the 3-button UI
  if (platform === 'chrome-ext') return 'chrome-ext';
  return 'desktop';
}

const CHEVRON_SVG = `<svg class="install-section__chevron" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export async function mountInstallSection({ container, installInfo }) {
  const platform = detectPlatform();
  if (platform === 'installed') {
    // Already a PWA — no reason to nag.
    return { destroy() {} };
  }

  // Respect a previous user-dismissal of the badge.
  if (await storage.getPref('installSectionDismissed', false)) {
    return { destroy() {} };
  }

  const highlight = highlightTargetFor(platform);

  const section = document.createElement('section');
  section.className = 'install-section';
  section.id = 'installSection';
  section.innerHTML = `
    <button type="button" class="install-section__close" data-action="dismiss" aria-label="Dismiss">
      ${CLOSE_SVG}
    </button>
    <button type="button" class="install-section__toggle" aria-expanded="true" aria-controls="installSectionBody">
      <span class="install-section__title">Install RadioDock</span>
      ${CHEVRON_SVG}
    </button>
    <div class="install-section__body" id="installSectionBody">
      <p class="install-section__intro">You can use RadioDock across devices.</p>
      <div class="install-section__row">
        <span class="install-section__label">Install:</span>
        <div class="install-section__buttons" role="group">
          <button type="button" class="install-section__btn${highlight === 'chrome-ext' ? ' is-current' : ''}" data-target="chrome-ext">
            Browser Extension
          </button>
          <button type="button" class="install-section__btn${highlight === 'desktop' ? ' is-current' : ''}" data-target="desktop">
            Desktop
          </button>
          <button type="button" class="install-section__btn${highlight === 'ios' ? ' is-current' : ''}" data-target="ios">
            iOS
          </button>
        </div>
      </div>
    </div>
  `;
  container.append(section);

  const toggleBtn = section.querySelector('.install-section__toggle');
  const closeBtn = section.querySelector('.install-section__close');
  const body = section.querySelector('.install-section__body');

  // Restore collapse state (mobile only — desktop badge ignores this).
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

  function dismiss() {
    section.classList.add('is-dismissed');
    storage.setPref('installSectionDismissed', true).catch(() => {});
    // Remove from DOM after slide-out so it doesn't intercept clicks.
    setTimeout(() => section.remove(), 240);
  }

  toggleBtn.addEventListener('click', () => {
    const next = !section.classList.contains('is-collapsed');
    setCollapsed(next);
  });

  closeBtn.addEventListener('click', dismiss);

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
    if (target === 'ios') {
      installInfo.open('ios-safari');
    }
  });

  return {
    destroy() {
      section.remove();
    },
  };
}
