// Install-info popover. Five content branches:
//   browser-ext  — direct path to the Chrome Web Store (extension)
//   desktop      — PWA install on a desktop browser (Chromium-family only)
//   ios-safari   — Add to Home Screen via Safari
//   ios-other    — explainer + deep link out to Safari
//   android      — beforeinstallprompt-driven install, with manual fallback
//
// On desktop the popover slides out from the install badge into the
// bottom-left corner of the viewport. On mobile it's a centered modal.
// All transitions live in install-info.css.

import { openModal, closeModal } from './modals.js';
import * as storage from '../data/storage.js';

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/radiodock/dcjmegapbbplapeghilpbdddhkgndbbh';

const ANDROID_PLATFORMS = /android/i;
const IOS_PLATFORMS = /iphone|ipad|ipod/i;

function detectPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return 'installed';

  if (IOS_PLATFORMS.test(ua)) {
    const isiOSSafari =
      /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Brave|YaBrowser)/.test(ua);
    return isiOSSafari ? 'ios-safari' : 'ios-other';
  }
  if (ANDROID_PLATFORMS.test(ua)) return 'android';
  return 'desktop';
}

const SHARE_ICON_SVG = `<svg class="install-info__inline-icon" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3v12m0-12-4 4m4-4 4 4M5 14v4a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

const LOCK_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <rect x="6" y="11" width="12" height="9" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/>
</svg>`;

const REFRESH_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  <path d="M20 4v5h-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;

function html(platform) {
  switch (platform) {
    case 'browser-ext':
      return `
        <h3 class="install-info__title">Browser Extension</h3>
        <p class="install-info__lead">
          Install RadioDock from the Chrome Web Store. Works with
          <strong>Chrome</strong>, <strong>Edge</strong>, <strong>Brave</strong>,
          <strong>Opera</strong>, and <strong>Vivaldi</strong>.
        </p>
        <ul class="install-info__benefits">
          <li>One-click access from your browser toolbar</li>
          <li>Plays in the background even when the popup is closed</li>
          <li>Same UI and station list as this web app</li>
        </ul>
        <a class="install-info__primary" href="${CHROME_STORE_URL}" target="_blank" rel="noopener" data-action="dismiss">
          Open Chrome Web Store →
        </a>
        <button type="button" class="install-info__secondary" data-action="dismiss">Maybe later</button>
      `;

    case 'desktop':
      return `
        <h3 class="install-info__title">Desktop App</h3>
        <p class="install-info__lead">
          Install RadioDock as a standalone app. It opens in its own window
          and can be pinned to your dock or taskbar.
        </p>
        <ul class="install-info__benefits">
          <li>Dedicated window, dedicated dock icon</li>
          <li>Works on Windows, macOS, and Linux</li>
          <li>Requires <strong>Chrome</strong>, <strong>Edge</strong>, <strong>Brave</strong>, <strong>Opera</strong>, or <strong>Vivaldi</strong></li>
        </ul>
        <button type="button" class="install-info__primary" data-action="install">Install Now</button>
        <p class="install-info__hint">
          Button greyed out? Open your browser's <strong>⋮</strong> menu and choose <strong>Install app</strong> (or <strong>Apps → Install this site as an app</strong>).
        </p>
        <button type="button" class="install-info__secondary" data-action="dismiss">Maybe later</button>
      `;

    case 'ios-safari':
      return `
        <h3 class="install-info__title">Install on iPhone</h3>
        <p class="install-info__lead">4 quick steps — match the pictures to what you see on screen.</p>
        <ol class="install-walk">
          <li class="install-walk__step">
            <span class="install-walk__num">1</span>
            <div class="install-walk__body">
              <p class="install-walk__caption">Open <strong>radiodock.app</strong> in <strong>Safari</strong></p>
              <div class="install-walk__visual">
                <div class="ios-urlbar">
                  <span class="ios-urlbar__aa">A<small>A</small></span>
                  <span class="ios-urlbar__lock">${LOCK_ICON_SVG}</span>
                  <span class="ios-urlbar__host">radiodock.app</span>
                  <span class="ios-urlbar__refresh">${REFRESH_ICON_SVG}</span>
                </div>
              </div>
            </div>
          </li>
          <li class="install-walk__step">
            <span class="install-walk__num">2</span>
            <div class="install-walk__body">
              <p class="install-walk__caption">Tap the <strong>•••</strong> button at the bottom right</p>
              <div class="install-walk__visual">
                <div class="ios-toolbar">
                  <span class="ios-toolbar__btn ios-toolbar__btn--ghost" aria-hidden="true">‹</span>
                  <span class="ios-toolbar__pill">radiodock.app</span>
                  <span class="ios-toolbar__btn ios-toolbar__btn--target" aria-hidden="true">
                    <span class="ios-toolbar__dots">•••</span>
                  </span>
                </div>
              </div>
            </div>
          </li>
          <li class="install-walk__step">
            <span class="install-walk__num">3</span>
            <div class="install-walk__body">
              <p class="install-walk__caption">Tap <strong>Share</strong> <small class="install-walk__de">/ Teilen</small></p>
              <div class="install-walk__visual">
                <div class="ios-menu ios-menu--target">
                  <span class="ios-menu__icon">${SHARE_ICON_SVG}</span>
                  <span class="ios-menu__label">Share <small>· Teilen</small></span>
                </div>
              </div>
            </div>
          </li>
          <li class="install-walk__step">
            <span class="install-walk__num">4</span>
            <div class="install-walk__body">
              <p class="install-walk__caption">Scroll down, tap <strong>+ Add to Home Screen</strong>, then <strong>Add</strong> in the top right</p>
              <div class="install-walk__visual install-walk__visual--stack">
                <div class="ios-menu ios-menu--target">
                  <span class="ios-menu__icon ios-menu__icon--plus" aria-hidden="true">+</span>
                  <span class="ios-menu__label">Add to Home Screen <small>· Zum Home-Bildschirm</small></span>
                </div>
                <div class="ios-confirm-bar">
                  <span class="ios-confirm-bar__label">RadioDock</span>
                  <span class="ios-confirm-bar__btn">Add <small>· Hinzufügen</small></span>
                </div>
              </div>
            </div>
          </li>
        </ol>
        <button type="button" class="install-info__primary" data-action="dismiss">Got it</button>
      `;

    case 'ios-other':
      return `
        <h3 class="install-info__title">Open in Safari to Install</h3>
        <p class="install-info__lead">
          iPhone only lets <strong>Safari</strong> add apps to the home screen.
          You're using a different browser — open this page in Safari first.
        </p>
        <a class="install-info__primary" href="${location.href}" target="_blank" rel="noopener" data-action="dismiss">
          Open in Safari →
        </a>
        <p class="install-info__hint">
          Or: copy <code>radiodock.app</code>, open Safari, paste it in the address bar,
          then follow the iOS Safari instructions.
        </p>
        <button type="button" class="install-info__secondary" data-action="dismiss">Skip for now</button>
      `;

    case 'android':
    default:
      return `
        <h3 class="install-info__title">Install on Android</h3>
        <p class="install-info__lead">
          Add RadioDock as a real Android app — full screen, lock-screen
          media controls, no browser bar.
        </p>
        <button type="button" class="install-info__primary" data-action="install">Install</button>
        <p class="install-info__hint">
          Button does nothing? Open the browser's <strong>⋮</strong> menu and tap
          <strong>Add to Home screen</strong> or <strong>Install app</strong>.
        </p>
        <button type="button" class="install-info__secondary" data-action="dismiss">Skip for now</button>
      `;
  }
}

export function getInstallInfoHtml(platform) {
  return html(platform);
}

export function mountInstallInfo() {
  const platform = detectPlatform();
  // Note: even when platform === 'installed' we still mount the popover so
  // the .open(branch) API works from the install section — but the section
  // hides itself in that case, so this code path is rarely exercised.

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (evt) => {
    evt.preventDefault();
    deferredPrompt = evt;
  });

  let modalEl = document.getElementById('installInfoModal');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'installInfoModal';
    modalEl.className = 'modal install-info-modal-root';
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.innerHTML = `
      <div class="modal-content install-info-modal">
        <button type="button" class="modal-close-btn" data-action="dismiss" aria-label="Close">×</button>
        <div class="modal-body" id="installInfoBody"></div>
      </div>
    `;
    document.body.append(modalEl);

    modalEl.addEventListener('click', async (evt) => {
      const actionEl = evt.target.closest('[data-action]');
      if (!actionEl && evt.target !== modalEl) return;
      const action = actionEl?.dataset.action ?? 'dismiss';
      if (action === 'install') {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          await deferredPrompt.userChoice.catch(() => {});
          deferredPrompt = null;
        }
        closeModal(modalEl);
        await storage.setPref('seenInstallHint', true);
      } else if (action === 'dismiss') {
        closeModal(modalEl);
        await storage.setPref('seenInstallHint', true);
      }
    });
  }

  function open(overridePlatform) {
    const p = overridePlatform ?? platform;
    document.getElementById('installInfoBody').innerHTML = html(p);
    openModal(modalEl);
  }

  /**
   * Render an install-info branch into an arbitrary container (used by the
   * desktop install badge to show details inline). Wires the `install` and
   * `dismiss` buttons the same way the modal does.
   *
   * @param {Object} opts
   * @param {string} opts.branch         — platform branch key.
   * @param {HTMLElement} opts.container — target element to render into.
   * @param {() => void} [opts.onClose]  — called when user dismisses or installs.
   */
  function renderInline({ branch, container, onClose }) {
    if (!container) return;
    container.innerHTML = html(branch);
    container.addEventListener(
      'click',
      async (evt) => {
        const actionEl = evt.target.closest('[data-action]');
        if (!actionEl) return;
        const action = actionEl.dataset.action;
        if (action === 'install') {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            await deferredPrompt.userChoice.catch(() => {});
            deferredPrompt = null;
          }
          await storage.setPref('seenInstallHint', true);
          onClose?.();
        } else if (action === 'dismiss') {
          await storage.setPref('seenInstallHint', true);
          onClose?.();
        }
      },
      { once: false },
    );
  }

  return { open, renderInline, platform };
}
