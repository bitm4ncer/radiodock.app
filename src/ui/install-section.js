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

function detectPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return 'installed';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  // Chromium family: Chrome, Edge, Brave, Opera, Vivaldi. All support both
  // the Web Store extension AND PWA install.
  if (/Chrome|Edg|Brave|OPR|Vivaldi/i.test(ua) && !/Firefox/i.test(ua)) return 'chromium-desktop';
  return 'desktop';
}

// Which buttons to highlight as the user's relevant install path(s). Returns
// an array so multiple buttons can be highlighted at once (Chromium desktop
// users have both the extension AND PWA-install paths available, so both
// get highlighted).
function highlightTargetsFor(platform) {
  if (platform === 'ios' || platform === 'android') return ['ios'];
  if (platform === 'chromium-desktop') return ['chrome-ext', 'desktop'];
  return ['desktop'];
}

const CHEVRON_SVG = `<svg class="install-section__chevron" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

export async function mountInstallSection({ container, installInfo, animateIn = false }) {
  const platform = detectPlatform();
  if (platform === 'installed') {
    // Already a PWA — no reason to nag.
    return { destroy() {} };
  }

  // Respect a previous user-dismissal of the badge — UNLESS the caller asked
  // for an explicit re-summon (e.g. the footer "Install on Devices" button).
  if (!animateIn && (await storage.getPref('installSectionDismissed', false))) {
    return { destroy() {} };
  }

  // A re-summon clears the dismissal pref so closing tab + reopening still
  // shows the badge.
  if (animateIn) {
    await storage.setPref('installSectionDismissed', false).catch(() => {});
  }

  // If a previous instance is still in the DOM (e.g. mid-dismiss-fade-out),
  // remove it immediately so we don't end up with two badges stacked.
  document.getElementById('installSection')?.remove();

  const highlights = highlightTargetsFor(platform);
  const isCurrent = (target) => (highlights.includes(target) ? ' is-current' : '');

  const section = document.createElement('section');
  section.className = 'install-section';
  if (animateIn) section.classList.add('is-entering');
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
          <button type="button" class="install-section__btn${isCurrent('chrome-ext')}" data-target="chrome-ext">
            Browser Extension
          </button>
          <button type="button" class="install-section__btn${isCurrent('desktop')}" data-target="desktop">
            Desktop
          </button>
          <button type="button" class="install-section__btn${isCurrent('ios')}" data-target="ios">
            iOS
          </button>
        </div>
      </div>
    </div>
  `;
  container.append(section);

  // Commit the .is-entering initial layout, then flip the class off so the
  // CSS transition runs. We use setTimeout(20) rather than requestAnimationFrame
  // because hidden tabs pause RAF callbacks but still fire timeouts — the user
  // might Cmd-click the button while looking elsewhere.
  if (animateIn) {
    // Force a style read so the initial transform/opacity is committed.
    void section.offsetHeight;
    setTimeout(() => section.classList.remove('is-entering'), 20);
  }

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
    // All three buttons open the install-info popover so the user gets a
    // short explanation + the right action button rather than being yanked
    // straight to an external page.
    if (target === 'chrome-ext') return installInfo.open('browser-ext');
    if (target === 'desktop') return installInfo.open('desktop');
    if (target === 'ios') return installInfo.open('ios-safari');
  });

  return {
    destroy() {
      section.remove();
    },
  };
}
