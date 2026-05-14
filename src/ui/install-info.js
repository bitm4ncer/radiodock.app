// "Add to Home Screen" onboarding. Detects platform and shows tailored
// instructions. Auto-opens once on first visit (unless already installed)
// and is also reachable via the info-modal credit line.

import { openModal, closeModal } from './modals.js';
import * as storage from '../data/storage.js';

const ANDROID_PLATFORMS = /android/i;
const IOS_PLATFORMS = /iphone|ipad|ipod/i;

function detectPlatform() {
  const ua = navigator.userAgent;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari standalone (pre-display-mode-standalone era)
    window.navigator.standalone === true;
  if (isStandalone) return 'installed';

  if (IOS_PLATFORMS.test(ua)) {
    // Safari on iOS is the only iOS browser that can install. We sniff via
    // "Version/x" + Safari, and absence of Chrome/Firefox/Edg/FxiOS/CriOS.
    const isiOSSafari =
      /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Brave|YaBrowser)/.test(ua);
    return isiOSSafari ? 'ios-safari' : 'ios-other';
  }
  if (ANDROID_PLATFORMS.test(ua)) return 'android';
  return 'desktop';
}

function html(platform) {
  switch (platform) {
    case 'ios-safari':
      return `
        <h3>Add RadioDock to your home screen</h3>
        <ol class="install-steps">
          <li>Tap the <strong>Share</strong> icon at the bottom of Safari (the square with the arrow).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. RadioDock now lives on your home screen like a real app — perfect for listening in your pocket with the screen locked.</li>
        </ol>
        <button type="button" class="btn-primary" data-action="dismiss">Got it</button>
      `;
    case 'ios-other':
      return `
        <h3>Open in Safari to install</h3>
        <p>iPhone only lets <strong>Safari</strong> add apps to the home screen. You're using a different browser, so you'll need to switch.</p>
        <p>
          <a class="btn-primary" href="${location.href}" target="_blank" rel="noopener">Open in Safari</a>
        </p>
        <p class="install-hint">Or: copy <code>radiodock.app</code>, open Safari, and paste it into the address bar. Then tap Share → Add to Home Screen.</p>
        <button type="button" class="btn-secondary" data-action="dismiss">Skip for now</button>
      `;
    case 'android':
      return `
        <h3>Install RadioDock</h3>
        <p>Get the full-screen app experience and proper lock-screen controls.</p>
        <p>
          <button type="button" class="btn-primary" data-action="install">Install</button>
        </p>
        <p class="install-hint">If the button does nothing, tap the browser's <strong>⋮ menu</strong> and choose <strong>Add to Home Screen</strong> or <strong>Install app</strong>.</p>
        <button type="button" class="btn-secondary" data-action="dismiss">Skip for now</button>
      `;
    case 'desktop':
    default:
      return `
        <h3>Install RadioDock as an app</h3>
        <p>Pin RadioDock to your dock or taskbar — it opens in its own window without browser chrome.</p>
        <p>
          <button type="button" class="btn-primary" data-action="install">Install</button>
        </p>
        <p class="install-hint">If the button is greyed out, your browser doesn't support installable PWAs (Firefox, Safari on macOS). Chrome, Edge, Brave, and Arc all do.</p>
        <button type="button" class="btn-secondary" data-action="dismiss">Skip for now</button>
      `;
  }
}

export function mountInstallInfo() {
  const platform = detectPlatform();
  if (platform === 'installed') return { open() {}, autoShow() {} };

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (evt) => {
    evt.preventDefault();
    deferredPrompt = evt;
  });

  // Reuse the existing #infoModal shell but swap its body.
  // We use a dedicated modal instead so the about-modal stays untouched.
  let modalEl = document.getElementById('installInfoModal');
  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.id = 'installInfoModal';
    modalEl.className = 'modal';
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

  function open() {
    document.getElementById('installInfoBody').innerHTML = html(platform);
    openModal(modalEl);
  }

  async function autoShow() {
    const seen = await storage.getPref('seenInstallHint', false);
    if (seen) return;
    // Don't open during the bootstrap thrash; give the UI a beat to settle.
    setTimeout(open, 1200);
  }

  return { open, autoShow, platform };
}
