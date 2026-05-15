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
      desktop: 'desktop',
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
