// One quiet install hint for first-time mobile visitors. The desktop tours
// are anchored tooltips; on a phone there is no footer to tour, so this small
// card points at the existing install flow once and then stays away.
const STORAGE_KEY = 'radiodock-mobile-install-hint';
const SHOW_DELAY = 8000;

function readSeen() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, '1');
  } catch {
    /* private mode: the hint stays one-time per page load */
  }
}

function isMobileBrowser() {
  return window.matchMedia('(max-width: 699px)').matches
    && !document.body.classList.contains('is-electron')
    && !document.documentElement.classList.contains('is-standalone');
}

const PHONE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M10.5 5h3"/><path d="M11 18.5h2"/></svg>';

export function mountMobileTourBadge() {
  if (!isMobileBrowser() || readSeen()) return { show() {}, hide() {} };

  let timer = null;
  let badge = null;

  function openInstall() {
    const offCanvas = document.getElementById('offCanvasInstall');
    if (offCanvas) {
      offCanvas.click();
      return;
    }
    document.getElementById('footerReinstallBtn')?.click();
  }

  function remove() {
    badge?.remove();
    badge = null;
  }

  function hide() {
    if (!badge) return;
    badge.classList.add('is-dismissed');
    setTimeout(remove, 220);
  }

  function dismiss() {
    hide();
  }

  function show() {
    if (badge || readSeen() || document.visibilityState !== 'visible') return;
    markSeen();
    badge = document.createElement('div');
    badge.className = 'mobile-tour-badge is-entering';
    badge.setAttribute('role', 'status');
    badge.innerHTML = `
      <button type="button" class="mobile-tour-badge__close" aria-label="Dismiss install hint">×</button>
      <div class="mobile-tour-badge__row">
        <span class="mobile-tour-badge__icon">${PHONE_ICON}</span>
        <div class="mobile-tour-badge__copy">
          <strong>Take RadioDock with you</strong>
          <span>Install it on your phone, tablet or desktop.</span>
        </div>
      </div>
      <button type="button" class="mobile-tour-badge__cta">See options</button>`;
    document.body.appendChild(badge);
    badge.querySelector('.mobile-tour-badge__close')?.addEventListener('click', dismiss);
    badge.querySelector('.mobile-tour-badge__cta')?.addEventListener('click', () => {
      hide();
      setTimeout(openInstall, 80);
    });
    requestAnimationFrame(() => badge?.classList.remove('is-entering'));
  }

  const schedule = () => {
    if (document.visibilityState !== 'visible') {
      document.addEventListener('visibilitychange', schedule, { once: true });
      return;
    }
    timer = setTimeout(show, SHOW_DELAY);
  };
  schedule();

  return {
    show() {
      if (timer) clearTimeout(timer);
      show();
    },
    hide,
  };
}
