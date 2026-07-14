// Install section. Two distinct presentations:
//   - Mobile (≤699 px): inline block inside the main column, collapsible
//     via the chevron toggle, takes space in the scroll flow.
//   - Desktop (≥700 px): a floating info badge in the bottom-right corner
//     of the viewport with a × dismiss button. The badge is sticky and
//     stays visible until the user dismisses it (persisted in IndexedDB)
//     or the app is in standalone mode.
// In both regimes, clicking one of the platform buttons opens the
// matching install-info modal (or the Web Store link).

import * as storage from '../data/storage.js';
import { detectPlatform } from '../platform.js';

// Which buttons to highlight as the user's relevant install path(s). Returns
// an array so multiple buttons can be highlighted at once (Chromium desktop
// users have both the extension AND PWA-install paths available, so both
// get highlighted).
function highlightTargetsFor(platform) {
  if (platform.startsWith('ios')) return ['ios'];
  if (platform === 'android') return ['android'];
  if (platform === 'chromium-desktop') return ['chrome-ext', 'browser-app'];
  return ['browser-app'];
}

// Which buttons to actually show on this platform. Mobile users have no use
// for the browser-extension or desktop-PWA paths — they can't act on either
// from their phone — so we hide them to keep the section focused on what's
// installable here. Desktop users see everything (extension + PWA + a
// "how to install on your phone" link for cross-device discovery).
function visibleTargetsFor(platform) {
  if (platform.startsWith('ios')) return ['ios'];
  if (platform === 'android') return ['android'];
  return ['chrome-ext', 'browser-app', 'android', 'ios'];
}

const CHEVRON_SVG = `<svg class="install-section__chevron" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const CLOSE_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const ICONS = {
  'chrome-ext': `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z" fill="currentColor"/>
  </svg>`,
  'browser-app': `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H7a1 1 0 1 0 0 2h10a1 1 0 1 0 0-2h-3v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 12H4V5h16v10Z" fill="currentColor"/>
  </svg>`,
  android: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.463 11.463 0 0 0-9.42 0L5.17 5.67a.643.643 0 0 0-.83-.22c-.3.16-.42.54-.26.85L5.92 9.48C2.75 11.2.65 14.24.65 18h22.7c0-3.76-2.1-6.8-5.75-8.52M7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5m10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5" fill="currentColor"/>
  </svg>`,
  ios: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M17.05 12.54c-.03-2.35 1.92-3.48 2-3.54-1.1-1.6-2.8-1.82-3.4-1.84-1.44-.15-2.82.85-3.55.85-.73 0-1.87-.83-3.07-.81-1.58.02-3.04.92-3.85 2.33-1.64 2.85-.42 7.07 1.18 9.38.78 1.13 1.71 2.4 2.93 2.35 1.18-.05 1.62-.76 3.05-.76s1.83.76 3.07.74c1.27-.02 2.07-1.15 2.85-2.29.9-1.31 1.27-2.58 1.29-2.65-.03-.01-2.47-.95-2.5-3.76zM14.7 5.6c.65-.79 1.09-1.88.97-2.97-.94.04-2.08.63-2.75 1.42-.6.7-1.13 1.81-.99 2.88 1.05.08 2.12-.53 2.77-1.33z" fill="currentColor"/>
  </svg>`,
  // Desktop app download icons — shown only on desktop (≥700px).
  windows: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 12V6l8-1v7H3zm0 1h8v7l-8-1v-6zm9-9.15L21 3v9h-9V3.85zM21 13v8l-9-1.15V13h9z" fill="currentColor"/>
  </svg>`,
  macos: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" fill="currentColor"/>
  </svg>`,
  linux: `<svg class="install-section__btn-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-.15 14.5c-.2 0-.35-.1-.35-.25s.15-.25.35-.25c.2 0 .35.1.35.25s-.15.25-.35.25zm1.3 0c-.2 0-.35-.1-.35-.25s.15-.25.35-.25c.2 0 .35.1.35.25s-.15.25-.35.25zm-2.6-1c-.2 0-.35-.15-.35-.35s.15-.35.35-.35.35.15.35.35-.15.35-.35.35zm3.9 0c-.2 0-.35-.15-.35-.35s.15-.35.35-.35.35.15.35.35-.15.35-.35.35zM9.3 13.5c-.2 0-.35-.1-.35-.25s.15-.25.35-.25.35.1.35.25-.15.25-.35.25zm5.4 0c-.2 0-.35-.1-.35-.25s.15-.25.35-.25.35.1.35.25-.15.25-.35.25zM12 9c-.8 0-1.5.35-1.5.75s.7.75 1.5.75 1.5-.35 1.5-.75S12.8 9 12 9zm-2.5 1c-.25 0-.5.15-.5.35s.25.35.5.35.5-.15.5-.35-.25-.35-.5-.35zm5 0c-.25 0-.5.15-.5.35s.25.35.5.35.5-.15.5-.35-.25-.35-.5-.35z" fill="currentColor"/>
  </svg>`,
};

// OS download URLs. The Electron wrapper is a thin client (loads the live
// PWA), so builds are rare — only when Electron itself or preload.js changes.
// Assets are published to GitHub Releases with stable, versionless names.
const DOWNLOAD_URLS = {
  windows: 'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-win.exe',
  macos:   'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-mac.dmg',
  linux:   'https://github.com/bitm4ncer/radiodock.app/releases/latest/download/RadioDock-linux.AppImage',
};

function tile(target, label, sub, currentClass) {
  return `<button type="button" class="install-section__btn${currentClass}" data-target="${target}">
    ${ICONS[target]}
    <span class="install-section__btn-text">
      <span class="install-section__btn-label">${label}</span>
      <span class="install-section__btn-sub">${sub}</span>
    </span>
  </button>`;
}

function downloadTile(target, label, sub) {
  const url = DOWNLOAD_URLS[target];
  return `<a class="install-section__btn install-section__btn--download" href="${url}" target="_blank" rel="noopener" data-download="${target}">
    ${ICONS[target]}
    <span class="install-section__btn-text">
      <span class="install-section__btn-label">${label}</span>
      <span class="install-section__btn-sub">${sub}</span>
    </span>
    <svg class="install-section__btn-dl-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  </a>`;
}

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
  const visible = visibleTargetsFor(platform);
  const isCurrent = (target) => (highlights.includes(target) ? ' is-current' : '');
  const showsBtn = (target) => visible.includes(target);

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
      <div class="install-section__head">
        <img class="install-section__logo" src="/icons/icon.svg" alt="" aria-hidden="true" />
        <p class="install-section__intro">Use RadioDock on all devices</p>
      </div>
      <div class="install-section__buttons" role="group">
        ${showsBtn('ios') ? tile('ios', 'iOS', 'Add to home screen', isCurrent('ios')) : ''}
        ${showsBtn('browser-app') ? tile('browser-app', 'Browser App', 'Install in browser', isCurrent('browser-app')) : ''}
        ${showsBtn('android') ? tile('android', 'Android', 'Add to home screen', isCurrent('android')) : ''}
        ${showsBtn('chrome-ext') ? tile('chrome-ext', 'Extension', 'Chrome · Edge · Brave', isCurrent('chrome-ext')) : ''}
      </div>
      <div class="install-section__downloads">
        <p class="install-section__downloads-label">Or download the desktop app</p>
        <div class="install-section__buttons">
          ${downloadTile('windows', 'Windows', '.exe installer')}
          ${downloadTile('macos', 'macOS', '.dmg disk image')}
          ${downloadTile('linux', 'Linux', '.AppImage')}
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

  // Cache the original overview HTML so we can restore it when the user
  // navigates back from a detail view.
  const overviewHtml = body.innerHTML;
  let inDetailView = false;

  // Cross-fade body content with a height tween on the badge so the
  // overview ↔ detail swap doesn't snap. The badge is anchored
  // bottom-right (position: fixed bottom: 20px), so growing the height
  // visually pushes the top edge up — matching what the user expects.
  const FADE_OUT_MS = 140;
  const HEIGHT_MS = 260;
  let inFlight = false;

  function transitionBodyTo(mutate) {
    if (inFlight) return; // de-bounce rapid clicks
    inFlight = true;

    const startH = section.getBoundingClientRect().height;

    // Fade body out.
    body.style.transition = `opacity ${FADE_OUT_MS}ms ease, transform ${FADE_OUT_MS}ms ease`;
    body.style.opacity = '0';
    body.style.transform = 'translateY(4px)';

    setTimeout(() => {
      // Swap content.
      mutate();
      // Measure target height once content is in.
      section.style.height = 'auto';
      const endH = section.getBoundingClientRect().height;
      // Lock to start height, then animate to end.
      section.style.height = startH + 'px';
      // Force layout so the next height change triggers a transition.
      // eslint-disable-next-line no-unused-expressions
      section.offsetHeight;
      section.style.transition = `height ${HEIGHT_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      section.style.height = endH + 'px';
      // Fade in shortly after height starts moving.
      body.style.transition = `opacity ${HEIGHT_MS - 20}ms ease 40ms, transform ${HEIGHT_MS - 20}ms ease 40ms`;
      body.style.opacity = '';
      body.style.transform = '';

      setTimeout(() => {
        section.style.transition = '';
        section.style.height = '';
        body.style.transition = '';
        inFlight = false;
      }, HEIGHT_MS + 40);
    }, FADE_OUT_MS);
  }

  function showDetail(branch) {
    transitionBodyTo(() => {
      inDetailView = true;
      section.classList.add('is-detail');
      body.innerHTML = `
        <button type="button" class="install-section__back" data-action="back" aria-label="Back">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
          Back
        </button>
        <div class="install-section__detail" id="installSectionDetail"></div>
      `;
      installInfo.renderInline({
        branch,
        container: body.querySelector('#installSectionDetail'),
        onClose: showOverview,
      });
    });
  }

  function showOverview() {
    transitionBodyTo(() => {
      inDetailView = false;
      section.classList.remove('is-detail');
      body.innerHTML = overviewHtml;
    });
  }

  // Single delegated click handler on the body so it covers both the
  // overview buttons and the back button in the detail view.
  body.addEventListener('click', (evt) => {
    const backBtn = evt.target.closest('[data-action="back"]');
    if (backBtn) {
      showOverview();
      return;
    }
    if (inDetailView) return; // detail-view actions are wired by renderInline()
    const targetBtn = evt.target.closest('[data-target]');
    if (!targetBtn) return;
    const target = targetBtn.dataset.target;
    const branchMap = {
      'chrome-ext': 'browser-ext',
      'browser-app': 'desktop',
      android: 'android',
      ios: 'ios-safari',
    };
    const branch = branchMap[target];
    if (!branch) return;

    // Desktop: render the detail inline inside the badge. Mobile: open the
    // existing fullscreen modal slide-in.
    const isDesktop = window.matchMedia('(min-width: 700px)').matches;
    if (isDesktop) {
      showDetail(branch);
    } else {
      installInfo.open(branch);
    }
  });

  return {
    destroy() {
      section.remove();
    },
  };
}
