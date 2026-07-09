// Central platform detection + native PWA install prompt.
//
// The beforeinstallprompt capture MUST live at module top-level: Chrome
// fires the event once, early — if the listener attaches only when a UI
// module mounts, the event can be missed and native install silently
// degrades to the manual-instructions fallback.

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (evt) => {
  evt.preventDefault();
  deferredPrompt = evt;
});

export function canPromptInstall() {
  return deferredPrompt !== null;
}

/**
 * Trigger the browser's native install dialog (Android Chrome + desktop
 * Chromium). Resolves true if the prompt was shown, false if none is
 * available (already installed, unsupported browser, or the one-shot
 * event was already consumed).
 */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const evt = deferredPrompt;
  // The event is single-use — clear before prompting so a re-entrant
  // click can't call prompt() twice on the same event.
  deferredPrompt = null;
  evt.prompt();
  await evt.userChoice.catch(() => {});
  return true;
}

export function detectStandalone() {
  // The inline <head> script owns the canonical detection (display-mode
  // probe + the ?pwa=1 start_url marker for browsers whose app windows
  // misreport display-mode) and stamps it on <html> before modules run.
  if (document.documentElement.classList.contains('is-standalone')) return true;
  const modes = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];
  return (
    window.navigator.standalone === true ||
    modes.some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
  );
}

/**
 * @returns {'installed'|'ios-safari'|'ios-other'|'android'|'chromium-desktop'|'desktop'}
 */
export function detectPlatform() {
  if (detectStandalone()) return 'installed';

  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) {
    const isiOSSafari =
      /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|Brave|YaBrowser)/.test(ua);
    return isiOSSafari ? 'ios-safari' : 'ios-other';
  }
  if (/android/i.test(ua)) return 'android';
  // Chromium family: Chrome, Edge, Brave, Opera, Vivaldi. All support both
  // the Web Store extension AND PWA install.
  if (/Chrome|Edg|Brave|OPR|Vivaldi/i.test(ua) && !/Firefox/i.test(ua)) return 'chromium-desktop';
  return 'desktop';
}
